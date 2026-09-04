import {
  DurableObject,
  type DurableObjectNamespace,
  type DurableObjectState,
  type SqlStorage,
} from "cloudflare:workers"
import {
  freezeOnboardingGroup,
  onboardingGroupFingerprint,
  opportunityCommercialFields,
  type FrozenBillingAccount,
  type FrozenOnboardingGroup,
  type GroupSignup,
} from "./multi-business"

export type Env = {
  HIGHLEVEL_API_KEY: string
  HIGHLEVEL_LOCATION_ID: string
  HIGHLEVEL_ONBOARDING_TEMPLATE_ID: string
  HIGHLEVEL_ONBOARDING_REFERRAL_TEMPLATE_ID: string
  HIGHLEVEL_ONBOARDING_SENDER_USER_ID: string
  HIGHLEVEL_ONBOARDING_TEMPLATE_NAME: string
  HIGHLEVEL_ONBOARDING_REFERRAL_TEMPLATE_NAME: string
  HIGHLEVEL_ONBOARDING_REFERRAL_CODES?: string
  HIGHLEVEL_DOCUMENT_SIGNING_BASE_URL: string
  HIGHLEVEL_ONBOARDING_ALLOWED_ORIGIN: string
  HIGHLEVEL_ONBOARDING_GROUP_TEMPLATE_ID?: string
  HIGHLEVEL_ONBOARDING_GROUP_REFERRAL_TEMPLATE_ID?: string
  HIGHLEVEL_ONBOARDING_ACCOUNT_PIPELINE_ID?: string
  HIGHLEVEL_ONBOARDING_ACCOUNT_AGREEMENT_PENDING_STAGE_ID?: string
  HIGHLEVEL_ONBOARDING_ACCOUNT_AGREEMENT_SIGNED_STAGE_ID?: string
  HIGHLEVEL_ONBOARDING_ACCOUNT_PAYMENT_PENDING_STAGE_ID?: string
  HIGHLEVEL_ONBOARDING_ACCOUNT_PAYMENT_VERIFIED_STAGE_ID?: string
  HIGHLEVEL_ONBOARDING_ACCOUNT_COMPLETE_STAGE_ID?: string
  HIGHLEVEL_ONBOARDING_ACCOUNT_MANUAL_REVIEW_STAGE_ID?: string
  HIGHLEVEL_OPPORTUNITY_LEGAL_NAME_FIELD_ID?: string
  HIGHLEVEL_OPPORTUNITY_LISTING_QUANTITY_FIELD_ID?: string
  HIGHLEVEL_OPPORTUNITY_PRICING_PROGRAM_FIELD_ID?: string
  HIGHLEVEL_OPPORTUNITY_MONTHLY_RATE_FIELD_ID?: string
  HIGHLEVEL_OPPORTUNITY_MONTHLY_AMOUNT_FIELD_ID?: string
  HIGHLEVEL_OPPORTUNITY_ONBOARDING_FEE_FIELD_ID?: string
  HIGHLEVEL_OPPORTUNITY_INITIAL_TOTAL_FIELD_ID?: string
  HIGHLEVEL_ONBOARDING_CONTINUATION_URL?: string
  HIGHLEVEL_ONBOARDING_FINAL_URL?: string
  HIGHLEVEL_ONBOARDING_RESUME_HMAC_SECRET?: string
  HUB_ONBOARDING_API_BASE_URL?: string
  HUB_ONBOARDING_INTERNAL_HMAC_SECRET?: string
  AGREEMENT_CLAIMS: DurableObjectNamespace<AgreementClaimCoordinator>
}

export type PricingProgram = "Regular" | "Referral"

export type Signup = {
  legalName: string
  contactName: string
  email: string
  phone: string | null
  primaryListingQuantity: number
  pricingProgram: PricingProgram
}

type DocumentLink = {
  referenceId?: unknown
  recipientId?: unknown
  entityName?: unknown
}

type GhlDocument = {
  documentId?: unknown
  name?: unknown
  status?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  documentRevision?: unknown
  opportunityId?: unknown
  recipients?: Array<{ id?: unknown; hasCompleted?: unknown }>
  links?: DocumentLink[]
}

type GhlDocumentPage = {
  documents?: unknown
  total?: unknown
}

type ClaimStage =
  | "claimed"
  | "preflight_scanning"
  | "preflight_clear"
  | "commercial_writing"
  | "commercial_written"
  | "template_creating"
  | "template_reconciling"
  | "template_reconcile_scanning"
  | "draft_found"
  | "link_creating"
  | "link_reconciling"
  | "link_reconcile_scanning"
  | "completed"
  | "conflict"

type AgreementRevision = {
  version: 1
  contactId: string
  contactName: string
  normalizedLegalName: string
  primaryListingQuantity: number
  pricingProgram: PricingProgram
  primaryMonthlyRate: number
  monthlyServiceFee: number
  onboardingFee: number
  initialCheckoutTotal: number
  templateId: string
  templateName: string
}

type AgreementClaimRequest = {
  contactId: string
  input: Signup
}

export type AgreementClaimResult =
  | {
      outcome: "completed"
      documentId: string
      signingUrl: string
      reused: boolean
    }
  | {
      outcome: "pending"
      stage: ClaimStage
      retryAfterSeconds: number
    }
  | {
      outcome: "conflict"
      message: string
    }

type ClaimRow = {
  fingerprint: string
  revision_json: string
  stage: ClaimStage
  document_id: string | null
  signing_url: string | null
  created_at: number
  updated_at: number
  last_error_code: string | null
  state_version: number
}

type GroupClaimStage =
  | "claimed"
  | "preflight_scanning"
  | "preflight_clear"
  | "active"
  | "complete"
  | "conflict"

type GroupAccountStage =
  | "planned"
  | "opportunity_creating"
  | "opportunity_reconciling"
  | "opportunity_ready"
  | "template_creating"
  | "template_reconciling"
  | "draft_found"
  | "link_creating"
  | "link_reconciling"
  | "agreement_pending"
  | "agreement_signed"
  | "payment_pending"
  | "payment_verified"
  | "complete"
  | "manual_review"

type GroupClaimRow = {
  fingerprint: string
  group_json: string
  stage: GroupClaimStage
  created_at: number
  updated_at: number
  state_version: number
  last_error_code: string | null
}

type GroupAccountRow = {
  sequence: number
  account_json: string
  stage: GroupAccountStage
  opportunity_name: string
  opportunity_id: string | null
  document_id: string | null
  signing_url: string | null
  checkout_url: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  updated_at: number
  state_version: number
  last_error_code: string | null
}

export type OnboardingGroupResult =
  | {
      outcome: "ready"
      groupFingerprint: string
      accountSequence: number
      signingUrl: string
      reused: boolean
    }
  | {
      outcome: "pending"
      groupFingerprint: string
      accountSequence: number
      stage: GroupClaimStage | GroupAccountStage
      retryAfterSeconds: number
    }
  | { outcome: "conflict"; message: string }

export type OnboardingGroupResumeResult =
  | {
      outcome: "ready"
      nextAction:
        | { kind: "agreement"; accountSequence: number; url: string }
        | { kind: "payment"; accountSequence: number; url: string }
        | { kind: "onboarding"; url: string }
        | { kind: "awaiting_provider"; accountSequence: number }
    }
  | { outcome: "manual_review"; accountSequence: number }
  | { outcome: "conflict"; message: string }

const GHL_API = "https://services.leadconnectorhq.com"

function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.HIGHLEVEL_ONBOARDING_ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  }
}

function json(env: Env, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(env) })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function configuredCodeSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((code) => code.trim().toLocaleLowerCase())
      .filter(Boolean)
  )
}

export function resolvePricingProgram(
  offerCode: unknown,
  configuredReferralCodes: string | undefined
): PricingProgram {
  const candidate =
    typeof offerCode === "string" ? offerCode.trim().toLocaleLowerCase() : ""
  if (!candidate) return "Regular"
  if (configuredCodeSet(configuredReferralCodes).has(candidate)) {
    return "Referral"
  }
  throw new Error("Enter a valid referral code")
}

export function parseSignup(body: unknown, env: Env): Signup {
  if (!isRecord(body)) throw new Error("Invalid submission")
  if (typeof body.website === "string" && body.website.trim()) {
    throw new Error("Invalid submission")
  }

  const legalName = String(body.legalName ?? "").trim()
  const contactName = String(body.contactName ?? "").trim()
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase()
  const phone = String(body.phone ?? "").trim() || null
  const primaryListingQuantity = Number(body.primaryListingQuantity)
  const childListingQuantity = Number(body.childListingQuantity ?? 0)
  const serviceStartMode = body.serviceStartMode ?? "immediate"
  const serviceStartDate = String(body.serviceStartDate ?? "").trim()
  const pricingProgram = resolvePricingProgram(
    body.offerCode,
    env.HIGHLEVEL_ONBOARDING_REFERRAL_CODES
  )

  if (legalName.length < 2 || legalName.length > 255) {
    throw new Error("Enter the legal business or client name")
  }
  if (contactName.length < 2 || contactName.length > 255) {
    throw new Error("Enter the signer name")
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address")
  }
  if (phone && phone.length > 40) throw new Error("Enter a valid phone number")
  if (
    !Number.isInteger(primaryListingQuantity) ||
    primaryListingQuantity < 1 ||
    primaryListingQuantity > 5
  ) {
    throw new Error("Primary listings must be between 1 and 5")
  }
  if (!Number.isInteger(childListingQuantity) || childListingQuantity !== 0) {
    throw new Error(
      "Child listings require a separate RevFactor onboarding path"
    )
  }
  if (serviceStartMode !== "immediate" || serviceStartDate) {
    throw new Error("The standard RevFactor signup starts service immediately")
  }

  return {
    legalName,
    contactName,
    email,
    phone,
    primaryListingQuantity,
    pricingProgram,
  }
}

