// Client PMS connections — client+server-safe catalog, validation and helpers.
//
// Clients paste read-only PMS API credentials in the owner portal
// (/portal/connections). Hospitable is checked live; every other PMS is stored
// as "pending verification" for staff review. Secrets are only ever handled
// server-side and stored in Supabase Vault; this module never logs them and the
// browser only ever sees the last 4 characters.

import { airbnbIdFromLink } from "@/lib/listing-links"
import { detectCredential } from "@/lib/support-tickets"

export const PMS_PROVIDERS = [
  "hospitable",
  "guesty",
  "hostaway",
  "hostfully",
  "ownerrez",
  "lodgify",
  "other",
] as const

export type PmsProvider = (typeof PMS_PROVIDERS)[number]

/**
 * secret     → encrypted in Vault, masked in the form, last 4 shown afterwards
 * identifier → account/agency id; also stored only inside the Vault blob
 * text       → plain, non-secret value stored on the connection row
 */
export type PmsFieldKind = "secret" | "identifier" | "text"

export type PmsField = {
  key: string
  label: string
  kind: PmsFieldKind
  required: boolean
  placeholder?: string
  /** The secret whose last 4 characters identify the connection. */
  primary?: boolean
}

export type PmsProviderConfig = {
  key: PmsProvider
  label: string
  /** True when the Hub checks the credential against the provider right away. */
  liveCheck: boolean
  fields: PmsField[]
  /** Short "where to find this" guidance shown under the fields. */
  hint: string
  /** Optional numbered steps (Hospitable). */
  steps?: string[]
}

const READ_ONLY_REMINDER = "If you can choose permissions, pick read-only."

/** Shown to staff adding a key on a client's behalf (Hub Data Connections tab). */
export const PMS_STAFF_READ_ONLY_REMINDER =
  "Use a read-only key. RevFactor only reads properties, bookings and reports, so if the PMS lets you pick permissions, choose read-only. Never paste a login password."

export const PMS_PROVIDER_CONFIG: Record<PmsProvider, PmsProviderConfig> = {
  hospitable: {
    key: "hospitable",
    label: "Hospitable",
    liveCheck: true,
    fields: [
      {
        key: "token",
        label: "Personal access token (read only)",
        kind: "secret",
        required: true,
        primary: true,
        placeholder: "Paste the token from Hospitable",
      },
    ],
    hint:
      "Personal access tokens are in Hospitable's account settings, in the API access section. Tokens expire (about 12 months by default); we'll remind you before yours does.",
    steps: [
      "In Hospitable, open your account settings and find the API access / personal access tokens section.",
      "Create a new token and tick Read only. Don't give it write access.",
      "Leave the “Allowed IP addresses” field empty. Our servers don't use fixed IP addresses, so a list would block us.",
      "Copy the token and paste it below. Hospitable only shows it once.",
    ],
  },
  guesty: {
    key: "guesty",
    label: "Guesty",
    liveCheck: false,
    fields: [
      { key: "client_id", label: "Open API client ID", kind: "identifier", required: true },
      { key: "client_secret", label: "Open API client secret", kind: "secret", required: true, primary: true },
    ],
    hint: `Guesty's Open API credentials are created in Guesty under the Integrations / Marketplace area (look for “Open API”). Guesty shows a client ID and a client secret; the secret is only shown once. ${READ_ONLY_REMINDER}`,
  },
  hostaway: {
    key: "hostaway",
    label: "Hostaway",
    liveCheck: false,
    fields: [
      { key: "account_id", label: "Account ID", kind: "identifier", required: true },
      { key: "api_key", label: "API key", kind: "secret", required: true, primary: true },
    ],
    hint: `In Hostaway, open Settings and look for the Hostaway API section. Create an API key there; your account ID is shown on the same page. ${READ_ONLY_REMINDER}`,
  },
  hostfully: {
    key: "hostfully",
    label: "Hostfully",
    liveCheck: false,
    fields: [
      { key: "agency_uid", label: "Agency UID", kind: "identifier", required: true },
      { key: "api_key", label: "API key", kind: "secret", required: true, primary: true },
    ],
    hint: `Hostfully shows the agency UID and API key in Agency Settings when your plan includes API access. ${READ_ONLY_REMINDER}`,
  },
  ownerrez: {
    key: "ownerrez",
    label: "OwnerRez",
    liveCheck: false,
    fields: [
      { key: "token", label: "Personal access token", kind: "secret", required: true, primary: true },
    ],
    hint: `In OwnerRez, open Settings and look for the API / developer access section to create a personal access token. ${READ_ONLY_REMINDER}`,
  },
  lodgify: {
    key: "lodgify",
    label: "Lodgify",
    liveCheck: false,
    fields: [{ key: "api_key", label: "API key", kind: "secret", required: true, primary: true }],
    hint: `In Lodgify, open Settings and look for the Public API section to copy your API key. ${READ_ONLY_REMINDER}`,
  },
  other: {
    key: "other",
    label: "Other",
    liveCheck: false,
    fields: [
      { key: "provider_name", label: "PMS name", kind: "text", required: true, placeholder: "e.g. Smoobu" },
      { key: "api_key", label: "API key or token", kind: "secret", required: true, primary: true },
      {
        key: "note",
        label: "Notes (optional)",
        kind: "text",
        required: false,
        placeholder: "Anything we should know, e.g. which account this is for",
      },
    ],
    hint: `Tell us which PMS you use and paste an API key or token from its settings (usually under API, Integrations or Developers). ${READ_ONLY_REMINDER} Don't put passwords in the notes.`,
  },
}

