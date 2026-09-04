import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  canonicalAgreementContentSha256,
  signEntitlementToken,
} from "@/lib/server-checkout/entitlement-issuer.server"
import { verifyEntitlementToken } from "@/lib/server-checkout/entitlement"
import {
  signInternalOnboardingRequest,
  verifyInternalOnboardingRequest,
} from "@/lib/server-checkout/internal-auth.server"
import { prepareOnboardingAccountSchema } from "@/lib/server-checkout/onboarding-account.server"
import {
  StripeCheckoutAdapter,
  stripePriceInspector,
} from "@/lib/server-checkout/stripe-provider.server"

describe("multi-business server checkout wiring", () => {
  it("authenticates Worker-to-Hub bodies and rejects body tampering", () => {
    const body = JSON.stringify({ groupFingerprint: "a".repeat(64) })
    const signed = signInternalOnboardingRequest({
      secret: "test-internal-secret",
      body,
      timestamp: 1_800_000_000,
    })
    expect(() =>
      verifyInternalOnboardingRequest({
        secret: "test-internal-secret",
        body,
        timestamp: signed.timestamp,
        signature: signed.signature,
        now: 1_800_000_020,
      })
    ).not.toThrow()
    expect(() =>
      verifyInternalOnboardingRequest({
        secret: "test-internal-secret",
        body: `${body} `,
        timestamp: signed.timestamp,
        signature: signed.signature,
        now: 1_800_000_020,
      })
    ).toThrow("signature is invalid")
  })

  it("signs a short-lived entitlement bound to the approved no-tax policy", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    const now = 1_800_000_000
    const token = signEntitlementToken({
      privateKeyPem: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      keyId: "test-key",
      payload: {
        iss: "revfactor-hub",
        aud: "revfactor-server-checkout",
        sub: "11111111-1111-4111-8111-111111111111",
        jti: "rfe_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        iat: now,
        nbf: now,
        exp: now + 900,
        environment: "test",
        highLevel: {
          locationId: "location",
          contactId: "contact",
          opportunityId: "opportunity",
        },
        onboardingGroup: {
          id: "22222222-2222-4222-8222-222222222222",
          billingAccountId: "33333333-3333-4333-8333-333333333333",
          accountSequence: 1,
          accountCount: 2,
          totalListingCount: 2,
          billingMode: "separate_per_listing",
        },
        agreement: {
          documentId: "document",
          templateId: "template",
          revision: 1,
          contentSha256: "b".repeat(64),
          signedAt: "2027-01-15T00:00:00.000Z",
        },
        order: {
          primaryQuantity: 1,
          childQuantity: 0,
          onboardingFeeCents: 7500,
          serviceStartMode: "immediate",
          serviceStartDate: null,
          currency: "usd",
          priceBookVersion: "rf-standard-usd-v1",
          stripeAccountId: "acct_test",
          taxPolicy: "configured_no_collection",
        },
      },
    })
    await expect(
      verifyEntitlementToken({
        token,
        resolvePublicKey: async () =>
          publicKey.export({ type: "spki", format: "pem" }).toString(),
        now: new Date(now * 1000),
      })
    ).resolves.toMatchObject({
      order: {
        onboardingFeeCents: 7500,
        taxPolicy: "configured_no_collection",
      },
    })
  })

  it("rejects browser-equivalent commercial tampering before persistence", () => {
    const input = {
      groupFingerprint: "a".repeat(64),
      billingMode: "separate_per_listing",
      contactName: "Test Signer",
      email: "signer@example.com",
      totalListingCount: 2,
      pricingProgram: "Regular",
      contactId: "contact",
      opportunityId: "opportunity",
      documentId: "document",
      documentRevision: 1,
      signedAt: "2027-01-15T00:00:00.000Z",
      account: {
        sequence: 1,
        legalBusinessName: "Property One LLC",
        listingQuantity: 1,
        monthlyRateCents: 35000,
        monthlyAmountCents: 35000,
        onboardingFeeCents: 7500,
        initialCheckoutTotalCents: 42500,
      },
    }
    expect(
      prepareOnboardingAccountSchema.parse(input).account.onboardingFeeCents
    ).toBe(7500)
    expect(() =>
      prepareOnboardingAccountSchema.parse({
        ...input,
        account: { ...input.account, onboardingFeeCents: 1 },
      })
    ).toThrow()
  })

  it("creates a fixed Stripe subscription Checkout with tax and promotions off", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    })
    const stripe = { checkout: { sessions: { create } } }
    const adapter = new StripeCheckoutAdapter(
      stripe as never,
      "acct_test",
      "test",
      "https://links.revfactor.io/rf-onboarding-resume-draft"
    )
    await adapter.createCheckout({
      idempotencyKey: "attempt-1",
      entitlementId: "entitlement-1",
      onboardingGroupId: "group-1",
      billingAccountId: "account-1",
      accountSequence: 1,
      highLevelContactId: "contact-1",
      highLevelOpportunityId: "opportunity-1",
      agreementDocumentId: "document-1",
      serviceStartMode: "immediate",
      serviceStartDate: null,
      lineItems: [
        {
          priceId: "price_monthly",
          quantity: 1,
          kind: "recurring",
          unitAmount: 35000,
          currency: "usd",
        },
        {
          priceId: "price_fee_75",
          quantity: 1,
          kind: "one_time",
          unitAmount: 7500,
          currency: "usd",
        },
      ],
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        allow_promotion_codes: false,
        automatic_tax: { enabled: false },
        payment_method_collection: "always",
        line_items: [
          { price: "price_monthly", quantity: 1 },
          { price: "price_fee_75", quantity: 1 },
        ],
      }),
      { idempotencyKey: "attempt-1" }
    )
  })

  it("binds price inspection to the account represented by the secret key", async () => {
    const retrieveCurrent = vi.fn().mockResolvedValue({ id: "acct_test" })
    const retrievePrice = vi.fn().mockResolvedValue({
      id: "price_monthly",
      active: true,
      livemode: false,
      type: "recurring",
      unit_amount: 35000,
      currency: "usd",
      recurring: { interval: "month" },
      product: {
        id: "prod_monthly",
        active: true,
        deleted: false,
        metadata: { revfactor_product_marker: "rf_primary" },
      },
    })
    const inspect = stripePriceInspector({
      stripe: {
        accounts: { retrieveCurrent },
        prices: { retrieve: retrievePrice },
      } as never,
      stripeAccountId: "acct_test",
    })

    await expect(inspect("price_monthly")).resolves.toMatchObject({
      priceId: "price_monthly",
      unitAmount: 35000,
      stripeAccountId: "acct_test",
      livemode: false,
    })
    expect(retrieveCurrent).toHaveBeenCalledOnce()
    expect(retrievePrice).toHaveBeenCalledWith("price_monthly", {
      expand: ["product"],
    })
  })

  it("hashes the full signed commercial revision", () => {
    const base = {
      documentId: "document",
      templateId: "template",
      documentRevision: 1,
      opportunityId: "opportunity",
      legalBusinessName: "Property LLC",
      listingQuantity: 1,
      pricingProgram: "Regular" as const,
      monthlyRateCents: 35000,
      monthlyAmountCents: 35000,
      onboardingFeeCents: 7500,
      initialCheckoutTotalCents: 42500,
    }
    expect(canonicalAgreementContentSha256(base)).not.toBe(
      canonicalAgreementContentSha256({
        ...base,
        legalBusinessName: "Changed LLC",
      })
    )
  })
})
