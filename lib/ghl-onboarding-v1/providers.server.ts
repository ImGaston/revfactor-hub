import "server-only"
import { verifyJourneyIdentity } from "./identity"
import Stripe from "stripe"
import { z } from "zod"
import { verifyCommercialEvidence, type CommercialCatalog } from "./commercial"
import type { BillingAccount, Property } from "./domain"

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`missing_configuration:${name}`)
  return value
}
export async function highlevelFetch(
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const response = await fetch(`https://services.leadconnectorhq.com${path}`, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${requiredEnv("HIGHLEVEL_API_KEY")}`,
      Version: "v3",
      "Content-Type": "application/json",
      "User-Agent": "RevFactor-GHL-V1/1.0",
      ...init?.headers,
    },
  })
  if (!response.ok) throw new Error(`highlevel_http_${response.status}`)
  return response.json()
}
export async function readDocument(documentId: string) {
  const locationId = requiredEnv("HIGHLEVEL_LOCATION_ID")
  // The live v3 API rejects limit > 21 (422), although the reference omits it.
  const pageSize = 21
  const deadline = Date.now() + 25000
  for (let skip = 0; skip < 1000; skip += pageSize) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error("document_lookup_deadline")
    const payload = (await highlevelFetch(
      `/proposals/document?${new URLSearchParams({ locationId, limit: String(pageSize), skip: String(skip) })}`,
      { signal: AbortSignal.timeout(Math.min(15000, remaining)) }
    )) as { documents?: Array<{ documentId?: string }>; total?: number }
    if (!Array.isArray(payload.documents))
      throw new Error("invalid_document_list")
    const found = payload.documents.find((d) => d.documentId === documentId)
    if (found) return found
    if (payload.documents.length < pageSize) break
  }
  throw new Error("bound_document_not_found")
}
export function commercialCatalog(): CommercialCatalog {
  return {
    locationId: requiredEnv("HIGHLEVEL_LOCATION_ID"),
    liveMode: process.env.GHL_V1_PAYMENT_MODE === "live",
    primaryProductId: requiredEnv("GHL_V1_PRIMARY_PRODUCT_ID"),
    standardPriceId: requiredEnv("GHL_V1_STANDARD_PRICE_ID"),
    referralPriceId: requiredEnv("GHL_V1_REFERRAL_PRICE_ID"),
    feeProductId: requiredEnv("GHL_V1_FEE_PRODUCT_ID"),
    feePriceId: requiredEnv("GHL_V1_FEE_PRICE_ID"),
    stripeInvoiceMetadataKey: requiredEnv("GHL_V1_STRIPE_INVOICE_METADATA_KEY"),
    contractFields: z
      .object({
        legalNameFieldId: z.string().min(1),
        propertyAddressFieldIds: z.array(z.string().min(1)).min(1).max(5),
      })
      .strict()
      .parse(JSON.parse(requiredEnv("GHL_V1_CONTRACT_FIELDS_JSON"))),
  }
}
export async function verifyAccount(
  account: BillingAccount,
  properties: Property[]
) {
  if (
    !account.invoiceId ||
    !account.documentId ||
    !account.stripePaymentIntentId
  )
    throw new Error("commercial_binding_incomplete")
  const catalog = commercialCatalog()
  const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
    maxNetworkRetries: 0,
    timeout: 15000,
  })
  const [document, invoice, payment] = await Promise.all([
    readDocument(account.documentId),
    highlevelFetch(
      `/invoices/${encodeURIComponent(account.invoiceId)}?${new URLSearchParams({ altId: catalog.locationId, altType: "location" })}`
    ),
    stripe.paymentIntents.retrieve(account.stripePaymentIntentId),
  ])
  return verifyCommercialEvidence({
    account,
    properties,
    catalog,
    document,
    invoice,
    payment,
  })
}

export async function readJourneyIdentity(input: {
  contactId: string
  opportunityId: string
  appointmentId: string
  ownerId: string
  email: string
}) {
  const [contact, opportunity, appointments] = await Promise.all([
    highlevelFetch(`/contacts/${encodeURIComponent(input.contactId)}`),
    highlevelFetch(`/opportunities/${encodeURIComponent(input.opportunityId)}`),
    highlevelFetch(
      `/contacts/${encodeURIComponent(input.contactId)}/appointments`
    ),
  ])
  return verifyJourneyIdentity(
    input,
    {
      locationId: requiredEnv("HIGHLEVEL_LOCATION_ID"),
      pipelineId: requiredEnv("GHL_V1_PIPELINE_ID"),
      salesCalendarIds: requiredEnv("GHL_V1_SALES_CALENDAR_IDS")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    },
    { contact, opportunity, appointments }
  )
}
