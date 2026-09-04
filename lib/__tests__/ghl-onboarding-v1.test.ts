import { describe, it, expect } from "vitest"
import {
  JourneySchema,
  propertySnapshot,
  submitJourney,
  missingRequirements,
  applySharedPreferences,
  assertSignedIdentityUnchanged,
  clientContext,
} from "@/lib/ghl-onboarding-v1/domain"
import {
  verifyCommercialEvidence,
  contractAddress,
  type CommercialCatalog,
} from "@/lib/ghl-onboarding-v1/commercial"
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const preferences = {
  goal: "guidance",
  minimumNightly: { mode: "guidance" },
  minimumStay: { mode: "guidance" },
  cleaningFee: { mode: "guidance" },
}
function ready(count = 1) {
  const j = JourneySchema.parse({
    version: "rf.onboarding.v1",
    id: id(1),
    contactId: "contact",
    opportunityId: "opportunity",
    appointmentId: "appointment",
    ownerId: "rep",
    email: "Owner@example.com",
    name: "Test Owner",
    stage: "onboarding",
    billingMode: "single",
    properties: Array.from({ length: count }, (_, i) => ({
      id: id(i + 10),
      billingAccountId: id(2),
      name: `Property ${i}`,
      address: {
        street: `${i + 1} Test Street`,
        city: "Test",
        region: "NY",
        postalCode: "10001",
        country: "us",
      },
      status: "pre_launch",
      targetLaunchDate: "2026-10-01",
      identityConfirmed: true,
      preferences,
    })),
    accounts: [
      {
        id: id(2),
        legalName: "Test LLC",
        ghlContactId: "contact",
        propertyIds: Array.from({ length: count }, (_, i) => id(i + 10)),
        monthlyRateCents: 35000,
        onboardingFeeCents: 15000,
        documentId: "doc",
        invoiceId: "invoice",
        stripePaymentIntentId: "pi_test",
        verifiedAt: "2026-09-04T12:00:00Z",
      },
    ],
    software: {
      pmsName: null,
      pms: "not_applicable",
      airbnb: "need_help",
      pricelabs: "need_help",
    },
    expectationsAcknowledged: true,
  })
  j.signedPropertySnapshot = propertySnapshot(j)
  return j
}
const catalog: CommercialCatalog = {
  locationId: "location",
  liveMode: false,
  primaryProductId: "primary",
  standardPriceId: "standard",
  referralPriceId: "referral",
  feeProductId: "fee",
  feePriceId: "fee-price",
  stripeInvoiceMetadataKey: "invoice_id",
  contractFields: {
    legalNameFieldId: "legal",
    propertyAddressFieldIds: [
      "address0",
      "address1",
      "address2",
      "address3",
      "address4",
    ],
  },
}
function evidence(count = 1, referral = false) {
  const account = ready(count).accounts[0]
  if (referral) account.monthlyRateCents = 32000
  const rate = account.monthlyRateCents / 100,
    total = rate * count + 150
  return {
    account,
    properties: ready(count).properties,
    catalog,
    document: {
      documentId: "doc",
      locationId: "location",
      status: ["completed"],
      fillableFields: [
        { fieldId: "legal", hasCompleted: true, value: "Test LLC" },
        ...ready(count).properties.map((p, i) => ({
          fieldId: `address${i}`,
          hasCompleted: true,
          value: contractAddress(p.address),
        })),
      ],
      grandTotal: { amount: total, currency: "USD" },
      recipients: [{ id: "contact", hasCompleted: true, role: "signer" }],
    },
    invoice: {
      _id: "invoice",
      status: "paid",
      altId: "location",
      liveMode: false,
      currency: "USD",
      total,
      amountPaid: total,
      amountDue: 0,
      contactDetails: { id: "contact" },
      invoiceItems: [
        {
          productId: "primary",
          priceId: referral ? "referral" : "standard",
          qty: count,
          amount: rate,
        },
        { productId: "fee", priceId: "fee-price", qty: 1, amount: 150 },
      ],
    },
    payment: {
      id: "pi_test",
      status: "succeeded",
      amount_received: total * 100,
      currency: "usd",
      livemode: false,
      metadata: { invoice_id: "invoice" },
    },
  }
}
describe("GHL V1 acceptance and property reuse", () => {
  it("accepts explicit guidance and pending software without claiming verification", () => {
    const j = ready()
    expect(missingRequirements(j)).toEqual([])
    expect(submitJourney(j, "2026-09-04T13:00:00Z").stage).toBe("submitted")
    expect(j.software?.airbnb).toBe("need_help")
  })
  it("rejects a forged paid timestamp without bound provider identities or signed scope", () => {
    const j = ready()
    j.accounts[0].invoiceId = null
    j.signedPropertySnapshot = null
    expect(() => submitJourney(j, "2026-09-04T13:00:00Z")).toThrow(
      "onboarding_incomplete"
    )
  })
  it("requires explicit final submit and confirmed property identity", () => {
    const j = ready()
    j.properties[0].identityConfirmed = false
    expect(() => submitJourney(j, "2026-09-04T13:00:00Z")).toThrow(
      "onboarding_incomplete"
    )
  })
  it("requires a listing URL only for live properties", () => {
    const j = ready()
    j.properties[0].status = "live"
    expect(missingRequirements(j)).toContain(`property:${id(10)}:listing_url`)
  })
  it("blocks silently changing the signed address or billing property association", () => {
    const j = ready(),
      n = structuredClone(j)
    n.properties[0].address.street = "Another house"
    expect(() => assertSignedIdentityUnchanged(j, n)).toThrow(
      "signed_property_correction_requires_review"
    )
    expect(() => submitJourney(n, "2026-09-04T13:00:00Z")).toThrow(
      "signed_property_correction_requires_review"
    )
  })
  it("copies shared answers only to an explicit subset without changing identity", () => {
    const j = ready(3)
    const n = applySharedPreferences(j, [id(10), id(12)], {
      ...preferences,
      goal: "occupancy",
    })
    expect(n.properties.map((p) => p.preferences?.goal)).toEqual([
      "occupancy",
      "guidance",
      "occupancy",
    ])
    expect(propertySnapshot(n)).toEqual(propertySnapshot(j))
    expect(() => applySharedPreferences(j, [id(99)], preferences)).toThrow(
      "invalid_property_selection"
    )
  })
  it("blocks duplicate billing coverage and additional setup fees", () => {
    const j = ready(2)
    j.accounts.push({ ...j.accounts[0], id: id(3) })
    expect(JourneySchema.safeParse(j).success).toBe(false)
  })
  it("projects no internal or commercial provider references to the native UI", () => {
    const c = clientContext(ready())
    expect(c.email).toBe("owner@example.com")
    expect(JSON.stringify(c)).not.toMatch(
      /billingAccountId|invoiceId|documentId|stripePayment|ghlRecordId|monthlyRate|ownerId/
    )
  })
  it("blocks submission when a human takes over", () => {
    const j = ready()
    j.manualTakeover = true
    expect(() => submitJourney(j, "2026-09-04T13:00:00Z")).toThrow(
      "journey_not_accepting_submission"
    )
  })
})
describe("GHL commercial evidence", () => {
  it.each([
    [1, false, 50000],
    [3, false, 120000],
    [2, true, 79000],
  ] as const)(
    "validates %s properties referral=%s with one setup fee",
    (count, referral, total) => {
      expect(
        verifyCommercialEvidence(evidence(count, referral)).initialAmountCents
      ).toBe(total)
    }
  )
  it("rejects a contract for another legal entity or property despite matching price", () => {
    const a = evidence()
    a.document.fillableFields[0].value = "Other LLC"
    expect(() => verifyCommercialEvidence(a)).toThrow(
      "signed_contract_scope_mismatch"
    )
    const b = evidence()
    b.document.fillableFields[1].value = "Different property"
    expect(() => verifyCommercialEvidence(b)).toThrow(
      "signed_contract_scope_mismatch"
    )
  })
  it("rejects a different client invoice even with the correct amount", () => {
    const e = evidence()
    e.invoice.contactDetails.id = "other"
    expect(() => verifyCommercialEvidence(e)).toThrow(
      "commercial_location_or_contact_mismatch"
    )
  })
  it("rejects successful Stripe payments without invoice correlation", () => {
    const e = evidence()
    e.payment.metadata.invoice_id = "other"
    expect(() => verifyCommercialEvidence(e)).toThrow(
      "stripe_invoice_correlation_unverified"
    )
  })
  it("rejects unsigned contracts, partial payments and wrong price IDs", () => {
    const a = evidence()
    a.document.recipients[0].hasCompleted = false
    expect(() => verifyCommercialEvidence(a)).toThrow("agreement_not_completed")
    const b = evidence()
    b.invoice.amountPaid = 150
    expect(() => verifyCommercialEvidence(b)).toThrow("invoice_not_fully_paid")
    const c = evidence()
    c.invoice.invoiceItems[0].priceId = "referral"
    expect(() => verifyCommercialEvidence(c)).toThrow(
      "invoice_product_mismatch"
    )
  })
  it("rejects test/live mismatch and reused intent identity", () => {
    const a = evidence()
    a.payment.livemode = true
    expect(() => verifyCommercialEvidence(a)).toThrow("stripe_payment_mismatch")
    const b = evidence()
    b.payment.id = "pi_other"
    expect(() => verifyCommercialEvidence(b)).toThrow(
      "commercial_identity_mismatch"
    )
  })
  it("requires no second setup fee on an assisted secondary business", () => {
    const e = evidence()
    e.account.onboardingFeeCents = 0
    e.document.grandTotal.amount = 350
    e.invoice.total = 350
    e.invoice.amountPaid = 350
    e.payment.amount_received = 35000
    expect(() => verifyCommercialEvidence(e)).toThrow(
      "invoice_setup_fee_mismatch"
    )
    e.invoice.invoiceItems.pop()
    expect(verifyCommercialEvidence(e).initialAmountCents).toBe(35000)
  })
})
