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
}

export type PricingProgram = "Regular" | "Referral"

type Signup = {
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
      companyName: input.legalName,
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

async function listDocuments(env: Env, query: string) {
  const params = new URLSearchParams({
    locationId: env.HIGHLEVEL_LOCATION_ID,
    limit: "20",
    query,
  })
  const response = await ghlFetch(
    env,
    `/proposals/document?${params.toString()}`,
    { method: "GET" }
  )
  return (await response.json()) as { documents?: GhlDocument[] }
}

function matchingDocument(
  documents: GhlDocument[] | undefined,
  contactId: string,
  templateName: string,
  statuses: string[]
): GhlDocument | null {
  return (
    documents
      ?.filter(
        (document) =>
          typeof document.documentId === "string" &&
          typeof document.name === "string" &&
          document.name.startsWith(templateName) &&
          typeof document.status === "string" &&
          statuses.includes(document.status) &&
          document.recipients?.some((recipient) => recipient.id === contactId)
      )
      .sort((left, right) =>
        String(right.createdAt ?? "").localeCompare(
          String(left.createdAt ?? "")
        )
      )[0] ?? null
  )
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
      competingTemplateName: env.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME,
    }
  }
  return {
    templateId: env.HIGHLEVEL_ONBOARDING_TEMPLATE_ID,
    templateName: env.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME,
    competingTemplateName: env.HIGHLEVEL_ONBOARDING_REFERRAL_TEMPLATE_NAME,
  }
}

export function agreementDocumentName(input: Signup, templateName: string) {
  return `${templateName} — ${input.contactName} — q${input.primaryListingQuantity}`
}

async function prepareAgreement(env: Env, input: Signup, contactId: string) {
  const { templateId, templateName, competingTemplateName } = agreementTemplate(
    env,
    input.pricingProgram
  )
  const documents = (await listDocuments(env, input.contactName)).documents
  const expectedDocumentName = agreementDocumentName(input, templateName)
  const existing = matchingDocument(documents, contactId, templateName, [
    "sent",
    "viewed",
  ])
  const existingReference = contactReference(existing?.links, contactId)
  if (
    existingReference &&
    existing?.name === expectedDocumentName &&
    typeof existing.documentId === "string"
  ) {
    return {
      documentId: existing.documentId,
      signingUrl: signingUrl(env, existingReference),
      reused: true,
    }
  }

  const completed = matchingDocument(documents, contactId, templateName, [
    "completed",
    "signed",
    "accepted",
  ])
  const competing = matchingDocument(
    documents,
    contactId,
    competingTemplateName,
    ["draft", "sent", "viewed", "completed", "signed", "accepted"]
  )
  const reusableDraft = matchingDocument(documents, contactId, templateName, [
    "draft",
  ])
  const mismatchedDraft =
    reusableDraft && reusableDraft.name !== expectedDocumentName
      ? reusableDraft
      : null
  if (completed || competing || existing || mismatchedDraft) {
    throw new Error(
      "An agreement already exists for this contact. Contact RevFactor before continuing."
    )
  }

  const confirmedContactId = await upsertContact(env, input, true)
  if (confirmedContactId !== contactId) {
    throw new Error("HighLevel returned a conflicting contact identity")
  }

  let draft: GhlDocument | null = reusableDraft
  if (!draft) {
    await ghlFetch(env, "/proposals/templates/send", {
      method: "POST",
      body: JSON.stringify({
        templateId,
        userId: env.HIGHLEVEL_ONBOARDING_SENDER_USER_ID,
        sendDocument: false,
        locationId: env.HIGHLEVEL_LOCATION_ID,
        contactId,
      }),
    })

    for (let attempt = 0; attempt < 4 && !draft; attempt += 1) {
      draft = matchingDocument(
        (await listDocuments(env, input.contactName)).documents,
        contactId,
        templateName,
        ["draft"]
      )
      if (!draft)
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
    }
  }
  if (!draft || typeof draft.documentId !== "string") {
    throw new Error("HighLevel did not create the agreement draft")
  }

  const response = await ghlFetch(env, "/proposals/document/send", {
    method: "POST",
    body: JSON.stringify({
      locationId: env.HIGHLEVEL_LOCATION_ID,
      documentId: draft.documentId,
      documentName: expectedDocumentName,
      medium: "link",
      sentBy: env.HIGHLEVEL_ONBOARDING_SENDER_USER_ID,
    }),
  })
  const payload = (await response.json()) as { links?: DocumentLink[] }
  const referenceId = contactReference(payload.links, contactId)
  if (!referenceId)
    throw new Error("HighLevel returned no contact signing link")

  return {
    documentId: draft.documentId,
    signingUrl: signingUrl(env, referenceId),
    reused: false,
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
      const contactId = await upsertContact(env, input)
      const agreement = await prepareAgreement(env, input, contactId)
      try {
        await addTag(env, contactId, input.pricingProgram)
      } catch (error) {
        console.warn(
          "[ghl-inline-onboarding] agreement created but tag update failed",
          error instanceof Error ? error.message : error
        )
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