export function parseGroupSignup(body: unknown, env: Env): GroupSignup {
  if (!isRecord(body)) throw new Error("Invalid submission")
  if (typeof body.website === "string" && body.website.trim()) {
    throw new Error("Invalid submission")
  }
  const billingMode = body.billingMode
  if (billingMode !== "single" && billingMode !== "separate_per_listing") {
    throw new Error("Choose how the properties should be contracted and billed")
  }
  const contactName = String(body.contactName ?? "").trim()
  const email = String(body.email ?? "")
    .trim()
    .toLocaleLowerCase()
  const phone = String(body.phone ?? "").trim() || null
  const totalListingCount = Number(body.totalListingCount)
  const legalBusinessNames = Array.isArray(body.legalBusinessNames)
    ? body.legalBusinessNames.map((value) => String(value ?? "").trim())
    : []
  if (contactName.length < 2 || contactName.length > 255) {
    throw new Error("Enter the signer name")
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address")
  }
  if (phone && phone.length > 40) throw new Error("Enter a valid phone number")
  if (
    !Number.isInteger(totalListingCount) ||
    totalListingCount < 1 ||
    totalListingCount > 5
  ) {
    throw new Error("Listings must be between 1 and 5")
  }
  const pricingProgram = resolvePricingProgram(
    body.referralCode,
    env.HIGHLEVEL_ONBOARDING_REFERRAL_CODES
  )
  const signup: GroupSignup = {
    billingMode,
    contactName,
    email,
    phone,
    totalListingCount,
    legalBusinessNames,
    pricingProgram,
  }
  freezeOnboardingGroup({ contactId: "validation-only", signup })
  return signup
}

export function serviceValues(
  input: Pick<Signup, "primaryListingQuantity" | "pricingProgram">
) {
  const primaryMonthlyRate = input.pricingProgram === "Referral" ? 320 : 350
  const monthlyServiceFee = input.primaryListingQuantity * primaryMonthlyRate
  const onboardingFee = 150
  const initialCheckoutTotal = monthlyServiceFee + onboardingFee

  return {
    primaryMonthlyRate,
    monthlyServiceFee,
    onboardingFee,
    initialCheckoutTotal,
    pricingProgram: input.pricingProgram,
  }
}

