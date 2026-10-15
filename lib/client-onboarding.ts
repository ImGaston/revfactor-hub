// Onboarding tab on /clients/[id] — client+server-safe catalog, validation and
// view model for `client_onboarding_items` (migration 20261018120000).
//
// Two sections share one table:
//   * Preparation — reusable facts every onboarding needs. Owner-level items
//     live once per client (listing_id NULL); per-listing items live once per
//     listing. GHL intake (clients.ghl_onboarding) and Hub data prefill them at
//     read time; a saved row is the staff's value, and status `done` = verified.
//   * Call checklist — what Fede works through on the onboarding call, grounded
//     in the takeover steps (docs/agent/integrations.md, Guesty gotchas).
//     Saved per client/listing with who checked it and when.
// Keys are stable: they're stored in item_key. Add new items, never rename.

import { detectCredential } from "@/lib/support-tickets"

export const ONBOARDING_STATUSES = ["open", "done", "blocked", "not_applicable"] as const
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number]

export function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return typeof value === "string" && (ONBOARDING_STATUSES as readonly string[]).includes(value)
}

export const ONBOARDING_CHANNELS = [
  { value: "airbnb", label: "Airbnb" },
  { value: "vrbo", label: "Vrbo" },
  { value: "booking", label: "Booking.com" },
  { value: "direct", label: "Direct" },
] as const
export type OnboardingChannel = (typeof ONBOARDING_CHANNELS)[number]["value"]

type Option = { value: string; label: string }

export type OnboardingInput =
  | { kind: "choice"; options: readonly Option[] }
  | { kind: "text"; placeholder?: string }
  | { kind: "url"; placeholder?: string }
  | { kind: "money"; placeholder?: string }
  | { kind: "number"; min: number; max: number }
  | { kind: "channels" }
  | { kind: "date" }
  /** Check-only item: no value, just done / N/A / blocked. */
  | { kind: "none" }
  /** Shown from another system (GHL); not editable here. */
  | { kind: "readonly" }

export type OnboardingSection = "prep" | "call"
export type OnboardingScope = "client" | "listing"

export const CALL_GROUPS = [
  { key: "access", label: "Access" },
  { key: "takeover", label: "Pricing takeover" },
  { key: "rules", label: "Calendar and house rules" },
  { key: "wrap_up", label: "Wrap-up" },
] as const
export type CallGroup = (typeof CALL_GROUPS)[number]["key"]

export type OnboardingItemDef = {
  key: string
  section: OnboardingSection
  scope: OnboardingScope
  group?: CallGroup
  label: string
  help?: string
  input: OnboardingInput
}

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const

