import {
  DurableObject,
  type DurableObjectNamespace,
  type DurableObjectState,
  type SqlStorage,
} from "cloudflare:workers"

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
  recipients?: Array<{ id?: unknown }>
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
  | "draft_found"
  | "link_creating"
  | "link_reconciling"
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
}

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
            'template_creating', 'template_reconciling', 'draft_found',
            'link_creating', 'link_reconciling', 'completed', 'conflict'
          )),
          document_id TEXT,
          signing_url TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_error_code TEXT
        );
        CREATE TABLE IF NOT EXISTS claim_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stage TEXT NOT NULL,
          result_code TEXT NOT NULL,
          created_at INTEGER NOT NULL
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
    fingerprint: string,
    stage: ClaimStage,
    fields: {
      documentId?: string | null
      signingUrl?: string | null
      errorCode?: string | null
    } = {}
  ): ClaimRow {
    this.sql.exec(
      `UPDATE agreement_claim
       SET stage = ?, document_id = COALESCE(?, document_id),
           signing_url = COALESCE(?, signing_url), updated_at = ?,
           last_error_code = ?
       WHERE fingerprint = ?`,
      stage,
      fields.documentId ?? null,
      fields.signingUrl ?? null,
      Date.now(),
      fields.errorCode ?? null,
      fingerprint
    )
    this.event(stage, fields.errorCode ?? "ok")
    const row = claimRows(this.sql)[0]
    if (!row) throw new Error("Agreement claim disappeared")
    return row
  }

  private conflict(row: ClaimRow, code: string): AgreementClaimResult {
    if (row.stage !== "completed" && row.stage !== "conflict") {
      this.transition(row.fingerprint, "conflict", { errorCode: code })
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

    if (
      row.stage === "preflight_scanning" &&
      now - row.updated_at >= ACTION_STALE_AFTER_MS
    ) {
      row = this.transition(fingerprint, "claimed", {
        errorCode: "stale_preflight_rescan",
      })
    }

    if (
      (row.stage === "template_creating" || row.stage === "link_creating") &&
      now - row.updated_at >= ACTION_STALE_AFTER_MS
    ) {
      row = this.transition(
        fingerprint,
        row.stage === "template_creating"
          ? "template_reconciling"
          : "link_reconciling",
        { errorCode: "stale_action_reconcile" }
      )
    }

    if (
      row.stage === "preflight_scanning" ||
      row.stage === "commercial_writing" ||
      row.stage === "template_creating" ||
      row.stage === "link_creating"
    ) {
      return stageResult(row)
    }

    if (row.stage === "claimed") {
      row = this.transition(fingerprint, "preflight_scanning")
      let documents: GhlDocument[]
      try {
        documents = await this.scan(revision)
      } catch {
        row = this.transition(fingerprint, "claimed", {
          errorCode: "preflight_lookup_failed",
        })
        return stageResult(row)
      }
      if (documents.length > 0) {
        return this.conflict(row, "preexisting_agreement")
      }
      row = this.transition(fingerprint, "preflight_clear")
    }

    if (row.stage === "preflight_clear") {
      row = this.transition(fingerprint, "commercial_writing")
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
        row = this.transition(fingerprint, "commercial_writing", {
          errorCode: "commercial_write_ambiguous",
        })
        return stageResult(row)
      }
      row = this.transition(fingerprint, "commercial_written")
    }

    if (row.stage === "commercial_written") {
      row = this.transition(fingerprint, "template_creating")
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
      row = this.transition(fingerprint, "template_reconciling", {
        errorCode: "template_outcome_reconcile",
      })
    }

    if (row.stage === "template_reconciling") {
      let documents: GhlDocument[]
      try {
        documents = await this.scan(revision)
      } catch {
        row = this.transition(fingerprint, "template_reconciling", {
          errorCode: "template_lookup_failed",
        })
        return stageResult(row)
      }
      const drafts = documents.filter(
        (document) =>
          document.status === "draft" &&
          typeof document.name === "string" &&
          document.name.startsWith(revision.templateName)
      )
      if (drafts.length === 0) return stageResult(row)
      if (drafts.length !== 1) {
        return this.conflict(row, "ambiguous_template_drafts")
      }
      row = this.transition(fingerprint, "draft_found", {
        documentId: String(drafts[0].documentId),
      })
    }

    if (row.stage === "draft_found" && row.document_id) {
      const draftDocumentId = row.document_id
      row = this.transition(fingerprint, "link_creating")
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
          this.transition(fingerprint, "completed", {
            documentId: draftDocumentId,
            signingUrl: url,
          })
          return {
            outcome: "completed",
            documentId: draftDocumentId,
            signingUrl: url,
            reused: false,
          }
        }
      }
      row = this.transition(fingerprint, "link_reconciling", {
        errorCode: "link_outcome_reconcile",
      })
    }

    if (row.stage === "link_reconciling" && row.document_id) {
      let documents: GhlDocument[]
      try {
        documents = await this.scan(revision)
      } catch {
        row = this.transition(fingerprint, "link_reconciling", {
          errorCode: "link_lookup_failed",
        })
        return stageResult(row)
      }
      const expectedName = agreementDocumentName(revision, fingerprint)
      const sent = documents.filter(
        (document) =>
          document.documentId === row.document_id &&
          document.name === expectedName &&
          ["sent", "viewed"].includes(String(document.status))
      )
      if (sent.length !== 1) return stageResult(row)
      const referenceId = contactReference(sent[0].links, revision.contactId)
      if (!referenceId) return stageResult(row)
      const url = signingUrl(this.env, referenceId)
      this.transition(fingerprint, "completed", {
        documentId: row.document_id,
        signingUrl: url,
      })
      return {
        outcome: "completed",
        documentId: row.document_id,
        signingUrl: url,
        reused: false,
      }
    }

    return stageResult(row)
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