function ghlHeaders(env: Env): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${env.HIGHLEVEL_API_KEY}`,
    "Content-Type": "application/json",
    Version: "v3",
  }
}

async function ghlFetch(
  env: Env,
  path: string,
  init: RequestInit
): Promise<Response> {
  const response = await fetch(`${GHL_API}${path}`, {
    ...init,
    headers: { ...ghlHeaders(env), ...init.headers },
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`HighLevel request failed (${response.status}): ${detail}`)
  }
  return response
}

async function upsertContact(
  env: Env,
  input: Signup,
  includeCommercialFields = false
): Promise<string> {
  const values = serviceValues(input)
  const response = await ghlFetch(env, "/contacts/upsert", {
    method: "POST",
    body: JSON.stringify({
      name: input.contactName,
      email: input.email,
      phone: input.phone ?? undefined,
      companyName: includeCommercialFields ? input.legalName : undefined,
      locationId: env.HIGHLEVEL_LOCATION_ID,
      source: "RevFactor inline GHL onboarding",
      createNewIfDuplicateAllowed: false,
      customFields: includeCommercialFields
        ? [
            {
              key: "contact.rf_client_legal_name",
              fieldValue: input.legalName,
            },
            {
              key: "contact.rf_primary_listing_quantity",
              fieldValue: String(input.primaryListingQuantity),
            },
            { key: "contact.rf_child_listing_quantity", fieldValue: "0" },
            {
              key: "contact.rf_pricing_program",
              fieldValue: values.pricingProgram,
            },
            {
              key: "contact.rf_monthly_service_fee",
              fieldValue: String(values.monthlyServiceFee),
            },
            {
              key: "contact.rf_onboarding_fee",
              fieldValue: String(values.onboardingFee),
            },
            {
              key: "contact.rf_initial_checkout_total",
              fieldValue: String(values.initialCheckoutTotal),
            },
            { key: "contact.rf_service_start_mode", fieldValue: "immediate" },
            { key: "contact.rf_service_start_date", fieldValue: "" },
            { key: "contact.rf_agreement_effective_date", fieldValue: "" },
          ]
        : undefined,
    }),
  })
  const payload = (await response.json()) as { contact?: { id?: unknown } }
  if (typeof payload.contact?.id !== "string") {
    throw new Error("HighLevel returned no contact ID")
  }
  return payload.contact.id
}

const DOCUMENT_PAGE_SIZE = 50
const MAX_DOCUMENT_SCAN_PAGES = 20
const MAX_DOCUMENT_SCAN_RESULTS = DOCUMENT_PAGE_SIZE * MAX_DOCUMENT_SCAN_PAGES

async function listAllDocuments(env: Env): Promise<GhlDocument[]> {
  const documents: GhlDocument[] = []
  const documentIds = new Set<string>()
  let expectedTotal: number | null = null

  for (let page = 0; page < MAX_DOCUMENT_SCAN_PAGES; page += 1) {
    const params = new URLSearchParams({
      locationId: env.HIGHLEVEL_LOCATION_ID,
      limit: String(DOCUMENT_PAGE_SIZE),
      skip: String(documents.length),
    })
    const response = await ghlFetch(
      env,
      `/proposals/document?${params.toString()}`,
      { method: "GET" }
    )
    const payload = (await response.json()) as GhlDocumentPage
    if (
      !Number.isSafeInteger(payload.total) ||
      Number(payload.total) < 0 ||
      Number(payload.total) > MAX_DOCUMENT_SCAN_RESULTS
    ) {
      throw new Error("HighLevel returned an unsafe document total")
    }
    const pageTotal = Number(payload.total)
    if (expectedTotal === null) expectedTotal = pageTotal
    if (pageTotal !== expectedTotal) {
      throw new Error("HighLevel document total changed during pagination")
    }
    if (!Array.isArray(payload.documents)) {
      throw new Error("HighLevel returned an invalid document page")
    }
    if (payload.documents.length > DOCUMENT_PAGE_SIZE) {
      throw new Error("HighLevel exceeded the document page limit")
    }
    if (payload.documents.length === 0 && documents.length < expectedTotal) {
      throw new Error("HighLevel returned an incomplete document page set")
    }

    for (const candidate of payload.documents) {
      if (!isRecord(candidate) || typeof candidate.documentId !== "string") {
        throw new Error("HighLevel returned a document without an identity")
      }
      if (documentIds.has(candidate.documentId)) {
        throw new Error("HighLevel returned duplicate document identities")
      }
      documentIds.add(candidate.documentId)
      documents.push(candidate as GhlDocument)
    }

    if (documents.length > expectedTotal) {
      throw new Error("HighLevel returned more documents than declared")
    }
    if (documents.length === expectedTotal) return documents
  }

  throw new Error("HighLevel document pagination exceeded its safe bound")
}

function contactReference(
  links: DocumentLink[] | undefined,
  contactId: string
): string | null {
  const link = links?.find(
    (candidate) =>
      candidate.recipientId === contactId &&
      candidate.entityName === "contacts" &&
      typeof candidate.referenceId === "string"
  )
  return typeof link?.referenceId === "string" ? link.referenceId : null
}

function signingUrl(env: Env, referenceId: string): string {
  return `${env.HIGHLEVEL_DOCUMENT_SIGNING_BASE_URL.replace(/\/$/, "")}/documents/v1/${encodeURIComponent(referenceId)}?locale=en-US`
}

export function agreementTemplate(env: Env, pricingProgram: PricingProgram) {
  if (pricingProgram === "Referral") {
    return {
      templateId: env.HIGHLEVEL_ONBOARDING_REFERRAL_TEMPLATE_ID,
      templateName: env.HIGHLEVEL_ONBOARDING_REFERRAL_TEMPLATE_NAME,
    }
  }
  return {
    templateId: env.HIGHLEVEL_ONBOARDING_TEMPLATE_ID,
    templateName: env.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME,
  }
}

function normalizeLegalName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

export function buildAgreementRevision(
  env: Env,
  request: AgreementClaimRequest
): AgreementRevision {
  const values = serviceValues(request.input)
  const template = agreementTemplate(env, request.input.pricingProgram)
  return {
    version: 1,
    contactId: request.contactId,
    contactName: request.input.contactName.trim().replace(/\s+/g, " "),
    normalizedLegalName: normalizeLegalName(request.input.legalName),
    primaryListingQuantity: request.input.primaryListingQuantity,
    pricingProgram: request.input.pricingProgram,
    primaryMonthlyRate: values.primaryMonthlyRate,
    monthlyServiceFee: values.monthlyServiceFee,
    onboardingFee: values.onboardingFee,
    initialCheckoutTotal: values.initialCheckoutTotal,
    templateId: template.templateId,
    templateName: template.templateName,
  }
}

export async function agreementRevisionFingerprint(
  revision: AgreementRevision
) {
  const bytes = new TextEncoder().encode(JSON.stringify(revision))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export function agreementDocumentName(
  revision: AgreementRevision,
  fingerprint: string
) {
  return `${revision.templateName} — ${revision.contactName} — rf-${fingerprint.slice(0, 16)}`
}

const ACTION_STALE_AFTER_MS = 15_000
const ACTIVE_DOCUMENT_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "completed",
  "signed",
  "accepted",
]

export const LEGACY_REVFACTOR_AGREEMENT_NAMES = [
  "RevFactor_Service_Agreement",
  "RevFactor_Service_Agreement_With_Child_Listings",
  "RevFactor_Service_Agreement_Standard_Immediate_Start_DRAFT_v2",
] as const

const GROUP_TEMPLATE_NAMES = {
  Regular: "RevFactor_Service_Agreement_Standard_Opportunity_NATIVE_DRAFT_v4",
  Referral:
    "RevFactor_Service_Agreement_Referral_320_Opportunity_NATIVE_DRAFT_v2",
} as const

function requiredGroupConfig(env: Env, key: keyof Env): string {
  const value = env[key]
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.startsWith("DRAFT_UNCONFIGURED_") ||
    value.startsWith("PROVISIONAL_")
  ) {
    throw new Error(
      `Multi-business onboarding is not configured: ${String(key)}`
    )
  }
  return value.trim()
}

function groupTemplate(env: Env, pricingProgram: PricingProgram) {
  return {
    templateId: requiredGroupConfig(
      env,
      pricingProgram === "Referral"
        ? "HIGHLEVEL_ONBOARDING_GROUP_REFERRAL_TEMPLATE_ID"
        : "HIGHLEVEL_ONBOARDING_GROUP_TEMPLATE_ID"
    ),
    templateName: GROUP_TEMPLATE_NAMES[pricingProgram],
  }
}

function opportunityName(
  fingerprint: string,
  account: FrozenBillingAccount,
  accountCount: number
) {
  return `RF Onboarding ${fingerprint.slice(0, 16)} · ${account.sequence}/${accountCount} · ${account.legalBusinessName}`
}

type GhlOpportunity = { id?: unknown; name?: unknown; contactId?: unknown }

async function listContactOpportunities(env: Env, contactId: string) {
  const params = new URLSearchParams({
    location_id: env.HIGHLEVEL_LOCATION_ID,
    contact_id: contactId,
    limit: "100",
  })
  const response = await ghlFetch(
    env,
    `/opportunities/search?${params.toString()}`,
    { method: "GET" }
  )
  const payload = (await response.json()) as {
    opportunities?: unknown
    meta?: { total?: unknown }
  }
  if (!Array.isArray(payload.opportunities)) {
    throw new Error("HighLevel returned an invalid opportunity inventory")
  }
  const total = Number(payload.meta?.total ?? payload.opportunities.length)
  if (
    !Number.isSafeInteger(total) ||
    total < payload.opportunities.length ||
    total > 100
  ) {
    throw new Error("HighLevel opportunity inventory is incomplete")
  }
  return payload.opportunities as GhlOpportunity[]
}

function opportunityCustomFields(env: Env, account: FrozenBillingAccount) {
  const values = opportunityCommercialFields(account)
  const mappings: Array<[keyof typeof values, keyof Env]> = [
    ["rf_legal_business_name", "HIGHLEVEL_OPPORTUNITY_LEGAL_NAME_FIELD_ID"],
    ["rf_listing_quantity", "HIGHLEVEL_OPPORTUNITY_LISTING_QUANTITY_FIELD_ID"],
    ["rf_pricing_program", "HIGHLEVEL_OPPORTUNITY_PRICING_PROGRAM_FIELD_ID"],
    ["rf_monthly_rate", "HIGHLEVEL_OPPORTUNITY_MONTHLY_RATE_FIELD_ID"],
    ["rf_monthly_amount", "HIGHLEVEL_OPPORTUNITY_MONTHLY_AMOUNT_FIELD_ID"],
    [
      "rf_allocated_onboarding_fee",
      "HIGHLEVEL_OPPORTUNITY_ONBOARDING_FEE_FIELD_ID",
    ],
    [
      "rf_initial_checkout_total",
      "HIGHLEVEL_OPPORTUNITY_INITIAL_TOTAL_FIELD_ID",
    ],
  ]
  return mappings.map(([valueKey, envKey]) => ({
    id: requiredGroupConfig(env, envKey),
    field_value: values[valueKey],
  }))
}

async function createBillingOpportunity(input: {
  env: Env
  contactId: string
  name: string
  account: FrozenBillingAccount
}) {
  const response = await ghlFetch(input.env, "/opportunities/", {
    method: "POST",
    body: JSON.stringify({
      locationId: input.env.HIGHLEVEL_LOCATION_ID,
      pipelineId: requiredGroupConfig(
        input.env,
        "HIGHLEVEL_ONBOARDING_ACCOUNT_PIPELINE_ID"
      ),
      pipelineStageId: requiredGroupConfig(
        input.env,
        "HIGHLEVEL_ONBOARDING_ACCOUNT_AGREEMENT_PENDING_STAGE_ID"
      ),
      contactId: input.contactId,
      name: input.name,
      status: "open",
      monetaryValue: input.account.initialCheckoutTotalCents / 100,
      customFields: opportunityCustomFields(input.env, input.account),
    }),
  })
  const payload = (await response.json()) as { opportunity?: { id?: unknown } }
  if (typeof payload.opportunity?.id !== "string") {
    throw new Error("HighLevel returned no opportunity ID")
  }
  return payload.opportunity.id
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

async function hubOnboardingPost(
  env: Env,
  path: "/api/internal/onboarding/checkout" | "/api/internal/onboarding/status",
  payload: Record<string, unknown>
) {
  const baseUrl = requiredGroupConfig(env, "HUB_ONBOARDING_API_BASE_URL")
  if (!baseUrl.startsWith("https://")) {
    throw new Error("Hub onboarding API must use HTTPS")
  }
  const secret = requiredGroupConfig(env, "HUB_ONBOARDING_INTERNAL_HMAC_SECRET")
  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = bytesToHex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${body}`)
    )
  )
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-rf-timestamp": timestamp,
      "x-rf-signature": `v1=${signature}`,
    },
    body,
  })
  if (!response.ok) {
    throw new Error(`Hub onboarding request failed (${response.status})`)
  }
  const result: unknown = await response.json()
  if (!isRecord(result) || result.success !== true) {
    throw new Error("Hub onboarding returned an invalid response")
  }
  return result
}

function matchesAgreementName(name: string, agreementName: string) {
  return name === agreementName || name.startsWith(`${agreementName} — `)
}

function claimRows(sql: SqlStorage): ClaimRow[] {
  return sql.exec<ClaimRow>("SELECT * FROM agreement_claim LIMIT 1").toArray()
}

function stageResult(row: ClaimRow): AgreementClaimResult {
  return {
    outcome: "pending",
    stage: row.stage,
    retryAfterSeconds: 2,
  }
}

