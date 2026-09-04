import { z } from "zod"
import type { BillingAccount, Property } from "./domain"

const InvoiceSchema = z.object({
  _id: z.string(),
  status: z.string(),
  altId: z.string(),
  liveMode: z.boolean(),
  currency: z.string(),
  total: z.number(),
  amountPaid: z.number(),
  amountDue: z.number(),
  contactDetails: z.object({ id: z.string() }),
  invoiceItems: z.array(
    z.object({
      productId: z.string(),
      priceId: z.string(),
      qty: z.number(),
      amount: z.number(),
      taxes: z.array(z.unknown()).optional(),
    })
  ),
})
const DocumentSchema = z.object({
  documentId: z.string(),
  locationId: z.string(),
  deleted: z.boolean().optional(),
  isExpired: z.boolean().optional(),
  status: z.union([z.string(), z.array(z.string())]),
  fillableFields: z.array(
    z.object({
      fieldId: z.string(),
      hasCompleted: z.boolean(),
      value: z.string(),
    })
  ),
  grandTotal: z.object({ amount: z.number(), currency: z.string() }),
  recipients: z.array(
    z.object({
      id: z.string(),
      hasCompleted: z.boolean(),
      role: z.string(),
      isPrimary: z.boolean().optional(),
    })
  ),
})
export type CommercialCatalog = {
  locationId: string
  liveMode: boolean
  primaryProductId: string
  standardPriceId: string
  referralPriceId: string
  feeProductId: string
  feePriceId: string
  stripeInvoiceMetadataKey: string
  contractFields: {
    legalNameFieldId: string
    propertyAddressFieldIds: string[]
  }
}
/** Inputs must come from authenticated provider reads, never webhook booleans. */
export function verifyCommercialEvidence(input: {
  account: BillingAccount
  properties: Property[]
  catalog: CommercialCatalog
  document: unknown
  invoice: unknown
  payment: {
    id: string
    status: string
    amount_received: number
    currency: string
    livemode: boolean
    metadata: Record<string, string>
  }
}) {
  const { account: a, catalog: c, payment: p } = input
  const d = DocumentSchema.parse(input.document)
  const i = InvoiceSchema.parse(input.invoice)
  const expected =
    a.monthlyRateCents * a.propertyIds.length + a.onboardingFeeCents
  const cents = (n: number) => Math.round(n * 100)
  const statuses = Array.isArray(d.status) ? d.status : [d.status]
  if (
    !a.documentId ||
    !a.invoiceId ||
    !a.stripePaymentIntentId ||
    d.documentId !== a.documentId ||
    i._id !== a.invoiceId ||
    p.id !== a.stripePaymentIntentId
  )
    throw new Error("commercial_identity_mismatch")
  if (
    d.locationId !== c.locationId ||
    i.altId !== c.locationId ||
    i.contactDetails.id !== a.ghlContactId
  )
    throw new Error("commercial_location_or_contact_mismatch")
  if (
    d.deleted ||
    d.isExpired ||
    !statuses.includes("completed") ||
    !d.recipients.some(
      (r) => r.id === a.ghlContactId && r.hasCompleted && r.role === "signer"
    )
  )
    throw new Error("agreement_not_completed")
  const scope = a.propertyIds.map((id) =>
    input.properties.find((property) => property.id === id)
  )
  if (
    scope.some((property) => !property) ||
    new Set(c.contractFields.propertyAddressFieldIds).size !==
      c.contractFields.propertyAddressFieldIds.length ||
    c.contractFields.propertyAddressFieldIds.length < scope.length
  )
    throw new Error("contract_scope_mapping_invalid")
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ")
  const assertField = (fieldId: string, expected: string) => {
    const fields = d.fillableFields.filter((field) => field.fieldId === fieldId)
    if (
      !fieldId ||
      fields.length !== 1 ||
      !fields[0].hasCompleted ||
      normalize(fields[0].value) !== normalize(expected)
    )
      throw new Error("signed_contract_scope_mismatch")
  }
  assertField(c.contractFields.legalNameFieldId, a.legalName)
  scope.forEach((property, index) =>
    assertField(
      c.contractFields.propertyAddressFieldIds[index],
      contractAddress(property!.address)
    )
  )
  if (
    d.grandTotal.currency.toUpperCase() !== "USD" ||
    cents(d.grandTotal.amount) !== expected
  )
    throw new Error("agreement_amount_mismatch")
  if (
    i.status !== "paid" ||
    cents(i.total) !== expected ||
    cents(i.amountPaid) !== expected ||
    cents(i.amountDue) !== 0 ||
    i.currency.toUpperCase() !== "USD"
  )
    throw new Error("invoice_not_fully_paid")
  const primary = i.invoiceItems.filter(
    (item) => item.productId === c.primaryProductId
  )
  const fee = i.invoiceItems.filter((item) => item.productId === c.feeProductId)
  if (
    primary.length !== 1 ||
    primary[0].qty !== a.propertyIds.length ||
    cents(primary[0].amount) !== a.monthlyRateCents ||
    primary[0].priceId !==
      (a.monthlyRateCents === 32000 ? c.referralPriceId : c.standardPriceId)
  )
    throw new Error("invoice_product_mismatch")
  if (
    a.onboardingFeeCents === 15000
      ? fee.length !== 1 ||
        fee[0].qty !== 1 ||
        cents(fee[0].amount) !== 15000 ||
        fee[0].priceId !== c.feePriceId
      : fee.length !== 0
  )
    throw new Error("invoice_setup_fee_mismatch")
  if (
    i.invoiceItems.length !== primary.length + fee.length ||
    i.invoiceItems.some((item) => (item.taxes?.length ?? 0) > 0)
  )
    throw new Error("unexpected_invoice_items_or_tax")
  if (
    !c.stripeInvoiceMetadataKey ||
    p.metadata[c.stripeInvoiceMetadataKey] !== a.invoiceId
  )
    throw new Error("stripe_invoice_correlation_unverified")
  if (
    p.status !== "succeeded" ||
    p.amount_received !== expected ||
    p.currency !== "usd" ||
    p.livemode !== c.liveMode ||
    i.liveMode !== c.liveMode
  )
    throw new Error("stripe_payment_mismatch")
  return {
    initialAmountCents: expected,
    documentId: d.documentId,
    invoiceId: i._id,
    paymentIntentId: p.id,
  }
}

/** This exact presentation is used in the native contract's address fields. */
export function contractAddress(address: Property["address"]) {
  return [
    address.street,
    address.unit,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ]
    .filter(Boolean)
    .join(", ")
}