export const ONBOARDING_ITEMS = [
  // ---- Preparation: owner-level -------------------------------------------
  {
    key: "agreement",
    section: "prep",
    scope: "client",
    label: "Service agreement",
    input: {
      kind: "choice",
      options: [
        { value: "signed", label: "Signed" },
        { value: "not_signed", label: "Not signed" },
      ],
    },
  },
  {
    key: "listing_count",
    section: "prep",
    scope: "client",
    label: "Listings purchased",
    input: { kind: "number", min: 1, max: 500 },
  },
  { key: "onboarding_call", section: "prep", scope: "client", label: "Onboarding call", input: { kind: "readonly" } },
  {
    key: "pms_access",
    section: "prep",
    scope: "client",
    label: "PMS account access",
    help: "RevFactor's user in the owner's PMS account. Read-only users can't save listing content.",
    input: {
      kind: "choice",
      options: [
        { value: "edit_rights", label: "Added, can edit listings" },
        { value: "read_only", label: "Added, read-only" },
        { value: "not_added", label: "Not added yet" },
        { value: "no_pms", label: "No PMS" },
      ],
    },
  },
  {
    key: "payout_floor",
    section: "prep",
    scope: "client",
    label: "Payout floor (owner minimum)",
    help: "What the owner must net per night after markups and discounts. The PriceLabs minimum is derived from it.",
    input: { kind: "money", placeholder: "e.g. 250" },
  },
  {
    key: "airbnb_audit",
    section: "prep",
    scope: "client",
    label: "Wants the Airbnb listing audit",
    input: { kind: "choice", options: YES_NO },
  },
  // ---- Preparation: per listing -------------------------------------------
  {
    key: "airbnb_link",
    section: "prep",
    scope: "listing",
    label: "Airbnb link",
    input: { kind: "url", placeholder: "https://www.airbnb.com/rooms/…" },
  },
  { key: "channels", section: "prep", scope: "listing", label: "Channels", input: { kind: "channels" } },
  {
    key: "pms",
    section: "prep",
    scope: "listing",
    label: "PMS",
    input: { kind: "text", placeholder: "e.g. Guesty, Hostaway, none" },
  },
  {
    key: "pricelabs",
    section: "prep",
    scope: "listing",
    label: "PriceLabs",
    input: {
      kind: "choice",
      options: [
        { value: "synced", label: "Synced to the Hub" },
        { value: "connected", label: "Connected, not synced yet" },
        { value: "has_account", label: "Has an account, not connected" },
        { value: "none", label: "No PriceLabs yet" },
      ],
    },
  },
  // ---- Call checklist ------------------------------------------------------
  {
    key: "access_airbnb_cohost",
    section: "call",
    scope: "listing",
    group: "access",
    label: "Airbnb co-host access accepted",
    help: "Full co-host permissions on the listing, not just calendar.",
    input: { kind: "none" },
  },
  {
    key: "access_pms_user",
    section: "call",
    scope: "client",
    group: "access",
    label: "PMS user can edit listings",
    help: "Test a save. A read-only Guesty user returns 403 (\"internal server problem\"); the owner has to raise the role.",
    input: { kind: "none" },
  },
  {
    key: "access_pricelabs",
    section: "call",
    scope: "client",
    group: "access",
    label: "PriceLabs connected with a live token",
    help: "Sync Price should be recent. An expired PMS token needs a reconnect in the PMS marketplace; the owner or Fede pastes the key.",
    input: { kind: "none" },
  },
  {
    key: "pms_optimizer_off",
    section: "call",
    scope: "listing",
    group: "takeover",
    label: "PMS price optimizer off",
    help: "e.g. Guesty PriceOptimizer. Stage PriceLabs with push off, switch the optimizer off, then turn push on right away: switching it off resets 12 months to the original pricing.",
    input: { kind: "none" },
  },
  {
    key: "owner_minimum",
    section: "call",
    scope: "client",
    group: "takeover",
    label: "Owner minimum = payout floor",
    help: "Confirm the floor is the owner's payout after markups and discounts, then derive the PriceLabs minimum from it.",
    input: { kind: "none" },
  },
  {
    key: "cleaning_fee",
    section: "call",
    scope: "listing",
    group: "takeover",
    label: "Cleaning fee confirmed",
    input: { kind: "money", placeholder: "e.g. 185" },
  },
  {
    key: "channel_markups",
    section: "call",
    scope: "listing",
    group: "takeover",
    label: "Channel markups confirmed",
    help: "Airbnb / Vrbo / Booking.com. In Guesty, listing-level markups override account-level ones; check the channel price.",
    input: { kind: "text", placeholder: "e.g. Vrbo +15%, Booking.com +18%" },
  },
  {
    key: "owner_use_dates",
    section: "call",
    scope: "listing",
    group: "rules",
    label: "Owner-use dates blocked",
    input: { kind: "text", placeholder: "e.g. Dec 20–Jan 3" },
  },
  {
    key: "house_rules",
    section: "call",
    scope: "listing",
    group: "rules",
    label: "House rules confirmed",
    help: "Kids, pets, events, minimum age, max guests.",
    input: { kind: "text", placeholder: "e.g. No kids under 12, no pets" },
  },
  {
    key: "next_steps",
    section: "call",
    scope: "client",
    group: "wrap_up",
    label: "Next steps explained",
    help: "Day 3–5: launch report (listing audit) in the portal. Day 14: pickup check.",
    input: { kind: "none" },
  },
  {
    key: "launch_report_date",
    section: "call",
    scope: "client",
    group: "wrap_up",
    label: "Launch report due",
    help: "Day 3–5 after the call.",
    input: { kind: "date" },
  },
] as const satisfies readonly OnboardingItemDef[]

export type OnboardingItemKey = (typeof ONBOARDING_ITEMS)[number]["key"]

const BY_KEY = new Map<string, OnboardingItemDef>(ONBOARDING_ITEMS.map((d) => [d.key, d]))

export function onboardingItemDef(key: string): OnboardingItemDef | undefined {
  return BY_KEY.get(key)
}

export type OnboardingValue = string | number | string[]