export function isPmsProvider(value: unknown): value is PmsProvider {
  return typeof value === "string" && (PMS_PROVIDERS as readonly string[]).includes(value)
}

export function pmsProviderLabel(provider: string, providerName?: string | null): string {
  if (provider === "other") return providerName?.trim() || "Other PMS"
  return isPmsProvider(provider) ? PMS_PROVIDER_CONFIG[provider].label : provider
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const PMS_CONNECTION_STATUSES = [
  "pending_verification",
  "connected",
  "verified",
  "rejected",
  "error",
  "disconnected",
] as const

export type PmsConnectionStatus = (typeof PMS_CONNECTION_STATUSES)[number]

export const PMS_STATUS_LABEL: Record<PmsConnectionStatus, string> = {
  pending_verification: "Received – pending verification",
  connected: "Connected",
  verified: "Verified",
  rejected: "Rejected",
  error: "Needs attention",
  disconnected: "Disconnected",
}

export type PmsStatusTone = "good" | "pending" | "bad" | "muted"

export const PMS_STATUS_TONE: Record<PmsConnectionStatus, PmsStatusTone> = {
  pending_verification: "pending",
  connected: "good",
  verified: "good",
  rejected: "bad",
  error: "bad",
  disconnected: "muted",
}

export function pmsStatusLabel(status: string): string {
  return (PMS_STATUS_LABEL as Record<string, string>)[status] ?? status
}

// ---------------------------------------------------------------------------
// Validation (provider fields)
// ---------------------------------------------------------------------------

export type PmsCredentialInput = {
  provider: unknown
  values: unknown
  expiresAt?: unknown
}

export type ValidatedPmsCredential = {
  provider: PmsProvider
  /** JSON stored as one Vault secret: secrets + identifiers only. */
  secretPayload: string
  tokenLast4: string
  providerName: string | null
  clientNote: string | null
  expiresAt: string | null
}

export type PmsValidationResult =
  | { ok: true; value: ValidatedPmsCredential }
  | { ok: false; error: string; fieldErrors: Record<string, string> }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_SECRET = 4000
const MIN_SECRET = 8

function fail(error: string, fieldErrors: Record<string, string> = {}): PmsValidationResult {
  return { ok: false, error, fieldErrors }
}

/**
 * Validate the fields a client pasted for one PMS. Only the provider's own
 * fields are kept (anything else in `values` is dropped). Error messages never
 * echo the submitted values.
 */
export function validatePmsCredential(input: PmsCredentialInput, today: Date = new Date()): PmsValidationResult {
  if (!isPmsProvider(input.provider)) return fail("Select your PMS")
  const config = PMS_PROVIDER_CONFIG[input.provider]
  const raw = (input.values && typeof input.values === "object" ? input.values : {}) as Record<string, unknown>

  const fieldErrors: Record<string, string> = {}
  const secretFields: Record<string, string> = {}
  let providerName: string | null = null
  let clientNote: string | null = null
  let primary = ""

  for (const field of config.fields) {
    const value = typeof raw[field.key] === "string" ? (raw[field.key] as string).trim() : ""
    if (!value) {
      if (field.required) fieldErrors[field.key] = `${field.label.replace(/ \(.*\)$/, "")} is required`
      continue
    }
    if (field.kind === "secret") {
      if (/\s/.test(value)) fieldErrors[field.key] = "Paste it without spaces or line breaks"
      else if (value.length < MIN_SECRET) fieldErrors[field.key] = "That looks too short. Copy the whole value."
      else if (value.length > MAX_SECRET) fieldErrors[field.key] = "That looks too long. Copy just the key."
      else {
        secretFields[field.key] = value
        if (field.primary) primary = value
      }
    } else if (field.kind === "identifier") {
      if (/\s/.test(value) || value.length > 200) fieldErrors[field.key] = "Paste just the ID, without spaces"
      else secretFields[field.key] = value
    } else if (field.key === "provider_name") {
      if (value.length > 80) fieldErrors[field.key] = "Keep the PMS name under 80 characters"
      else providerName = value
    } else if (field.key === "note") {
      if (value.length > 500) fieldErrors[field.key] = "Keep notes under 500 characters"
      else if (detectCredential(value)) fieldErrors[field.key] = "Please don't put passwords or keys in the notes"
      else clientNote = value
    }
  }

  let expiresAt: string | null = null
  if (typeof input.expiresAt === "string" && input.expiresAt.trim()) {
    const value = input.expiresAt.trim()
    const parsed = DATE.test(value) ? new Date(`${value}T00:00:00Z`) : null
    const todayIso = today.toISOString().slice(0, 10)
    const maxIso = addMonths(today, 60).toISOString().slice(0, 10)
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
      fieldErrors.expires_at = "Enter a valid date"
    else if (value <= todayIso) fieldErrors.expires_at = "That date has already passed"
    else if (value > maxIso) fieldErrors.expires_at = "Pick a date within the next 5 years"
    else expiresAt = value
  }

  if (Object.keys(fieldErrors).length > 0) return fail("Check the highlighted fields", fieldErrors)

  return {
    ok: true,
    value: {
      provider: config.key,
      secretPayload: JSON.stringify({ v: 1, provider: config.key, fields: secretFields }),
      tokenLast4: primary.slice(-4),
      providerName: config.key === "other" ? providerName : null,
      clientNote: config.key === "other" ? clientNote : null,
      expiresAt,
    },
  }
}

const MAX_LABEL = 80

/**
 * Optional staff label for a connection (e.g. "Main account"). Plain text on
 * the connection row, so it must not hold a credential.
 */
export function validatePmsLabel(
  value: unknown
): { ok: true; label: string | null } | { ok: false; error: string } {
  const label = typeof value === "string" ? value.trim() : ""
  if (!label) return { ok: true, label: null }
  if (label.length > MAX_LABEL) return { ok: false, error: `Keep the label under ${MAX_LABEL} characters` }
  if (detectCredential(label)) return { ok: false, error: "Please don't put passwords or keys in the label" }
  return { ok: true, label }
}

/** Statuses that count as a live, in-use connection (for duplicate warnings). */
export function isActivePmsStatus(status: string): boolean {
  return status !== "disconnected" && status !== "rejected"
}

/**
 * Active connections that look like the same PMS as the one being added. For
 * "Other" the typed PMS name must match too. Used only to warn: a client can
 * have several accounts with one PMS.
 */
export function findSameProviderConnections<T extends { provider: string; providerLabel: string; status: string }>(
  connections: T[],
  provider: PmsProvider,
  providerName?: string | null
): T[] {
  const name = providerName?.trim().toLowerCase() ?? ""
  return connections.filter((c) => {
    if (c.provider !== provider || !isActivePmsStatus(c.status)) return false
    if (provider !== "other") return true
    return Boolean(name) && c.providerLabel.trim().toLowerCase() === name
  })
}

/** Read a stored Vault blob back into its fields (server-side only). */
export function parsePmsSecretPayload(payload: string | null): Record<string, string> | null {
  if (!payload) return null
  try {
    const parsed = JSON.parse(payload) as { v?: unknown; fields?: unknown }
    if (parsed.v !== 1 || !parsed.fields || typeof parsed.fields !== "object") return null
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed.fields as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v
    }
    return out
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Renewal reminders
// ---------------------------------------------------------------------------

function addMonths(date: Date, months: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d
}

/**
 * When to remind the client to renew: 30 days before a known expiry (never in
 * the past), else 11 months after connecting — Hospitable tokens default to
 * about 12 months and the API doesn't tell us the expiry.
 */
export function computeRemindAt(connectedAt: Date, expiresAt: string | null): string {
  const today = connectedAt.toISOString().slice(0, 10)
  if (expiresAt && DATE.test(expiresAt)) {
    const d = new Date(`${expiresAt}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 30)
    const remind = d.toISOString().slice(0, 10)
    return remind < today ? today : remind
  }
  return addMonths(connectedAt, 11).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Provider errors (Hospitable live check)
// ---------------------------------------------------------------------------

export const PMS_ERROR_CODES = [
  "invalid_token",
  "forbidden",
  "rate_limited",
  "provider_unavailable",
  "timeout",
  "unexpected_response",
] as const

export type PmsErrorCode = (typeof PMS_ERROR_CODES)[number]

/** Map a provider HTTP status to an error code. Never looks at the body. */
export function pmsErrorFromHttpStatus(status: number): PmsErrorCode {
  if (status === 401) return "invalid_token"
  if (status === 403) return "forbidden"
  if (status === 429) return "rate_limited"
  if (status >= 500) return "provider_unavailable"
  return "unexpected_response"
}

export function pmsErrorMessage(code: PmsErrorCode, providerLabel = "Hospitable"): string {
  switch (code) {
    case "invalid_token":
      return `${providerLabel} didn't accept this token. Check you copied all of it and that it hasn't expired or been revoked.`
    case "forbidden":
      return `This token can't read your properties. Create a new token with Read access, and leave the allowed IP addresses empty.`
    case "rate_limited":
      return `${providerLabel} is busy right now. Wait a minute and try again.`
    case "provider_unavailable":
    case "timeout":
      return `We couldn't reach ${providerLabel}. Try again in a few minutes.`
    case "unexpected_response":
      return `${providerLabel} sent a response we didn't expect. Try again, or message us in the portal.`
  }
}

// ---------------------------------------------------------------------------
// Property → listing suggestions
// ---------------------------------------------------------------------------

export type DiscoveredProperty = {
  external_property_id: string
  name: string | null
  airbnb_id: string | null
  vrbo_id: string | null
}

export type MappableListing = {
  id: string
  airbnb_link: string | null
  /** Not stored on listings today; accepted so Vrbo matching works once it is. */
  vrbo_id?: string | null
}

export type MappingSuggestion = {
  external_property_id: string
  suggested_listing_id: string | null
  suggestion_reason: "airbnb_id" | "vrbo_id" | null
  mapping_status: "suggested" | "unmatched"
}

/**
 * Suggest a Hub listing for each discovered property by exact channel ID
 * (Airbnb first, then Vrbo). Ambiguity fails closed: an ID shared by several
 * listings, or a listing that would be suggested for several properties, gets
 * no suggestion. Names are never used. Staff confirm every mapping.
 */
export function suggestPropertyMappings(
  properties: DiscoveredProperty[],
  listings: MappableListing[]
): MappingSuggestion[] {
  const byAirbnb = new Map<string, string[]>()
  const byVrbo = new Map<string, string[]>()
  for (const listing of listings) {
    const airbnb = airbnbIdFromLink(listing.airbnb_link)
    if (airbnb) byAirbnb.set(airbnb, [...(byAirbnb.get(airbnb) ?? []), listing.id])
    const vrbo = listing.vrbo_id?.trim()
    if (vrbo) byVrbo.set(vrbo.toLowerCase(), [...(byVrbo.get(vrbo.toLowerCase()) ?? []), listing.id])
  }

  const raw = properties.map((property) => {
    const airbnbHits = property.airbnb_id ? (byAirbnb.get(property.airbnb_id) ?? []) : []
    if (airbnbHits.length === 1)
      return { property, listingId: airbnbHits[0], reason: "airbnb_id" as const }
    if (airbnbHits.length > 1) return { property, listingId: null, reason: null }
    const vrboHits = property.vrbo_id ? (byVrbo.get(property.vrbo_id.toLowerCase()) ?? []) : []
    if (vrboHits.length === 1) return { property, listingId: vrboHits[0], reason: "vrbo_id" as const }
    return { property, listingId: null, reason: null }
  })

  const uses = new Map<string, number>()
  for (const r of raw) if (r.listingId) uses.set(r.listingId, (uses.get(r.listingId) ?? 0) + 1)

  return raw.map((r) => {
    const unique = r.listingId && uses.get(r.listingId) === 1
    return {
      external_property_id: r.property.external_property_id,
      suggested_listing_id: unique ? r.listingId : null,
      suggestion_reason: unique ? r.reason : null,
      mapping_status: unique ? "suggested" : "unmatched",
    }
  })
}

// ---------------------------------------------------------------------------
// View types shared by the portal and the Hub
// ---------------------------------------------------------------------------

export type PortalPmsConnection = {
  id: string
  provider: PmsProvider
  providerLabel: string
  status: PmsConnectionStatus
  tokenLast4: string | null
  createdAt: string
  remindAt: string
  expiresAt: string | null
  propertyCount: number | null
  lastValidatedAt: string | null
  propertyNames: string[]
}

export const MAX_OPEN_CONNECTIONS_PER_CLIENT = 10
