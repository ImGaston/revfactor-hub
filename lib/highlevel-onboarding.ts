const HIGHLEVEL_API_BASE = "https://services.leadconnectorhq.com"

const HIGHLEVEL_DOCUMENT_LOCALE = "en-US"

type HighLevelCustomField = {
  key: string
  fieldValue: string
}

type HighLevelContactInput = {
  name: string
  email: string
  phone: string | null
  companyName: string
  source: string
  customFields: HighLevelCustomField[]
}

function highLevelHeaders(): HeadersInit {
  const token = process.env.HIGHLEVEL_API_KEY
  if (!token) throw new Error("HIGHLEVEL_API_KEY is not set")

  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: "v3",
  }
}

async function assertHighLevelResponse(response: Response, operation: string) {
  if (response.ok) return

  const detail = (await response.text()).slice(0, 500)
  throw new Error(`${operation} failed (${response.status}): ${detail}`)
}

type HighLevelDocumentLink = {
  referenceId?: unknown
  recipientId?: unknown
  entityName?: unknown
}

type HighLevelDocument = {
  documentId?: unknown
  name?: unknown
  status?: unknown
  createdAt?: unknown
  recipients?: Array<{ id?: unknown; email?: unknown }>
  links?: HighLevelDocumentLink[]
}

type HighLevelDocumentsResponse = {
  documents?: HighLevelDocument[]
}

function highLevelLocationId(): string {
  const locationId = process.env.HIGHLEVEL_LOCATION_ID
  if (!locationId) throw new Error("HIGHLEVEL_LOCATION_ID is not set")
  return locationId
}

function buildHighLevelSigningUrl(referenceId: string): string {
  const baseUrl =
    process.env.HIGHLEVEL_DOCUMENT_SIGNING_BASE_URL ??
    "https://links.revfactor.io"

  return `${baseUrl.replace(/\/$/, "")}/documents/v1/${encodeURIComponent(referenceId)}?locale=${HIGHLEVEL_DOCUMENT_LOCALE}`
}

function contactSigningReference(
  links: HighLevelDocumentLink[] | undefined,
  contactId: string,
): string | null {
  const link = links?.find(
    (candidate) =>
      candidate.recipientId === contactId &&
      candidate.entityName === "contacts" &&
      typeof candidate.referenceId === "string" &&
      candidate.referenceId.length > 0,
  )

  return typeof link?.referenceId === "string" ? link.referenceId : null
}

async function listHighLevelDocuments(query: string) {
  const url = new URL(`${HIGHLEVEL_API_BASE}/proposals/document`)
  url.searchParams.set("locationId", highLevelLocationId())
  url.searchParams.set("limit", "20")
  url.searchParams.set("query", query)

  const response = await fetch(url, {
    method: "GET",
    headers: highLevelHeaders(),
    cache: "no-store",
  })
  await assertHighLevelResponse(response, "HighLevel document lookup")
  return (await response.json()) as HighLevelDocumentsResponse
}

function matchingContactDocument(
  payload: HighLevelDocumentsResponse,
  contactId: string,
  templateName: string,
  statuses: string[],
): HighLevelDocument | null {
  return (
    payload.documents
      ?.filter(
        (document) =>
          typeof document.documentId === "string" &&
          typeof document.name === "string" &&
          document.name.startsWith(templateName) &&
          typeof document.status === "string" &&
          statuses.includes(document.status) &&
          document.recipients?.some(
            (recipient) => recipient.id === contactId,
          ),
      )
      .sort((left, right) =>
        String(right.createdAt ?? "").localeCompare(
          String(left.createdAt ?? ""),
        ),
      )[0] ?? null
  )
}

async function waitForDraftDocument(
  query: string,
  contactId: string,
  templateName: string,
): Promise<HighLevelDocument> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const payload = await listHighLevelDocuments(query)
    const document = matchingContactDocument(
      payload,
      contactId,
      templateName,
      ["draft"],
    )
    if (document) return document
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
  }

  throw new Error("HighLevel did not create the onboarding agreement draft")
}

export async function upsertHighLevelContact(
  input: HighLevelContactInput,
): Promise<string> {
  const locationId = highLevelLocationId()

  const response = await fetch(`${HIGHLEVEL_API_BASE}/contacts/upsert`, {
    method: "POST",
    headers: highLevelHeaders(),
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      phone: input.phone ?? undefined,
      companyName: input.companyName,
      locationId,
      source: input.source,
      createNewIfDuplicateAllowed: false,
      customFields: input.customFields,
    }),
  })

  await assertHighLevelResponse(response, "HighLevel contact upsert")
  const payload = (await response.json()) as {
    contact?: { id?: unknown }
  }
  if (typeof payload.contact?.id !== "string" || !payload.contact.id) {
    throw new Error("HighLevel contact upsert returned no contact ID")
  }

  return payload.contact.id
}