export const ONBOARDING_TEXT_MAX = 500
export const ONBOARDING_NOTE_MAX = 1000
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Normalizes a value for an item; null clears it. */
export function validateOnboardingValue(
  def: OnboardingItemDef,
  raw: unknown
): { value: OnboardingValue | null } | { error: string } {
  if (raw == null || raw === "") return { value: null }
  const input = def.input
  switch (input.kind) {
    case "none":
    case "readonly":
      return { value: null }
    case "choice": {
      if (typeof raw !== "string" || !input.options.some((o) => o.value === raw)) return { error: "Pick an option" }
      return { value: raw }
    }
    case "text":
    case "url": {
      if (typeof raw !== "string") return { error: "Enter text" }
      const text = raw.trim()
      if (!text) return { value: null }
      if (text.length > ONBOARDING_TEXT_MAX) return { error: `Keep it under ${ONBOARDING_TEXT_MAX} characters` }
      const credential = detectCredential(text)
      if (credential) return { error: `Remove the ${credential}` }
      if (input.kind === "url") {
        let url: URL
        try {
          url = new URL(text)
        } catch {
          return { error: "Enter a full link starting with https://" }
        }
        if (url.protocol !== "https:" || url.username || url.password) return { error: "Use an https:// link" }
        // Keep links public: drop query strings and fragments (tracking, tokens).
        return { value: `${url.origin}${url.pathname}` }
      }
      return { value: text }
    }
    case "money":
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""))
      if (!Number.isFinite(n)) return { error: "Enter a number" }
      if (input.kind === "money") {
        if (n < 0 || n > 100000) return { error: "Enter an amount between 0 and 100,000" }
        return { value: Math.round(n * 100) / 100 }
      }
      if (!Number.isInteger(n) || n < input.min || n > input.max) {
        return { error: `Enter a whole number from ${input.min} to ${input.max}` }
      }
      return { value: n }
    }
    case "channels": {
      if (!Array.isArray(raw)) return { error: "Pick channels" }
      const known = ONBOARDING_CHANNELS.map((c) => c.value as string)
      if (raw.some((c) => typeof c !== "string" || !known.includes(c))) return { error: "Unknown channel" }
      const picked = known.filter((c) => raw.includes(c))
      return { value: picked.length ? picked : null }
    }
    case "date": {
      if (typeof raw !== "string" || !DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
        return { error: "Use a valid date" }
      }
      return { value: raw }
    }
  }
}

export type OnboardingSaveInput = {
  itemKey: string
  listingId: string | null
  status: string
  value?: unknown
  note?: string | null
}

export type OnboardingSaveValues = {
  item_key: OnboardingItemKey
  listing_id: string | null
  status: OnboardingStatus
  value: OnboardingValue | null
  note: string | null
}

/** Validates a save from the tab. Scope must match the item (owner vs listing). */
export function validateOnboardingSave(
  input: OnboardingSaveInput
): { values: OnboardingSaveValues } | { error: string } {
  const def = onboardingItemDef(input.itemKey)
  if (!def) return { error: "Unknown onboarding item" }
  if (def.input.kind === "readonly") return { error: "This item comes from GHL and can't be edited here" }
  if (def.scope === "listing" && !input.listingId) return { error: "Pick a listing" }
  if (def.scope === "client" && input.listingId) return { error: "This item is owner-level" }
  if (!isOnboardingStatus(input.status)) return { error: "Pick a status" }
  const parsed = validateOnboardingValue(def, input.value)
  if ("error" in parsed) return parsed
  if (def.section === "prep" && input.status === "done" && parsed.value == null) {
    return { error: "Add a value before verifying it" }
  }
  const note = typeof input.note === "string" ? input.note.trim() || null : null
  if (note && note.length > ONBOARDING_NOTE_MAX) return { error: "Keep the note under 1,000 characters" }
  const credential = detectCredential(note)
  if (credential) return { error: `Remove the ${credential} from the note` }
  return {
    values: {
      item_key: def.key as OnboardingItemKey,
      listing_id: def.scope === "listing" ? input.listingId : null,
      status: input.status,
      value: parsed.value,
      note,
    },
  }
}

export function formatOnboardingValue(def: OnboardingItemDef, value: OnboardingValue | null): string | null {
  if (value == null) return null
  const input = def.input
  switch (input.kind) {
    case "choice":
      return input.options.find((o) => o.value === value)?.label ?? String(value)
    case "money":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value)
        : String(value)
    case "channels":
      return Array.isArray(value)
        ? value.map((v) => ONBOARDING_CHANNELS.find((c) => c.value === v)?.label ?? v).join(", ")
        : String(value)
    case "date":
      return typeof value === "string" && DATE.test(value)
        ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          })
        : String(value)
    default:
      return Array.isArray(value) ? value.join(", ") : String(value)
  }
}