export class AgreementClaimCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS agreement_claim (
          fingerprint TEXT PRIMARY KEY,
          revision_json TEXT NOT NULL,
          stage TEXT NOT NULL CHECK (stage IN (
            'claimed', 'preflight_scanning', 'preflight_clear',
            'commercial_writing', 'commercial_written',
            'template_creating', 'template_reconciling',
            'template_reconcile_scanning', 'draft_found',
            'link_creating', 'link_reconciling',
            'link_reconcile_scanning', 'completed', 'conflict'
          )),
          document_id TEXT,
          signing_url TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_error_code TEXT,
          state_version INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS claim_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stage TEXT NOT NULL,
          result_code TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS onboarding_group_claim (
          fingerprint TEXT PRIMARY KEY,
          group_json TEXT NOT NULL,
          stage TEXT NOT NULL CHECK (stage IN (
            'claimed', 'preflight_scanning', 'preflight_clear',
            'active', 'complete', 'conflict'
          )),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          state_version INTEGER NOT NULL DEFAULT 0,
          last_error_code TEXT
        );
        CREATE TABLE IF NOT EXISTS onboarding_group_account (
          sequence INTEGER PRIMARY KEY CHECK (sequence BETWEEN 1 AND 5),
          account_json TEXT NOT NULL,
          stage TEXT NOT NULL CHECK (stage IN (
            'planned', 'opportunity_creating', 'opportunity_reconciling',
            'opportunity_ready', 'template_creating', 'template_reconciling',
            'draft_found', 'link_creating', 'link_reconciling',
            'agreement_pending', 'agreement_signed', 'payment_pending',
            'payment_verified', 'complete', 'manual_review'
          )),
          opportunity_name TEXT NOT NULL UNIQUE,
          opportunity_id TEXT UNIQUE,
          document_id TEXT UNIQUE,
          signing_url TEXT,
          checkout_url TEXT,
          stripe_customer_id TEXT UNIQUE,
          stripe_subscription_id TEXT UNIQUE,
          updated_at INTEGER NOT NULL,
          state_version INTEGER NOT NULL DEFAULT 0,
          last_error_code TEXT
        );
      `)
    })
  }

  private get sql() {
    return this.ctx.storage.sql
  }

  private event(stage: ClaimStage, resultCode: string) {
    this.sql.exec(
      "INSERT INTO claim_events (stage, result_code, created_at) VALUES (?, ?, ?)",
      stage,
      resultCode,
      Date.now()
    )
    this.sql.exec(`
      DELETE FROM claim_events
      WHERE id NOT IN (SELECT id FROM claim_events ORDER BY id DESC LIMIT 100)
    `)
  }

  private transition(
    expected: ClaimRow,
    stage: ClaimStage,
    fields: {
      documentId?: string | null
      signingUrl?: string | null
      errorCode?: string | null
    } = {}
  ): ClaimRow | null {
    const rows = this.sql
      .exec<ClaimRow>(
        `UPDATE agreement_claim
       SET stage = ?, document_id = COALESCE(?, document_id),
           signing_url = COALESCE(?, signing_url), updated_at = ?,
           last_error_code = ?, state_version = state_version + 1
       WHERE fingerprint = ? AND stage = ? AND state_version = ?
       RETURNING *`,
        stage,
        fields.documentId ?? null,
        fields.signingUrl ?? null,
        Date.now(),
        fields.errorCode ?? null,
        expected.fingerprint,
        expected.stage,
        expected.state_version
      )
      .toArray()
    if (rows.length === 0) return null
    this.event(stage, fields.errorCode ?? "ok")
    return rows[0]
  }

  private current(): ClaimRow {
    const row = claimRows(this.sql)[0]
    if (!row) throw new Error("Agreement claim disappeared")
    return row
  }

  private currentResult(): AgreementClaimResult {
    const row = this.current()
    if (row.stage === "completed" && row.document_id && row.signing_url) {
      return {
        outcome: "completed",
        documentId: row.document_id,
        signingUrl: row.signing_url,
        reused: true,
      }
    }
    if (row.stage === "conflict") {
      return {
        outcome: "conflict",
        message:
          "This contact already has a different agreement revision. Contact RevFactor before continuing.",
      }
    }
    return stageResult(row)
  }

  private conflict(row: ClaimRow, code: string): AgreementClaimResult {
    if (row.stage !== "completed" && row.stage !== "conflict") {
      if (!this.transition(row, "conflict", { errorCode: code })) {
        return this.currentResult()
      }
    } else {
      this.event("conflict", code)
    }
    return {
      outcome: "conflict",
      message:
        "This contact already has a different agreement revision. Contact RevFactor before continuing.",
    }
  }

  private revisionConflict(code: string): AgreementClaimResult {
    this.event("conflict", code)
    return {
      outcome: "conflict",
      message:
        "This contact already has a different agreement revision. Contact RevFactor before continuing.",
    }
  }

  private relevantDocuments(
    documents: GhlDocument[] | undefined,
    contactId: string
  ) {
    const templateNames = [
      this.env.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME,
      this.env.HIGHLEVEL_ONBOARDING_REFERRAL_TEMPLATE_NAME,
      ...Object.values(GROUP_TEMPLATE_NAMES),
      ...LEGACY_REVFACTOR_AGREEMENT_NAMES,
    ]
    return (documents ?? []).filter(
      (document) =>
        typeof document.documentId === "string" &&
        typeof document.name === "string" &&
        templateNames.some((name) =>
          matchesAgreementName(String(document.name), name)
        ) &&
        typeof document.status === "string" &&
        ACTIVE_DOCUMENT_STATUSES.includes(document.status) &&
        document.recipients?.some((recipient) => recipient.id === contactId)
    )
  }

  private async scan(revision: AgreementRevision) {
    return this.relevantDocuments(
      await listAllDocuments(this.env),
      revision.contactId
    )
  }

  private groupRow(): GroupClaimRow | null {
    return (
      this.sql
        .exec<GroupClaimRow>("SELECT * FROM onboarding_group_claim LIMIT 1")
        .toArray()[0] ?? null
    )
  }

  private groupAccounts(): GroupAccountRow[] {
    return this.sql
      .exec<GroupAccountRow>(
        "SELECT * FROM onboarding_group_account ORDER BY sequence"
      )
      .toArray()
  }

  private transitionGroup(
    expected: GroupClaimRow,
    stage: GroupClaimStage,
    errorCode: string | null = null
  ) {
    return (
      this.sql
        .exec<GroupClaimRow>(
          `UPDATE onboarding_group_claim
           SET stage = ?, updated_at = ?, last_error_code = ?,
               state_version = state_version + 1
           WHERE fingerprint = ? AND stage = ? AND state_version = ?
           RETURNING *`,
          stage,
          Date.now(),
          errorCode,
          expected.fingerprint,
          expected.stage,
          expected.state_version
        )
        .toArray()[0] ?? null
    )
  }

  private transitionGroupAccount(
    expected: GroupAccountRow,
    stage: GroupAccountStage,
    fields: {
      opportunityId?: string | null
      documentId?: string | null
      signingUrl?: string | null
      checkoutUrl?: string | null
      stripeCustomerId?: string | null
      stripeSubscriptionId?: string | null
      errorCode?: string | null
    } = {}
  ) {
    return (
      this.sql
        .exec<GroupAccountRow>(
          `UPDATE onboarding_group_account
           SET stage = ?,
               opportunity_id = COALESCE(?, opportunity_id),
               document_id = COALESCE(?, document_id),
               signing_url = COALESCE(?, signing_url),
               checkout_url = COALESCE(?, checkout_url),
               stripe_customer_id = COALESCE(?, stripe_customer_id),
               stripe_subscription_id = COALESCE(?, stripe_subscription_id),
               updated_at = ?, last_error_code = ?,
               state_version = state_version + 1
           WHERE sequence = ? AND stage = ? AND state_version = ?
           RETURNING *`,
          stage,
          fields.opportunityId ?? null,
          fields.documentId ?? null,
          fields.signingUrl ?? null,
          fields.checkoutUrl ?? null,
          fields.stripeCustomerId ?? null,
          fields.stripeSubscriptionId ?? null,
          Date.now(),
          fields.errorCode ?? null,
          expected.sequence,
          expected.stage,
          expected.state_version
        )
        .toArray()[0] ?? null
    )
  }

  private groupPending(
    fingerprint: string,
    accountSequence: number,
    stage: GroupClaimStage | GroupAccountStage
  ): OnboardingGroupResult {
    return {
      outcome: "pending",
      groupFingerprint: fingerprint,
      accountSequence,
      stage,
      retryAfterSeconds: 2,
    }
  }

  private groupConflict(): OnboardingGroupResult {
    return {
      outcome: "conflict",
      message:
        "This signer already has a different active onboarding group. Contact RevFactor before continuing.",
    }
  }

  private groupDocumentName(
    group: FrozenOnboardingGroup,
    fingerprint: string,
    account: FrozenBillingAccount
  ) {
    return `${groupTemplate(this.env, group.pricingProgram).templateName} — ${group.contactName} — ${account.sequence}/${group.accounts.length} — rfg-${fingerprint.slice(0, 16)}`
  }

  async processOnboardingGroup(request: {
    contactId: string
    input: GroupSignup
  }): Promise<OnboardingGroupResult> {
    const group = freezeOnboardingGroup({
      contactId: request.contactId,
      signup: request.input,
    })
    const groupJson = JSON.stringify(group)
    const fingerprint = await onboardingGroupFingerprint(group)
    let groupRow = this.groupRow()
    const now = Date.now()
    if (!groupRow) {
      this.sql.exec(
        `INSERT INTO onboarding_group_claim
          (fingerprint, group_json, stage, created_at, updated_at)
         VALUES (?, ?, 'claimed', ?, ?)`,
        fingerprint,
        groupJson,
        now,
        now
      )
      for (const account of group.accounts) {
        this.sql.exec(
          `INSERT INTO onboarding_group_account
            (sequence, account_json, stage, opportunity_name, updated_at)
           VALUES (?, ?, 'planned', ?, ?)`,
          account.sequence,
          JSON.stringify(account),
          opportunityName(fingerprint, account, group.accounts.length),
          now
        )
      }
      groupRow = this.groupRow()
    }
    if (
      !groupRow ||
      groupRow.fingerprint !== fingerprint ||
      groupRow.group_json !== groupJson ||
      groupRow.stage === "conflict"
    ) {
      return this.groupConflict()
    }

    if (groupRow.stage === "claimed") {
      const scanning = this.transitionGroup(groupRow, "preflight_scanning")
      if (!scanning) {
        return this.groupPending(
          fingerprint,
          1,
          this.groupRow()?.stage ?? "claimed"
        )
      }
      groupRow = scanning
      try {
        const documents = this.relevantDocuments(
          await listAllDocuments(this.env),
          request.contactId
        )
        if (documents.length > 0) {
          this.transitionGroup(groupRow, "conflict", "preexisting_agreement")
          return this.groupConflict()
        }
      } catch {
        const retry = this.transitionGroup(
          groupRow,
          "claimed",
          "preflight_lookup_failed"
        )
        return this.groupPending(
          fingerprint,
          1,
          retry?.stage ?? "preflight_scanning"
        )
      }
      const clear = this.transitionGroup(groupRow, "preflight_clear")
      if (!clear) {
        return this.groupPending(
          fingerprint,
          1,
          this.groupRow()?.stage ?? "claimed"
        )
      }
      groupRow = clear
    }
    if (groupRow.stage === "preflight_scanning") {
      if (now - groupRow.updated_at < ACTION_STALE_AFTER_MS) {
        return this.groupPending(fingerprint, 1, groupRow.stage)
      }
      const recovered = this.transitionGroup(
        groupRow,
        "claimed",
        "stale_preflight_rescan"
      )
      return this.groupPending(
        fingerprint,
        1,
        recovered?.stage ?? groupRow.stage
      )
    }
    if (groupRow.stage === "preflight_clear") {
      const active = this.transitionGroup(groupRow, "active")
      if (!active) {
        return this.groupPending(
          fingerprint,
          1,
          this.groupRow()?.stage ?? groupRow.stage
        )
      }
      groupRow = active
    }

    const accounts = this.groupAccounts()
    const activeAccount = accounts.find(
      (account) => account.stage !== "complete"
    )
    if (!activeAccount) {
      if (groupRow.stage !== "complete")
        this.transitionGroup(groupRow, "complete")
      return this.groupPending(fingerprint, group.accounts.length, "complete")
    }
    let row = activeAccount
    const account = JSON.parse(row.account_json) as FrozenBillingAccount
    const template = groupTemplate(this.env, group.pricingProgram)

    if (row.stage === "agreement_pending" && row.signing_url) {
      return {
        outcome: "ready",
        groupFingerprint: fingerprint,
        accountSequence: row.sequence,
        signingUrl: row.signing_url,
        reused: true,
      }
    }
    if (
      [
        "agreement_signed",
        "payment_pending",
        "payment_verified",
        "manual_review",
      ].includes(row.stage)
    ) {
      return this.groupPending(fingerprint, row.sequence, row.stage)
    }

    if (row.stage === "planned") {
      const reconciling = this.transitionGroupAccount(
        row,
        "opportunity_reconciling"
      )
      if (!reconciling) {
        return this.groupPending(
          fingerprint,
          row.sequence,
          this.groupAccounts()[row.sequence - 1].stage
        )
      }
      row = reconciling
      let existing: GhlOpportunity[]
      try {
        existing = (
          await listContactOpportunities(this.env, request.contactId)
        ).filter((opportunity) => opportunity.name === row.opportunity_name)
      } catch {
        const pending = this.transitionGroupAccount(row, "planned", {
          errorCode: "opportunity_preflight_failed",
        })
        return this.groupPending(
          fingerprint,
          row.sequence,
          pending?.stage ?? row.stage
        )
      }
      if (existing.length > 1) {
        const conflict = this.transitionGroupAccount(row, "manual_review", {
          errorCode: "duplicate_opportunity_identity",
        })
        return this.groupPending(
          fingerprint,
          row.sequence,
          conflict?.stage ?? row.stage
        )
      }
      if (existing.length === 1 && typeof existing[0].id === "string") {
        const ready = this.transitionGroupAccount(row, "opportunity_ready", {
          opportunityId: existing[0].id,
        })
        if (!ready)
          return this.groupPending(fingerprint, row.sequence, row.stage)
        row = ready
      } else {
        const creating = this.transitionGroupAccount(
          row,
          "opportunity_creating"
        )
        if (!creating)
          return this.groupPending(fingerprint, row.sequence, row.stage)
        row = creating
        try {
          const opportunityId = await createBillingOpportunity({
            env: this.env,
            contactId: request.contactId,
            name: row.opportunity_name,
            account,
          })
          const ready = this.transitionGroupAccount(row, "opportunity_ready", {
            opportunityId,
          })
          if (!ready)
            return this.groupPending(fingerprint, row.sequence, row.stage)
          row = ready
        } catch {
          const pending = this.transitionGroupAccount(
            row,
            "opportunity_reconciling",
            { errorCode: "opportunity_outcome_reconcile" }
          )
          return this.groupPending(
            fingerprint,
            row.sequence,
            pending?.stage ?? row.stage
          )
        }
      }
    }

    if (row.stage === "opportunity_reconciling") {
      let matches: GhlOpportunity[]
      try {
        matches = (
          await listContactOpportunities(this.env, request.contactId)
        ).filter((opportunity) => opportunity.name === row.opportunity_name)
      } catch {
        return this.groupPending(fingerprint, row.sequence, row.stage)
      }
      if (matches.length !== 1 || typeof matches[0].id !== "string") {
        return this.groupPending(fingerprint, row.sequence, row.stage)
      }
      const ready = this.transitionGroupAccount(row, "opportunity_ready", {
        opportunityId: matches[0].id,
      })
      if (!ready) return this.groupPending(fingerprint, row.sequence, row.stage)
      row = ready
    }

    if (row.stage === "opportunity_ready" && row.opportunity_id) {
      const creating = this.transitionGroupAccount(row, "template_creating")
      if (!creating)
        return this.groupPending(fingerprint, row.sequence, row.stage)
      row = creating
      try {
        await ghlFetch(this.env, "/proposals/templates/send", {
          method: "POST",
          body: JSON.stringify({
            templateId: template.templateId,
            userId: this.env.HIGHLEVEL_ONBOARDING_SENDER_USER_ID,
            sendDocument: false,
            locationId: this.env.HIGHLEVEL_LOCATION_ID,
            contactId: request.contactId,
            opportunityId: row.opportunity_id,
          }),
        })
      } catch {
        // Never create again after an ambiguous provider response.
      }
      const pending = this.transitionGroupAccount(row, "template_reconciling", {
        errorCode: "template_outcome_reconcile",
      })
      if (!pending)
        return this.groupPending(fingerprint, row.sequence, row.stage)
      row = pending
    }

    if (row.stage === "template_reconciling") {
      let documents: GhlDocument[]
      try {
        documents = await listAllDocuments(this.env)
      } catch {
        return this.groupPending(fingerprint, row.sequence, row.stage)
      }
      const drafts = documents.filter(
        (document) =>
          document.status === "draft" &&
          typeof document.name === "string" &&
          document.name.startsWith(template.templateName) &&
          document.recipients?.some(
            (recipient) => recipient.id === request.contactId
          )
      )
      if (drafts.length !== 1 || typeof drafts[0].documentId !== "string") {
        return this.groupPending(fingerprint, row.sequence, row.stage)
      }
      const found = this.transitionGroupAccount(row, "draft_found", {
        documentId: drafts[0].documentId,
      })
      if (!found) return this.groupPending(fingerprint, row.sequence, row.stage)
      row = found
    }

    if (row.stage === "draft_found" && row.document_id) {
      const creating = this.transitionGroupAccount(row, "link_creating")
      if (!creating)
        return this.groupPending(fingerprint, row.sequence, row.stage)
      row = creating
      let response: Response | null = null
      try {
        response = await ghlFetch(this.env, "/proposals/document/send", {
          method: "POST",
          body: JSON.stringify({
            locationId: this.env.HIGHLEVEL_LOCATION_ID,
            documentId: row.document_id,
            documentName: this.groupDocumentName(group, fingerprint, account),
            medium: "link",
            sentBy: this.env.HIGHLEVEL_ONBOARDING_SENDER_USER_ID,
          }),
        })
      } catch {
        // Reconcile only; do not issue a second link-generation request.
      }
      if (response) {
        const payload = (await response.json()) as { links?: DocumentLink[] }
        const referenceId = contactReference(payload.links, request.contactId)
        if (referenceId) {
          const url = signingUrl(this.env, referenceId)
          const ready = this.transitionGroupAccount(row, "agreement_pending", {
            signingUrl: url,
          })
          if (!ready)
            return this.groupPending(fingerprint, row.sequence, row.stage)
          return {
            outcome: "ready",
            groupFingerprint: fingerprint,
            accountSequence: row.sequence,
            signingUrl: url,
            reused: false,
          }
        }
      }
      const pending = this.transitionGroupAccount(row, "link_reconciling", {
        errorCode: "link_outcome_reconcile",
      })
      return this.groupPending(
        fingerprint,
        row.sequence,
        pending?.stage ?? row.stage
      )
    }

    if (row.stage === "link_reconciling" && row.document_id) {
      let documents: GhlDocument[]
      try {
        documents = await listAllDocuments(this.env)
      } catch {
        return this.groupPending(fingerprint, row.sequence, row.stage)
      }
      const expectedName = this.groupDocumentName(group, fingerprint, account)
      const sent = documents.filter(
        (document) =>
          document.documentId === row.document_id &&
          document.name === expectedName &&
          ["sent", "viewed"].includes(String(document.status))
      )
      const referenceId =
        sent.length === 1
          ? contactReference(sent[0].links, request.contactId)
          : null
      if (!referenceId)
        return this.groupPending(fingerprint, row.sequence, row.stage)
      const url = signingUrl(this.env, referenceId)
      const ready = this.transitionGroupAccount(row, "agreement_pending", {
        signingUrl: url,
      })
      if (!ready) return this.groupPending(fingerprint, row.sequence, row.stage)
      return {
        outcome: "ready",
        groupFingerprint: fingerprint,
        accountSequence: row.sequence,
        signingUrl: url,
        reused: false,
      }
    }

    return this.groupPending(fingerprint, row.sequence, row.stage)
  }

  async resumeOnboardingGroup(request: {
    contactId: string
    groupFingerprint: string
  }): Promise<OnboardingGroupResumeResult> {
    const groupRow = this.groupRow()
    if (
      !groupRow ||
      groupRow.fingerprint !== request.groupFingerprint ||
      groupRow.stage === "conflict"
    ) {
      return {
        outcome: "conflict",
        message:
          "This signer already has a different active onboarding group. Contact RevFactor before continuing.",
      }
    }
    const group = JSON.parse(groupRow.group_json) as FrozenOnboardingGroup
    if (group.contactId !== request.contactId) {
      return {
        outcome: "conflict",
        message:
          "This signer already has a different active onboarding group. Contact RevFactor before continuing.",
      }
    }
    let row = this.groupAccounts().find(
      (candidate) => candidate.stage !== "complete"
    )
    if (!row) {
      if (groupRow.stage !== "complete")
        this.transitionGroup(groupRow, "complete")
      return {
        outcome: "ready",
        nextAction: {
          kind: "onboarding",
          url: requiredGroupConfig(this.env, "HIGHLEVEL_ONBOARDING_FINAL_URL"),
        },
      }
    }
    const account = JSON.parse(row.account_json) as FrozenBillingAccount

    if (row.stage === "manual_review") {
      return { outcome: "manual_review", accountSequence: row.sequence }
    }
    if (row.stage === "agreement_pending" && row.document_id) {
      let documents: GhlDocument[]
      try {
        documents = await listAllDocuments(this.env)
      } catch {
        return {
          outcome: "ready",
          nextAction: {
            kind: "awaiting_provider",
            accountSequence: row.sequence,
          },
        }
      }
      const matches = documents.filter(
        (document) => document.documentId === row!.document_id
      )
      if (matches.length !== 1) {
        return {
          outcome: "ready",
          nextAction: {
            kind: "awaiting_provider",
            accountSequence: row.sequence,
          },
        }
      }
      const document = matches[0]
      const revision = Number(document.documentRevision)
      const signedAt =
        typeof document.updatedAt === "string" ? document.updatedAt : ""
      const signed = ["completed", "accepted", "signed"].includes(
        String(document.status)
      )
      const recipientSigned = document.recipients?.some(
        (recipient) =>
          recipient.id === request.contactId && recipient.hasCompleted === true
      )
      const exactName =
        document.name ===
        this.groupDocumentName(group, groupRow.fingerprint, account)
      const opportunityMatches =
        document.opportunityId === undefined ||
        document.opportunityId === row.opportunity_id
      if (!signed || !recipientSigned) {
        return {
          outcome: "ready",
          nextAction: {
            kind: "agreement",
            accountSequence: row.sequence,
            url: row.signing_url!,
          },
        }
      }
      if (
        !exactName ||
        !opportunityMatches ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        !Number.isFinite(Date.parse(signedAt))
      ) {
        const review = this.transitionGroupAccount(row, "manual_review", {
          errorCode: "signed_agreement_identity_conflict",
        })
        return {
          outcome: "manual_review",
          accountSequence: review?.sequence ?? row.sequence,
        }
      }
      const advanced = this.transitionGroupAccount(row, "agreement_signed")
      if (advanced) row = advanced
      else {
        row = this.groupAccounts()[account.sequence - 1]
      }
    }

    if (
      row.stage === "agreement_signed" &&
      row.opportunity_id &&
      row.document_id
    ) {
      const documents = await listAllDocuments(this.env)
      const document = documents.find(
        (candidate) => candidate.documentId === row!.document_id
      )
      if (!document) {
        return {
          outcome: "ready",
          nextAction: {
            kind: "awaiting_provider",
            accountSequence: row.sequence,
          },
        }
      }
      const checkout = await hubOnboardingPost(
        this.env,
        "/api/internal/onboarding/checkout",
        {
          groupFingerprint: groupRow.fingerprint,
          billingMode: group.billingMode,
          contactName: group.contactName,
          email: group.email,
          totalListingCount: group.totalListingCount,
          pricingProgram: group.pricingProgram,
          contactId: group.contactId,
          opportunityId: row.opportunity_id,
          documentId: row.document_id,
          documentRevision: Number(document.documentRevision),
          signedAt: document.updatedAt,
          account: {
            sequence: account.sequence,
            legalBusinessName: account.legalBusinessName,
            listingQuantity: account.listingQuantity,
            monthlyRateCents: account.monthlyRateCents,
            monthlyAmountCents: account.monthlyAmountCents,
            onboardingFeeCents: account.onboardingFeeCents,
            initialCheckoutTotalCents: account.initialCheckoutTotalCents,
          },
        }
      )
      if (
        typeof checkout.checkoutUrl !== "string" ||
        typeof checkout.checkoutSessionId !== "string"
      ) {
        throw new Error("Hub did not return a canonical checkout")
      }
      const pending = this.transitionGroupAccount(row, "payment_pending", {
        checkoutUrl: checkout.checkoutUrl,
      })
      if (pending) row = pending
      else row = this.groupAccounts()[account.sequence - 1]
      return {
        outcome: "ready",
        nextAction: {
          kind: "payment",
          accountSequence: row.sequence,
          url: row.checkout_url ?? checkout.checkoutUrl,
        },
      }
    }

    if (row.stage === "payment_pending") {
      const status = await hubOnboardingPost(
        this.env,
        "/api/internal/onboarding/status",
        {
          groupFingerprint: groupRow.fingerprint,
          accountSequence: row.sequence,
        }
      )
      if (
        status.state === "complete" &&
        typeof status.stripeCustomerId === "string" &&
        typeof status.stripeSubscriptionId === "string"
      ) {
        const verified = this.transitionGroupAccount(row, "payment_verified", {
          stripeCustomerId: status.stripeCustomerId,
          stripeSubscriptionId: status.stripeSubscriptionId,
        })
        if (verified) row = verified
        else row = this.groupAccounts()[account.sequence - 1]
      } else {
        return {
          outcome: "ready",
          nextAction: row.checkout_url
            ? {
                kind: "payment",
                accountSequence: row.sequence,
                url: row.checkout_url,
              }
            : {
                kind: "awaiting_provider",
                accountSequence: row.sequence,
              },
        }
      }
    }

    if (row.stage === "payment_verified") {
      const completed = this.transitionGroupAccount(row, "complete")
      if (!completed) {
        return {
          outcome: "ready",
          nextAction: {
            kind: "awaiting_provider",
            accountSequence: row.sequence,
          },
        }
      }
    }

    const next = await this.processOnboardingGroup({
      contactId: group.contactId,
      input: {
        billingMode: group.billingMode,
        contactName: group.contactName,
        email: group.email,
        phone: null,
        totalListingCount: group.totalListingCount,
        legalBusinessNames: group.accounts.map(
          (candidate) => candidate.legalBusinessName
        ),
        pricingProgram: group.pricingProgram,
      },
    })
    if (next.outcome === "conflict") return next
    if (next.outcome === "ready") {
      return {
        outcome: "ready",
        nextAction: {
          kind: "agreement",
          accountSequence: next.accountSequence,
          url: next.signingUrl,
        },
      }
    }
    if (next.stage === "complete") {
      return {
        outcome: "ready",
        nextAction: {
          kind: "onboarding",
          url: requiredGroupConfig(this.env, "HIGHLEVEL_ONBOARDING_FINAL_URL"),
        },
      }
    }
    return {
      outcome: "ready",
      nextAction: {
        kind: "awaiting_provider",
        accountSequence: next.accountSequence,
      },
    }
  }

  // This RPC is intentionally not exposed by the public fetch handler. A
  // server-side GHL/Stripe verifier may call it only after provider retrieval.
  async applyVerifiedAccountProgress(input: {
    groupFingerprint: string
    accountSequence: number
    expectedStage:
      | "agreement_pending"
      | "agreement_signed"
      | "payment_pending"
      | "payment_verified"
    nextStage:
      | "agreement_signed"
      | "payment_pending"
      | "payment_verified"
      | "complete"
    documentId?: string
    checkoutUrl?: string
    stripeCustomerId?: string
    stripeSubscriptionId?: string
  }) {
    const groupRow = this.groupRow()
    if (!groupRow || groupRow.fingerprint !== input.groupFingerprint) {
      throw new Error("Onboarding group identity mismatch")
    }
    const row = this.groupAccounts().find(
      (candidate) => candidate.sequence === input.accountSequence
    )
    if (!row || row.stage !== input.expectedStage) {
      throw new Error("Billing account stage changed concurrently")
    }
    if (input.documentId && row.document_id !== input.documentId) {
      throw new Error("Verified agreement identity mismatch")
    }
    const legal: Record<string, string[]> = {
      agreement_pending: ["agreement_signed"],
      agreement_signed: ["payment_pending"],
      payment_pending: ["payment_verified"],
      payment_verified: ["complete"],
    }
    if (!legal[input.expectedStage].includes(input.nextStage)) {
      throw new Error("Illegal verified billing-account transition")
    }
    const next = this.transitionGroupAccount(row, input.nextStage, {
      checkoutUrl: input.checkoutUrl,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
    })
    if (!next) throw new Error("Billing account stage changed concurrently")
    return next
  }

  async processAgreement(
    request: AgreementClaimRequest
  ): Promise<AgreementClaimResult> {
    const revision = buildAgreementRevision(this.env, request)
    const revisionJson = JSON.stringify(revision)
    const fingerprint = await agreementRevisionFingerprint(revision)
    const now = Date.now()
    let row = claimRows(this.sql)[0]

    if (!row) {
      this.sql.exec(
        `INSERT INTO agreement_claim
          (fingerprint, revision_json, stage, created_at, updated_at)
         VALUES (?, ?, 'claimed', ?, ?)`,
        fingerprint,
        revisionJson,
        now,
        now
      )
      this.event("claimed", "claim_created")
      row = claimRows(this.sql)[0]
    }
    if (!row) throw new Error("Agreement claim was not created")

    if (row.fingerprint !== fingerprint || row.revision_json !== revisionJson) {
      return this.revisionConflict("revision_mismatch")
    }
    if (row.stage === "completed" && row.document_id && row.signing_url) {
      this.event("completed", "exact_replay")
      return {
        outcome: "completed",
        documentId: row.document_id,
        signingUrl: row.signing_url,
        reused: true,
      }
    }
    if (row.stage === "conflict") return this.conflict(row, "claim_conflict")

    const staleRecovery: Partial<Record<ClaimStage, ClaimStage>> = {
      preflight_scanning: "claimed",
      template_creating: "template_reconciling",
      template_reconcile_scanning: "template_reconciling",
      link_creating: "link_reconciling",
      link_reconcile_scanning: "link_reconciling",
    }
    const recoveryStage = staleRecovery[row.stage]
    if (recoveryStage && now - row.updated_at >= ACTION_STALE_AFTER_MS) {
      const recovered = this.transition(row, recoveryStage, {
        errorCode:
          row.stage === "preflight_scanning"
            ? "stale_preflight_rescan"
            : "stale_operation_reconcile",
      })
      if (!recovered) return this.currentResult()
      row = recovered
    }

    if (
      row.stage === "preflight_scanning" ||
      row.stage === "commercial_writing" ||
      row.stage === "template_creating" ||
      row.stage === "template_reconcile_scanning" ||
      row.stage === "link_creating" ||
      row.stage === "link_reconcile_scanning"
    ) {
      return stageResult(row)
    }

    if (row.stage === "claimed") {
      const scanning = this.transition(row, "preflight_scanning")
      if (!scanning) return this.currentResult()
      row = scanning
      let documents: GhlDocument[]
      try {
        documents = await this.scan(revision)
      } catch {
        const retryable = this.transition(row, "claimed", {
          errorCode: "preflight_lookup_failed",
        })
        return retryable ? stageResult(retryable) : this.currentResult()
      }
      if (documents.length > 0) {
        return this.conflict(row, "preexisting_agreement")
      }
      const clear = this.transition(row, "preflight_clear")
      if (!clear) return this.currentResult()
      row = clear
    }

    if (row.stage === "preflight_clear") {
      const writing = this.transition(row, "commercial_writing")
      if (!writing) return this.currentResult()
      row = writing
      try {
        const confirmedContactId = await upsertContact(
          this.env,
          request.input,
          true
        )
        if (confirmedContactId !== revision.contactId) {
          return this.conflict(row, "contact_identity_conflict")
        }
      } catch {
        const ambiguous = this.transition(row, "commercial_writing", {
          errorCode: "commercial_write_ambiguous",
        })
        return ambiguous ? stageResult(ambiguous) : this.currentResult()
      }
      const written = this.transition(row, "commercial_written")
      if (!written) return this.currentResult()
      row = written
    }

    if (row.stage === "commercial_written") {
      const creating = this.transition(row, "template_creating")
      if (!creating) return this.currentResult()
      row = creating
      try {
        await ghlFetch(this.env, "/proposals/templates/send", {
          method: "POST",
          body: JSON.stringify({
            templateId: revision.templateId,
            userId: this.env.HIGHLEVEL_ONBOARDING_SENDER_USER_ID,
            sendDocument: false,
            locationId: this.env.HIGHLEVEL_LOCATION_ID,
            contactId: revision.contactId,
          }),
        })
      } catch {
        // GHL may have committed before the response was lost. Never create
        // again; every subsequent attempt is read-only reconciliation.
      }
      const reconciling = this.transition(row, "template_reconciling", {
        errorCode: "template_outcome_reconcile",
      })
      if (!reconciling) return this.currentResult()
      row = reconciling
    }

    if (row.stage === "template_reconciling") {
      const scanning = this.transition(row, "template_reconcile_scanning")
      if (!scanning) return this.currentResult()
      row = scanning
      let documents: GhlDocument[]
      try {
        documents = await this.scan(revision)
      } catch {
        const retryable = this.transition(row, "template_reconciling", {
          errorCode: "template_lookup_failed",
        })
        return retryable ? stageResult(retryable) : this.currentResult()
      }
      const drafts = documents.filter(
        (document) =>
          document.status === "draft" &&
          typeof document.name === "string" &&
          document.name.startsWith(revision.templateName)
      )
      if (drafts.length === 0) {
        const pending = this.transition(row, "template_reconciling", {
          errorCode: "template_not_visible",
        })
        return pending ? stageResult(pending) : this.currentResult()
      }
      if (drafts.length !== 1) {
        return this.conflict(row, "ambiguous_template_drafts")
      }
      const found = this.transition(row, "draft_found", {
        documentId: String(drafts[0].documentId),
      })
      if (!found) return this.currentResult()
      row = found
    }

    if (row.stage === "draft_found" && row.document_id) {
      const draftDocumentId = row.document_id
      const creating = this.transition(row, "link_creating")
      if (!creating) return this.currentResult()
      row = creating
      let response: Response | null = null
      try {
        response = await ghlFetch(this.env, "/proposals/document/send", {
          method: "POST",
          body: JSON.stringify({
            locationId: this.env.HIGHLEVEL_LOCATION_ID,
            documentId: draftDocumentId,
            documentName: agreementDocumentName(revision, fingerprint),
            medium: "link",
            sentBy: this.env.HIGHLEVEL_ONBOARDING_SENDER_USER_ID,
          }),
        })
      } catch {
        // Same rule as template creation: reconcile; never send again.
      }
      if (response) {
        const payload = (await response.json()) as { links?: DocumentLink[] }
        const referenceId = contactReference(payload.links, revision.contactId)
        if (referenceId) {
          const url = signingUrl(this.env, referenceId)
          const completed = this.transition(row, "completed", {
            documentId: draftDocumentId,
            signingUrl: url,
          })
          if (!completed) return this.currentResult()
          return {
            outcome: "completed",
            documentId: draftDocumentId,
            signingUrl: url,
            reused: false,
          }
        }
      }
      const reconciling = this.transition(row, "link_reconciling", {
        errorCode: "link_outcome_reconcile",
      })
      if (!reconciling) return this.currentResult()
      row = reconciling
    }

    if (row.stage === "link_reconciling" && row.document_id) {
      const reconcilingDocumentId = row.document_id
      const scanning = this.transition(row, "link_reconcile_scanning")
      if (!scanning) return this.currentResult()
      row = scanning
      let documents: GhlDocument[]
      try {
        documents = await this.scan(revision)
      } catch {
        const retryable = this.transition(row, "link_reconciling", {
          errorCode: "link_lookup_failed",
        })
        return retryable ? stageResult(retryable) : this.currentResult()
      }
      const expectedName = agreementDocumentName(revision, fingerprint)
      const sent = documents.filter(
        (document) =>
          document.documentId === reconcilingDocumentId &&
          document.name === expectedName &&
          ["sent", "viewed"].includes(String(document.status))
      )
      const referenceId =
        sent.length === 1
          ? contactReference(sent[0].links, revision.contactId)
          : null
      if (!referenceId) {
        const pending = this.transition(row, "link_reconciling", {
          errorCode: "link_not_visible",
        })
        return pending ? stageResult(pending) : this.currentResult()
      }
      const url = signingUrl(this.env, referenceId)
      const completed = this.transition(row, "completed", {
        documentId: reconcilingDocumentId,
        signingUrl: url,
      })
      if (!completed) return this.currentResult()
      return {
        outcome: "completed",
        documentId: reconcilingDocumentId,
        signingUrl: url,
        reused: false,
      }
    }

    return this.currentResult()
  }
}

async function addTag(
  env: Env,
  contactId: string,
  pricingProgram: PricingProgram
) {
  await ghlFetch(env, `/contacts/${contactId}/tags`, {
    method: "POST",
    body: JSON.stringify({
      tags: [
        pricingProgram === "Referral"
          ? "rf-referral-inline-agreement"
          : "rf-standard-inline-agreement",
      ],
    }),
  })
}

export async function issueGroupResumeToken(
  env: Env,
  contactId: string,
  groupFingerprint: string
) {
  const secret = requiredGroupConfig(
    env,
    "HIGHLEVEL_ONBOARDING_RESUME_HMAC_SECRET"
  )
  const payload = btoa(
    JSON.stringify({
      v: 1,
      c: contactId,
      g: groupFingerprint,
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    })
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  )
  const encodedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
  return `${payload}.${encodedSignature}`
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

export function readGroupResumeTokenClaims(token: string) {
  if (token.length > 4096) throw new Error("Invalid onboarding resume token")
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid onboarding resume token")
  }
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])))
  } catch {
    throw new Error("Invalid onboarding resume token")
  }
  if (
    !isRecord(payload) ||
    payload.v !== 1 ||
    typeof payload.c !== "string" ||
    payload.c.length < 1 ||
    payload.c.length > 100 ||
    typeof payload.g !== "string" ||
    !/^[a-f0-9]{64}$/.test(payload.g) ||
    !Number.isSafeInteger(payload.exp)
  ) {
    throw new Error("Invalid onboarding resume token")
  }
  return {
    contactId: payload.c,
    groupFingerprint: payload.g,
    expiresAt: Number(payload.exp),
  }
}

export async function verifyGroupResumeToken(
  env: Env,
  token: string,
  expected: { contactId: string; groupFingerprint: string },
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid onboarding resume token")
  }
  const secret = requiredGroupConfig(
    env,
    "HIGHLEVEL_ONBOARDING_RESUME_HMAC_SECRET"
  )
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  )
  let verified = false
  try {
    verified = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(parts[1]),
      new TextEncoder().encode(parts[0])
    )
  } catch {
    verified = false
  }
  if (!verified) throw new Error("Invalid onboarding resume token")

  const payload = readGroupResumeTokenClaims(token)
  if (
    payload.contactId !== expected.contactId ||
    payload.groupFingerprint !== expected.groupFingerprint ||
    payload.expiresAt <= nowSeconds
  ) {
    throw new Error("Invalid or expired onboarding resume token")
  }
  return payload
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin")
    if (origin !== env.HIGHLEVEL_ONBOARDING_ALLOWED_ORIGIN) {
      return new Response("Origin not allowed", { status: 403 })
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) })
    }
    if (request.method !== "POST") {
      return json(env, { error: "Method not allowed" }, 405)
    }

    try {
      const body = await request.json()
      const pathname = new URL(request.url).pathname
      if (pathname === "/v2/groups/resume") {
        if (!isRecord(body) || typeof body.resumeToken !== "string") {
          throw new Error("Invalid onboarding resume token")
        }
        const claims = readGroupResumeTokenClaims(body.resumeToken)
        await verifyGroupResumeToken(env, body.resumeToken, {
          contactId: claims.contactId,
          groupFingerprint: claims.groupFingerprint,
        })
        const result = await env.AGREEMENT_CLAIMS.getByName(
          `group:${claims.contactId}`
        ).resumeOnboardingGroup({
          contactId: claims.contactId,
          groupFingerprint: claims.groupFingerprint,
        })
        if (result.outcome === "conflict") {
          return json(env, { error: result.message }, 409)
        }
        if (result.outcome === "manual_review") {
          return json(
            env,
            {
              error:
                "This onboarding needs a RevFactor review before it can continue.",
              accountSequence: result.accountSequence,
            },
            409
          )
        }
        return json(env, { success: true, nextAction: result.nextAction })
      }
      if (pathname === "/v2/groups/quote") {
        if (!isRecord(body)) throw new Error("Invalid submission")
        const billingMode = body.billingMode
        const totalListingCount = Number(body.totalListingCount)
        if (
          (billingMode !== "single" &&
            billingMode !== "separate_per_listing") ||
          !Number.isInteger(totalListingCount) ||
          totalListingCount < 1 ||
          totalListingCount > 5
        ) {
          throw new Error("Choose a valid billing setup and listing count")
        }
        const accountCount = billingMode === "single" ? 1 : totalListingCount
        const input: GroupSignup = {
          billingMode,
          contactName: "Quote Only",
          email: "quote-only@revfactor.invalid",
          phone: null,
          totalListingCount,
          legalBusinessNames: Array.from(
            { length: accountCount },
            (_, index) => `Quote Business ${index + 1}`
          ),
          pricingProgram: resolvePricingProgram(
            body.referralCode,
            env.HIGHLEVEL_ONBOARDING_REFERRAL_CODES
          ),
        }
        const group = freezeOnboardingGroup({
          contactId: "quote-only",
          signup: input,
        })
        return json(env, {
          success: true,
          billingMode: group.billingMode,
          totalListingCount: group.totalListingCount,
          pricingProgram: group.pricingProgram,
          onboardingFeeTotalCents: group.onboardingFeeTotalCents,
          accounts: group.accounts.map((account) => ({
            sequence: account.sequence,
            legalBusinessName: account.legalBusinessName,
            listingQuantity: account.listingQuantity,
            monthlyRateCents: account.monthlyRateCents,
            monthlyAmountCents: account.monthlyAmountCents,
            onboardingFeeCents: account.onboardingFeeCents,
            initialCheckoutTotalCents: account.initialCheckoutTotalCents,
          })),
        })
      }
      if (pathname === "/v2/groups/start") {
        const input = parseGroupSignup(body, env)
        const identityInput: Signup = {
          legalName: input.legalBusinessNames[0],
          contactName: input.contactName,
          email: input.email,
          phone: input.phone,
          primaryListingQuantity: input.totalListingCount,
          pricingProgram: input.pricingProgram,
        }
        const contactId = await upsertContact(env, identityInput, false)
        const result = await env.AGREEMENT_CLAIMS.getByName(
          `group:${contactId}`
        ).processOnboardingGroup({ contactId, input })
        if (result.outcome === "conflict") {
          return json(env, { error: result.message }, 409)
        }
        if (result.outcome === "pending") {
          const response = json(
            env,
            {
              error:
                "Your onboarding group is still being prepared. Please try again in a moment.",
              stage: result.stage,
              accountSequence: result.accountSequence,
            },
            503
          )
          response.headers.set("Retry-After", String(result.retryAfterSeconds))
          return response
        }
        const resumeToken = await issueGroupResumeToken(
          env,
          contactId,
          result.groupFingerprint
        )
        return json(env, {
          success: true,
          resumeToken,
          nextAction: {
            kind: "agreement",
            accountSequence: result.accountSequence,
            url: result.signingUrl,
          },
          reused: result.reused,
        })
      }
      if (pathname === "/quote") {
        if (!isRecord(body)) throw new Error("Invalid submission")
        const primaryListingQuantity = Number(body.primaryListingQuantity)
        if (
          !Number.isInteger(primaryListingQuantity) ||
          primaryListingQuantity < 1 ||
          primaryListingQuantity > 5
        ) {
          throw new Error("Primary listings must be between 1 and 5")
        }
        const pricingProgram = resolvePricingProgram(
          body.offerCode,
          env.HIGHLEVEL_ONBOARDING_REFERRAL_CODES
        )
        return json(env, {
          success: true,
          ...serviceValues({ primaryListingQuantity, pricingProgram }),
        })
      }
      if (pathname !== "/") {
        return json(env, { error: "Not found" }, 404)
      }

      const input = parseSignup(body, env)
      const contactId = await upsertContact(env, input, false)
      const agreement = await env.AGREEMENT_CLAIMS.getByName(
        contactId
      ).processAgreement({ contactId, input })
      if (agreement.outcome === "conflict") {
        return json(env, { error: agreement.message }, 409)
      }
      if (agreement.outcome === "pending") {
        const response = json(
          env,
          {
            error:
              "Your agreement is still being prepared. Please try again in a moment.",
            stage: agreement.stage,
          },
          503
        )
        response.headers.set("Retry-After", String(agreement.retryAfterSeconds))
        return response
      }
      if (!agreement.reused) {
        try {
          await addTag(env, contactId, input.pricingProgram)
        } catch (error) {
          console.warn(
            "[ghl-inline-onboarding] agreement created but tag update failed",
            error instanceof Error ? error.message : error
          )
        }
      }
      return json(env, {
        success: true,
        signingUrl: agreement.signingUrl,
        reused: agreement.reused,
      })
    } catch (error) {
      console.error(
        "[ghl-inline-onboarding] request failed",
        error instanceof Error ? error.message : error
      )
      const message =
        error instanceof Error && !error.message.startsWith("HighLevel")
          ? error.message
          : "We could not prepare the agreement. Please try again."
      return json(env, { error: message }, 400)
    }
  },
}

export default worker