export async function prepareHighLevelOnboardingAgreement(input: {
  contactId: string
  contactName: string
  childListingQuantity: number
}): Promise<{ documentId: string; signingUrl: string; reused: boolean }> {
  const hasChildListings = input.childListingQuantity > 0
  const templateId = hasChildListings
    ? process.env.HIGHLEVEL_ONBOARDING_CHILD_TEMPLATE_ID ??
      process.env.HIGHLEVEL_ONBOARDING_TEMPLATE_ID
    : process.env.HIGHLEVEL_ONBOARDING_TEMPLATE_ID
  const senderUserId = process.env.HIGHLEVEL_ONBOARDING_SENDER_USER_ID
  const templateName = hasChildListings
    ? process.env.HIGHLEVEL_ONBOARDING_CHILD_TEMPLATE_NAME ??
      process.env.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME ??
      "RevFactor_Service_Agreement"
    : process.env.HIGHLEVEL_ONBOARDING_TEMPLATE_NAME ??
      "RevFactor_Service_Agreement"

  if (!templateId) {
    throw new Error("HIGHLEVEL_ONBOARDING_TEMPLATE_ID is not set")
  }
  if (!senderUserId) {
    throw new Error("HIGHLEVEL_ONBOARDING_SENDER_USER_ID is not set")
  }

  const existing = matchingContactDocument(
    await listHighLevelDocuments(input.contactName),
    input.contactId,
    templateName,
    ["sent", "viewed"],
  )
  const existingReference = contactSigningReference(
    existing?.links,
    input.contactId,
  )
  if (
    existingReference &&
    typeof existing?.documentId === "string"
  ) {
    return {
      documentId: existing.documentId,
      signingUrl: buildHighLevelSigningUrl(existingReference),
      reused: true,
    }
  }

  const createResponse = await fetch(
    `${HIGHLEVEL_API_BASE}/proposals/templates/send`,
    {
      method: "POST",
      headers: highLevelHeaders(),
      body: JSON.stringify({
        templateId,
        userId: senderUserId,
        sendDocument: false,
        locationId: highLevelLocationId(),
        contactId: input.contactId,
      }),
    },
  )
  await assertHighLevelResponse(
    createResponse,
    "HighLevel agreement creation",
  )

  const draft = await waitForDraftDocument(
    input.contactName,
    input.contactId,
    templateName,
  )
  if (typeof draft.documentId !== "string") {
    throw new Error("HighLevel agreement creation returned no document ID")
  }

  const sendResponse = await fetch(
    `${HIGHLEVEL_API_BASE}/proposals/document/send`,
    {
      method: "POST",
      headers: highLevelHeaders(),
      body: JSON.stringify({
        locationId: highLevelLocationId(),
        documentId: draft.documentId,
        documentName: `${templateName} — ${input.contactName}`,
        medium: "link",
        sentBy: senderUserId,
      }),
    },
  )
  await assertHighLevelResponse(sendResponse, "HighLevel agreement link creation")
  const sendPayload = (await sendResponse.json()) as {
    links?: HighLevelDocumentLink[]
  }
  const referenceId = contactSigningReference(
    sendPayload.links,
    input.contactId,
  )
  if (!referenceId) {
    throw new Error("HighLevel returned no contact signing link")
  }

  return {
    documentId: draft.documentId,
    signingUrl: buildHighLevelSigningUrl(referenceId),
    reused: false,
  }
}

export async function setHighLevelContactCustomFields(
  contactId: string,
  customFields: HighLevelCustomField[],
) {
  const response = await fetch(`${HIGHLEVEL_API_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: highLevelHeaders(),
    body: JSON.stringify({ customFields }),
  })

  await assertHighLevelResponse(response, "HighLevel contact update")
}

export async function addHighLevelContactTags(contactId: string, tags: string[]) {
  const response = await fetch(
    `${HIGHLEVEL_API_BASE}/contacts/${contactId}/tags`,
    {
      method: "POST",
      headers: highLevelHeaders(),
      body: JSON.stringify({ tags }),
    },
  )

  await assertHighLevelResponse(response, "HighLevel tag update")
}