/** A full timestamp (e.g. ghl_synced_at) in New York time; "" when missing or unparseable. */
export function formatOnboardingTimestamp(value: string | null | undefined): string {
  if (!value) return ""
  const t = Date.parse(value)
  if (Number.isNaN(t)) return ""
  return new Date(t).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  })
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type GhlOnboardingInput = {
  purchased_listings?: number | null
  agreement_evidence?: string[] | null
  uses_pms?: string | null
  vrbo?: string | null
  uses_pricelabs?: string | null
  airbnb_ready?: string | null
  audit_requested?: string | null
  readiness?: string[] | null
  airbnb_listing_url?: string | null
  appointment?: { start: string; end?: string; status?: string | null; host_name?: string | null } | null
} | null

export type OnboardingClientInput = {
  pms_name: string | null
  has_vrbo: boolean | null
  ghl_onboarding: GhlOnboardingInput
}

export type OnboardingListingInput = {
  id: string
  name: string
  airbnb_link: string | null
  listing_id: string | null
  pricelabs_link: string | null
  pl_synced_at: string | null
}

export type OnboardingRowInput = {
  listing_id: string | null
  item_key: string
  status: string
  value: unknown
  note: string | null
  completed_at: string | null
  completed_by_name: string | null
  updated_at: string | null
  updated_by_name: string | null
}

/**
 * Where the shown value comes from: staff (a saved row), the client's GHL
 * intake, a GHL workflow (agreement tag — system evidence), or Hub data.
 */
export type OnboardingSource = "staff" | "client" | "ghl" | "hub"

export type OnboardingCell = {
  key: string
  listingId: string | null
  status: OnboardingStatus
  value: OnboardingValue | null
  display: string | null
  source: OnboardingSource | null
  /** Staff confirmed this value (prep) or ticked/N/A'd it (call). */
  saved: boolean
  note: string | null
  completedAt: string | null
  completedByName: string | null
  updatedAt: string | null
  updatedByName: string | null
}

export type OnboardingView = {
  owner: OnboardingCell[]
  listings: { id: string; name: string; cells: OnboardingCell[] }[]
  call: {
    group: CallGroup
    label: string
    items: { key: string; cells: OnboardingCell[] }[]
  }[]
  progress: { done: number; total: number; blocked: number }
}

function yesNo(answer: string | null | undefined): "yes" | "no" | null {
  const a = answer?.trim().toLowerCase()
  if (a === "yes") return "yes"
  if (a === "no") return "no"
  return null
}

function prefill(
  def: OnboardingItemDef,
  client: OnboardingClientInput,
  listing: OnboardingListingInput | null,
  listingCount: number
): { value: OnboardingValue; source: OnboardingSource } | null {
  const ghl = client.ghl_onboarding
  switch (def.key) {
    case "agreement":
      return (ghl?.agreement_evidence ?? []).length > 0 ? { value: "signed", source: "ghl" } : null
    case "listing_count":
      return ghl?.purchased_listings ? { value: ghl.purchased_listings, source: "client" } : null
    case "onboarding_call": {
      const appt = ghl?.appointment
      if (!appt?.start) return null
      const when = formatOnboardingTimestamp(appt.start)
      if (!when) return null
      const parts = [`${when} (New York)`, appt.host_name ?? "Host not assigned"]
      if (appt.status) parts.push(appt.status)
      return { value: parts.join(" · "), source: "ghl" }
    }
    case "pms_access":
      return yesNo(ghl?.uses_pms) === "no" ? { value: "no_pms", source: "client" } : null
    case "airbnb_audit": {
      const a = yesNo(ghl?.audit_requested)
      return a ? { value: a, source: "client" } : null
    }
    case "airbnb_link":
      if (listing?.airbnb_link) return { value: listing.airbnb_link, source: "hub" }
      // The intake has one link; it only maps to a listing when there is one.
      if (ghl?.airbnb_listing_url && listingCount === 1) return { value: ghl.airbnb_listing_url, source: "client" }
      return null
    case "channels": {
      if (!listing) return null
      const channels: string[] = []
      if (listing.airbnb_link) channels.push("airbnb")
      const ghlVrbo = yesNo(ghl?.vrbo)
      if (ghlVrbo === "yes" || (ghlVrbo == null && client.has_vrbo)) channels.push("vrbo")
      if (!channels.length) return null
      return { value: channels, source: ghlVrbo ? "client" : "hub" }
    }
    case "pms":
      if (client.pms_name) return { value: client.pms_name, source: "hub" }
      return yesNo(ghl?.uses_pms) === "no" ? { value: "No PMS", source: "client" } : null
    case "pricelabs":
      if (!listing) return null
      if (listing.pl_synced_at) return { value: "synced", source: "hub" }
      if (listing.listing_id || listing.pricelabs_link) return { value: "connected", source: "hub" }
      if (yesNo(ghl?.uses_pricelabs) === "yes") return { value: "has_account", source: "client" }
      if (yesNo(ghl?.uses_pricelabs) === "no") return { value: "none", source: "client" }
      return null
    default:
      return null
  }
}

