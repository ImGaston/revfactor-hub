type Env = {
  HIGHLEVEL_API_KEY: string
  HIGHLEVEL_LOCATION_ID: string
  HIGHLEVEL_ONBOARDING_TEMPLATE_ID: string
  HIGHLEVEL_ONBOARDING_CHILD_TEMPLATE_ID?: string
  HIGHLEVEL_ONBOARDING_SENDER_USER_ID: string
  HIGHLEVEL_ONBOARDING_TEMPLATE_NAME: string
  HIGHLEVEL_ONBOARDING_CHILD_TEMPLATE_NAME?: string
  HIGHLEVEL_DOCUMENT_SIGNING_BASE_URL: string
  HIGHLEVEL_ONBOARDING_ALLOWED_ORIGIN: string
}

type Signup = {
  legalName: string
  contactName: string
  email: string
  phone: string | null
  primaryListingQuantity: number
  childListingQuantity: number
  serviceStartMode: "immediate" | "scheduled"
  serviceStartDate: string | null
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

function parseSignup(body: unknown): Signup {
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
  const childListingQuantity = Number(body.childListingQuantity)
  const serviceStartMode = body.serviceStartMode
  const serviceStartDate =
    typeof body.serviceStartDate === "string" && body.serviceStartDate
      ? body.serviceStartDate
      : null

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
  if (
    !Number.isInteger(childListingQuantity) ||
    childListingQuantity < 0 ||
    childListingQuantity > 5
  ) {
    throw new Error("Child listings must be between 0 and 5")
  }
  if (serviceStartMode !== "immediate" && serviceStartMode !== "scheduled") {
    throw new Error("Choose when service should start")
  }
  if (serviceStartMode === "scheduled") {
    if (!serviceStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceStartDate)) {
      throw new Error("Choose a valid service start date")
    }
    const today = new Date()
    const minimum = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + 3
      )
    )
      .toISOString()
      .slice(0, 10)
    const maximum = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + 120
      )
    )
      .toISOString()
      .slice(0, 10)
    if (serviceStartDate < minimum || serviceStartDate > maximum) {
      throw new Error(`Choose a service date between ${minimum} and ${maximum}`)
    }
  }

  return {
    legalName,
    contactName,
    email,
    phone,
    primaryListingQuantity,
    childListingQuantity,
    serviceStartMode,
    serviceStartDate:
      serviceStartMode === "scheduled" ? serviceStartDate : null,
  }
}

function serviceValues(input: Signup) {
  const primaryMonthlyAmount = input.primaryListingQuantity * 350
  const childMonthlyAmount = input.childListingQuantity * 50
  const monthlyServiceFee = primaryMonthlyAmount + childMonthlyAmount
  const onboardingFee = 150
  const initialCheckoutTotal =
    input.serviceStartMode === "scheduled"
      ? onboardingFee
      : monthlyServiceFee + onboardingFee
  const formattedStart = input.serviceStartDate
    ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${input.serviceStartDate}T12:00:00.000Z`))
    : null

  return {
    primaryMonthlyAmount,
    childMonthlyAmount,
    monthlyServiceFee,
    onboardingFee,
    initialCheckoutTotal,
    pricingProgram: formattedStart
      ? `Regular - Monthly service begins ${formattedStart}`
      : "Regular",
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

async function upsertContact(env: Env, input: Signup): Promise<string> {
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
      customFields: [
        { key: "contact.rf_client_legal_name", fieldValue: input.legalName },
        {
          key: "contact.rf_primary_listing_quantity",
          fieldValue: String(input.primaryListingQuantity),
        },
        {
          key: "contact.rf_child_listing_quantity",
          fieldValue: String(input.childListingQuantity),
        },
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
        {
          key: "contact.rf_service_start_mode",
          fieldValue: input.serviceStartMode,
        },
        {
          key: "contact.rf_service_start_date",
          fieldValue: input.serviceStartDate ?? "",
        },
        {
          key: "contact.rf_agreement_effective_date",
          fieldValue: new Date().toISOString().slice(0, 10),
        },
      ],
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

async function prepareAgreement(env: Env, input: Signup, contactId: string) {
  const hasChildListings = input.childListingQuantity > 0
  const templateId = hasChildListings
    ? env.HIGHLEVEL_ONBOARDING_CHILD_TEMPLATE_ID ??
      env.HIGHLEVEL_ONBOARDING_TEMPLATE_ID
    : env.HIGHLEVEL_ONBOARDING_TEMPLATE_ID
  const templateName = hasChildListings
    ? env.HIGHLEVEL_ONBOARDING_CHILD_TEMPLATE_NAME ??
      env.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME
    : env.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME
  const existing = matchingDocument(
    (await listDocuments(env, input.contactName)).documents,
    contactId,
    templateName,
    ["sent", "viewed"]
  )
  const existingReference = contactReference(existing?.links, contactId)
  if (existingReference && typeof existing?.documentId === "string") {
    return {
      documentId: existing.documentId,
      signingUrl: signingUrl(env, existingReference),
      reused: true,
    }
  }

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

  let draft: GhlDocument | null = null
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
  if (!draft || typeof draft.documentId !== "string") {
    throw new Error("HighLevel did not create the agreement draft")
  }

  const response = await ghlFetch(env, "/proposals/document/send", {
    method: "POST",
    body: JSON.stringify({
      locationId: env.HIGHLEVEL_LOCATION_ID,
      documentId: draft.documentId,
      documentName: `${templateName} — ${input.contactName}`,
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

async function addTag(env: Env, contactId: string) {
  await ghlFetch(env, `/contacts/${contactId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags: ["rf-standard-inline-agreement"] }),
  })
}

export default {
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
      const input = parseSignup(await request.json())
      const contactId = await upsertContact(env, input)
      const agreement = await prepareAgreement(env, input, contactId)
      try {
        await addTag(env, contactId)
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