function toValue(raw: unknown): OnboardingValue | null {
  if (typeof raw === "string" || typeof raw === "number") return raw
  if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) return raw as string[]
  return null
}

function cell(
  def: OnboardingItemDef,
  client: OnboardingClientInput,
  listing: OnboardingListingInput | null,
  listingCount: number,
  row: OnboardingRowInput | undefined
): OnboardingCell {
  const rowValue = row ? toValue(row.value) : null
  const fill = rowValue == null ? prefill(def, client, listing, listingCount) : null
  const value = rowValue ?? fill?.value ?? null
  return {
    key: def.key,
    listingId: listing?.id ?? null,
    status: row && isOnboardingStatus(row.status) ? row.status : "open",
    value,
    display: formatOnboardingValue(def, value),
    source: rowValue != null ? "staff" : (fill?.source ?? null),
    saved: !!row,
    note: row?.note ?? null,
    completedAt: row?.completed_at ?? null,
    completedByName: row?.completed_by_name ?? null,
    updatedAt: row?.updated_at ?? null,
    updatedByName: row?.updated_by_name ?? null,
  }
}

export function buildOnboardingView(input: {
  client: OnboardingClientInput
  listings: OnboardingListingInput[]
  rows: OnboardingRowInput[]
}): OnboardingView {
  const rows = new Map(input.rows.map((r) => [`${r.listing_id ?? "client"}:${r.item_key}`, r]))
  const count = input.listings.length
  const ownerCell = (def: OnboardingItemDef) => cell(def, input.client, null, count, rows.get(`client:${def.key}`))
  const listingCell = (def: OnboardingItemDef, l: OnboardingListingInput) =>
    cell(def, input.client, l, count, rows.get(`${l.id}:${def.key}`))

  const defs: readonly OnboardingItemDef[] = ONBOARDING_ITEMS
  const prep = defs.filter((d) => d.section === "prep")
  const owner = prep.filter((d) => d.scope === "client").map(ownerCell)
  const listings = input.listings.map((l) => ({
    id: l.id,
    name: l.name,
    cells: prep.filter((d) => d.scope === "listing").map((d) => listingCell(d, l)),
  }))

  const call = CALL_GROUPS.map((g) => ({
    group: g.key,
    label: g.label,
    items: defs
      .filter((d) => d.section === "call" && d.group === g.key)
      .map((d) => ({
        key: d.key,
        cells: d.scope === "client" ? [ownerCell(d)] : input.listings.map((l) => listingCell(d, l)),
      }))
      .filter((i) => i.cells.length > 0),
  })).filter((g) => g.items.length > 0)

  const callCells = call.flatMap((g) => g.items.flatMap((i) => i.cells))
  return {
    owner,
    listings,
    call,
    progress: {
      done: callCells.filter((c) => c.status === "done" || c.status === "not_applicable").length,
      total: callCells.length,
      blocked: callCells.filter((c) => c.status === "blocked").length,
    },
  }
}

// ---------------------------------------------------------------------------
// Activity (client_onboarding_item_events)
// ---------------------------------------------------------------------------

export type OnboardingEventInput = {
  listing_id: string | null
  item_key: string
  from_status: string | null
  to_status: string
  from_value: unknown
  to_value: unknown
  note: string | null
  created_at: string
  actor_name: string | null
}

export function describeOnboardingEvent(e: OnboardingEventInput): string {
  const def = onboardingItemDef(e.item_key)
  const label = def?.label ?? e.item_key
  const prep = def?.section === "prep"
  if (e.from_status !== e.to_status) {
    switch (e.to_status) {
      case "done":
        return prep ? `Verified ${label}` : `Checked ${label}`
      case "not_applicable":
        return `Marked ${label} not applicable`
      case "blocked":
        return `Flagged ${label} as blocked`
      case "open":
        if (e.from_status) return prep ? `Unverified ${label}` : `Unchecked ${label}`
    }
  }
  if (JSON.stringify(e.from_value ?? null) !== JSON.stringify(e.to_value ?? null)) {
    const shown = def ? formatOnboardingValue(def, toValue(e.to_value)) : null
    return shown ? `Set ${label} to ${shown}` : `Cleared ${label}`
  }
  return `Updated the note on ${label}`
}
