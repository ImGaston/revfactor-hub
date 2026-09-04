import { generateKeyPairSync, sign } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  buildAssemblyHandoffCandidate,
  buildGroupAssemblyHandoffCandidate,
} from "@/lib/server-checkout/assembly-gate"
import { prepareServerCheckout } from "@/lib/server-checkout/checkout-service.server"
import type {
  EntitlementPayload,
  StoredEntitlement,
} from "@/lib/server-checkout/contracts"
import {
  compareEntitlementToStoredRecord,
  verifyEntitlementToken,
} from "@/lib/server-checkout/entitlement"
import {
  resolveCanonicalLineItems,
  type PriceBook,
  type ProviderPrice,
} from "@/lib/server-checkout/price-book"
import type { CheckoutAttemptRepository } from "@/lib/server-checkout/repository.server"
import { DbReconciliationLedger } from "@/lib/server-checkout/reconciliation-repository.server"
import { loadServerPriceBooks } from "@/lib/server-checkout/server-price-books.server"
import {
  legalCheckoutTransitions,
  legalServiceBillingTransitions,
  reduceCheckoutState,
} from "@/lib/server-checkout/state-machine"
import {
  reconcileSignedWebhook,
  type CanonicalProviderCheckout,
  type ReconciliationLedger,
} from "@/lib/server-checkout/webhook-reconciliation.server"

const NOW = new Date("2026-08-27T16:00:00.000Z")
const { privateKey, publicKey } = generateKeyPairSync("ed25519")

function entitlement(
  overrides: Partial<EntitlementPayload> = {}
): EntitlementPayload {
  const base: EntitlementPayload = {
    iss: "revfactor-hub",
    aud: "revfactor-server-checkout",
    sub: "11111111-1111-4111-8111-111111111111",
    jti: "agreement-doc-123-revision-4",
    iat: 1787846400,
    nbf: 1787846400,
    exp: 1787847300,
    environment: "isolated_fixture",
    highLevel: {
      locationId: "loc_123",
      contactId: "contact_123",
      opportunityId: "opportunity_123",
    },
    onboardingGroup: {
      id: "22222222-2222-4222-8222-222222222222",
      billingAccountId: "33333333-3333-4333-8333-333333333333",
      accountSequence: 1,
      accountCount: 1,
      totalListingCount: 2,
      billingMode: "single",
    },
    agreement: {
      documentId: "doc_123",
      templateId: "template_123",
      revision: 4,
      contentSha256: "a".repeat(64),
      signedAt: "2026-08-27T15:59:00.000Z",
    },
    order: {
      primaryQuantity: 2,
      childQuantity: 0,
      onboardingFeeCents: 15000,
      serviceStartMode: "scheduled",
      serviceStartDate: "2026-09-15",
      currency: "usd",
      priceBookVersion: "rf-usd-v1",
      stripeAccountId: "fixture:acct_checkout",
      taxPolicy: "provisional_fixture_only",
    },
  }
  return { ...base, ...overrides }
}

function compactJws(payload: EntitlementPayload): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "fixture-key" })
  ).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = sign(
    null,
    Buffer.from(`${header}.${body}`),
    privateKey
  ).toString("base64url")
  return `${header}.${body}.${signature}`
}

function stored(payload = entitlement()): StoredEntitlement {
  return {
    id: payload.sub,
    jti: payload.jti,
    status: "active",
    expiresAt: "2026-08-27T16:15:00.000Z",
    environment: payload.environment,
    stripeAccountId: payload.order.stripeAccountId,
    highLevelLocationId: payload.highLevel.locationId,
    highLevelContactId: payload.highLevel.contactId,
    highLevelOpportunityId: payload.highLevel.opportunityId,
    onboardingGroupId: payload.onboardingGroup.id,
    billingAccountId: payload.onboardingGroup.billingAccountId,
    accountSequence: payload.onboardingGroup.accountSequence,
    accountCount: payload.onboardingGroup.accountCount,
    totalListingCount: payload.onboardingGroup.totalListingCount,
    billingMode: payload.onboardingGroup.billingMode,
    agreementDocumentId: payload.agreement.documentId,
    agreementTemplateId: payload.agreement.templateId,
    agreementRevision: payload.agreement.revision,
    agreementContentSha256: payload.agreement.contentSha256,
    primaryQuantity: payload.order.primaryQuantity,
    childQuantity: payload.order.childQuantity,
    onboardingFeeCents: payload.order.onboardingFeeCents,
    serviceStartMode: payload.order.serviceStartMode,
    serviceStartDate: payload.order.serviceStartDate,
    currency: payload.order.currency,
    priceBookVersion: payload.order.priceBookVersion,
    taxPolicy: payload.order.taxPolicy,
  }
}

const priceBook: PriceBook = {
  version: "rf-usd-v1",
  stripeAccountId: "fixture:acct_checkout",
  environment: "isolated_fixture",
  primary: {
    priceId: "price_primary",
    productMarker: "rf_primary",
    unitAmount: 35000,
    currency: "usd",
    kind: "recurring",
    interval: "month",
  },
  child: {
    priceId: "price_child",
    productMarker: "rf_child",
    unitAmount: 5000,
    currency: "usd",
    kind: "recurring",
    interval: "month",
  },
  onboarding: {
    priceId: "price_onboarding",
    productMarker: "rf_onboarding",
    unitAmount: 15000,
    currency: "usd",
    kind: "one_time",
    interval: null,
  },
  onboardingAllocations: {
    7500: {
      priceId: "price_onboarding_75",
      productMarker: "rf_onboarding",
      unitAmount: 7500,
      currency: "usd",
      kind: "one_time",
      interval: null,
    },
  },
}

function inspectPrice(priceId: string): Promise<ProviderPrice> {
  const entry = [
    priceBook.primary,
    priceBook.child,
    priceBook.onboarding,
    ...Object.values(priceBook.onboardingAllocations ?? {}),
  ].find((item) => item?.priceId === priceId)!
  return Promise.resolve({
    ...entry,
    active: true,
    stripeAccountId: priceBook.stripeAccountId,
    livemode: false,
  })
}

describe("signed agreement entitlement", () => {
  it("verifies EdDSA, expiry and every canonical stored field", async () => {
    const payload = await verifyEntitlementToken({
      token: compactJws(entitlement()),
      resolvePublicKey: async () =>
        publicKey.export({ type: "spki", format: "pem" }),
      now: NOW,
    })
    expect(() =>
      compareEntitlementToStoredRecord(payload, stored(payload), NOW)
    ).not.toThrow()
  })

  it("rejects a browser-tampered quantity and a stored-record mismatch", async () => {
    const token = compactJws(entitlement())
    const [header, body, signature] = token.split(".")
    const changed = entitlement({
      order: { ...entitlement().order, primaryQuantity: 5 },
    })
    const tampered = `${header}.${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`
    await expect(
      verifyEntitlementToken({
        token: tampered,
        resolvePublicKey: async () =>
          publicKey.export({ type: "spki", format: "pem" }),
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "invalid_signature" })

    expect(() =>
      compareEntitlementToStoredRecord(
        entitlement(),
        { ...stored(), childQuantity: 2 },
        NOW
      )
    ).toThrow("Signed child quantity does not match")
    expect(() =>
      compareEntitlementToStoredRecord(
        entitlement(),
        { ...stored(), environment: "test" },
        NOW
      )
    ).toThrow("Signed environment does not match")
    expect(body).toBeTruthy()
  })
})

describe("server-owned checkout preparation", () => {
  it("loads a versioned allowlist with fixed commercial values and no fallbacks", () => {
    const books = loadServerPriceBooks({
      RF_CHECKOUT_STRIPE_ACCOUNT_ID: "acct_fixture",
      RF_CHECKOUT_STRIPE_MODE: "test",
      RF_CHECKOUT_V1_PRIMARY_PRICE_ID: "price_primary",
      RF_CHECKOUT_V1_REFERRAL_PRIMARY_PRICE_ID: "price_referral_primary",
      RF_CHECKOUT_V1_CHILD_PRICE_ID: "price_child",
      RF_CHECKOUT_V1_ONBOARDING_PRICE_ID: "price_onboarding",
      RF_CHECKOUT_V1_ONBOARDING_75_PRICE_ID: "price_onboarding_75",
      RF_CHECKOUT_V1_ONBOARDING_50_PRICE_ID: "price_onboarding_50",
      RF_CHECKOUT_V1_ONBOARDING_3750_PRICE_ID: "price_onboarding_3750",
      RF_CHECKOUT_V1_ONBOARDING_30_PRICE_ID: "price_onboarding_30",
    })
    expect(books["rf-standard-usd-v1"].primary.unitAmount).toBe(35000)
    expect(books["rf-standard-usd-v1"].child.unitAmount).toBe(5000)
    expect(books["rf-standard-usd-v1"].onboarding.unitAmount).toBe(15000)
    expect(books["rf-referral-320-usd-v1"].primary.unitAmount).toBe(32000)
    expect(
      books["rf-standard-usd-v1"].onboardingAllocations?.[3750]?.unitAmount
    ).toBe(3750)
    expect(() => loadServerPriceBooks({})).toThrow(
      "RF_CHECKOUT_STRIPE_MODE is not configured"
    )
  })

  it("derives exact prices and quantities only from signed and stored authority", async () => {
    const payload = entitlement()
    const provider = {
      environment: "isolated_fixture" as const,
      stripeAccountId: "fixture:acct_checkout",
      createCheckout: vi.fn().mockResolvedValue({
        checkoutSessionId: "cs_fixture",
        checkoutUrl: "https://checkout.invalid/fixture",
      }),
    }
    const repository: CheckoutAttemptRepository = {
      findEntitlementByJti: vi.fn().mockResolvedValue(stored(payload)),
      claimAttempt: vi.fn().mockResolvedValue({
        id: "attempt_1",
        entitlementId: payload.sub,
        generation: 1,
        idempotencyKey: "rf-checkout-fixture-g1",
        state: "session_creating",
        checkoutSessionId: null,
        checkoutUrl: null,
      }),
      attachSession: vi.fn().mockResolvedValue({
        id: "attempt_1",
        entitlementId: payload.sub,
        generation: 1,
        idempotencyKey: "rf-checkout-fixture-g1",
        state: "session_open",
        checkoutSessionId: "cs_fixture",
        checkoutUrl: "https://checkout.invalid/fixture",
      }),
    }

    await prepareServerCheckout({
      entitlementToken: compactJws(payload),
      resolvePublicKey: async () =>
        publicKey.export({ type: "spki", format: "pem" }),
      repository,
      provider,
      inspectPrice,
      priceBooks: { [priceBook.version]: priceBook },
      allowProvisionalFixturePolicy: true,
      now: NOW,
    })

    expect(provider.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "rf-checkout-fixture-g1",
        onboardingGroupId: "22222222-2222-4222-8222-222222222222",
        billingAccountId: "33333333-3333-4333-8333-333333333333",
        accountSequence: 1,
        highLevelOpportunityId: "opportunity_123",
        lineItems: [
          {
            priceId: "price_onboarding",
            quantity: 1,
            kind: "one_time",
            unitAmount: 15000,
            currency: "usd",
          },
          {
            priceId: "price_primary",
            quantity: 2,
            kind: "recurring",
            unitAmount: 35000,
            currency: "usd",
          },
        ],
      })
    )
  })

  it("uses the allowlisted allocated fee price for a separate billing account", async () => {
    const separate = entitlement({
      onboardingGroup: {
        id: "22222222-2222-4222-8222-222222222222",
        billingAccountId: "44444444-4444-4444-8444-444444444444",
        accountSequence: 1,
        accountCount: 2,
        totalListingCount: 2,
        billingMode: "separate_per_listing",
      },
      order: {
        ...entitlement().order,
        primaryQuantity: 1,
        childQuantity: 0,
        onboardingFeeCents: 7500,
      },
    })
    await expect(
      resolveCanonicalLineItems({
        entitlement: separate,
        priceBooks: { [priceBook.version]: priceBook },
        inspectPrice,
        allowProvisionalFixturePolicy: true,
      })
    ).resolves.toEqual([
      {
        priceId: "price_onboarding_75",
        quantity: 1,
        kind: "one_time",
        unitAmount: 7500,
        currency: "usd",
      },
      {
        priceId: "price_primary",
        quantity: 1,
        kind: "recurring",
        unitAmount: 35000,
        currency: "usd",
      },
    ])
  })

  it("fails closed on tax outside the explicitly provisional isolated fixture", async () => {
    const payload = entitlement({ environment: "test" })
    await expect(
      prepareServerCheckout({
        entitlementToken: compactJws(payload),
        resolvePublicKey: async () =>
          publicKey.export({ type: "spki", format: "pem" }),
        repository: {
          findEntitlementByJti: vi.fn().mockResolvedValue(stored(payload)),
          claimAttempt: vi.fn(),
          attachSession: vi.fn(),
        },
        provider: {
          environment: "test",
          stripeAccountId: "acct_test",
          createCheckout: vi.fn(),
        },
        inspectPrice,
        priceBooks: { [priceBook.version]: priceBook },
        allowProvisionalFixturePolicy: true,
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "policy_blocked" })
  })

  it("structurally prevents an isolated entitlement from invoking a Test adapter", async () => {
    const payload = entitlement()
    await expect(
      prepareServerCheckout({
        entitlementToken: compactJws(payload),
        resolvePublicKey: async () =>
          publicKey.export({ type: "spki", format: "pem" }),
        repository: {
          findEntitlementByJti: vi.fn().mockResolvedValue(stored(payload)),
          claimAttempt: vi.fn(),
          attachSession: vi.fn(),
        },
        provider: {
          environment: "test",
          stripeAccountId: "acct_test",
          createCheckout: vi.fn(),
        },
        inspectPrice,
        priceBooks: { [priceBook.version]: priceBook },
        allowProvisionalFixturePolicy: true,
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "environment_mismatch" })
  })

  it("reuses one provider identity when two callers race the same agreement revision", async () => {
    const payload = entitlement()
    const attempt = {
      id: "attempt_concurrent",
      entitlementId: payload.sub,
      generation: 1,
      idempotencyKey: "rf-checkout-concurrent-g1",
      state: "session_creating" as const,
      checkoutSessionId: null,
      checkoutUrl: null,
    }
    const repository: CheckoutAttemptRepository = {
      findEntitlementByJti: vi.fn().mockResolvedValue(stored(payload)),
      claimAttempt: vi.fn().mockResolvedValue(attempt),
      attachSession: vi.fn().mockImplementation(async (input) => ({
        ...attempt,
        state: "session_open" as const,
        checkoutSessionId: input.checkoutSessionId,
        checkoutUrl: input.checkoutUrl,
      })),
    }
    const sessions = new Map<
      string,
      Promise<{ checkoutSessionId: string; checkoutUrl: string }>
    >()
    const provider = {
      environment: "isolated_fixture" as const,
      stripeAccountId: "fixture:acct_checkout",
      createCheckout: vi.fn((input: { idempotencyKey: string }) => {
        let existing = sessions.get(input.idempotencyKey)
        if (!existing) {
          existing = Promise.resolve({
            checkoutSessionId: "cs_one",
            checkoutUrl: "https://checkout.invalid/one",
          })
          sessions.set(input.idempotencyKey, existing)
        }
        return existing
      }),
    }
    const request = {
      entitlementToken: compactJws(payload),
      resolvePublicKey: async () =>
        publicKey.export({ type: "spki", format: "pem" }),
      repository,
      provider,
      inspectPrice,
      priceBooks: { [priceBook.version]: priceBook },
      allowProvisionalFixturePolicy: true,
      now: NOW,
    }
    const [first, second] = await Promise.all([
      prepareServerCheckout(request),
      prepareServerCheckout(request),
    ])
    expect(first.checkoutSessionId).toBe("cs_one")
    expect(second.checkoutSessionId).toBe("cs_one")
    expect(
      new Set(
        provider.createCheckout.mock.calls.map(([call]) => call.idempotencyKey)
      )
    ).toEqual(new Set(["rf-checkout-concurrent-g1"]))
  })
})

describe("provider reconciliation", () => {
  const trialEnd = Math.floor(
    new Date("2026-09-15T12:00:00.000Z").getTime() / 1000
  )
  const lines = [
    {
      priceId: "price_child",
      quantity: 1,
      kind: "recurring" as const,
      unitAmount: 5000,
      currency: "usd" as const,
    },
    {
      priceId: "price_onboarding",
      quantity: 1,
      kind: "one_time" as const,
      unitAmount: 15000,
      currency: "usd" as const,
    },
    {
      priceId: "price_primary",
      quantity: 2,
      kind: "recurring" as const,
      unitAmount: 35000,
      currency: "usd" as const,
    },
  ]
  const checkout: CanonicalProviderCheckout = {
    checkoutSessionId: "cs_fixture",
    stripeAccountId: "fixture:acct_checkout",
    livemode: false,
    environment: "isolated_fixture",
    customerId: "cus_fixture",
    entitlementId: "entitlement_1",
    onboardingGroupId: "22222222-2222-4222-8222-222222222222",
    billingAccountId: "33333333-3333-4333-8333-333333333333",
    agreementDocumentId: "doc_123",
    highLevelContactId: "contact_123",
    highLevelOpportunityId: "opportunity_123",
    serviceStartMode: "scheduled",
    serviceStartDate: "2026-09-15",
    lines,
    paymentStatus: "paid",
    checkoutSessionInvoiceId: "in_fixture",
    initialInvoiceId: "in_fixture",
    initialInvoiceStatus: "paid",
    initialInvoiceAmountDue: 15000,
    initialInvoiceAmountPaid: 15000,
    initialInvoiceCurrency: "usd",
    paymentIntentId: "pi_fixture",
    paymentIntentStatus: "succeeded",
    paymentIntentAmountReceived: 15000,
    subscriptionId: "sub_fixture",
    subscriptionStatus: "trialing",
    subscriptionLatestInvoiceId: "in_fixture",
    subscriptionTrialEnd: trialEnd,
  }
  const expected = {
    checkoutSessionId: checkout.checkoutSessionId,
    stripeAccountId: checkout.stripeAccountId,
    livemode: checkout.livemode,
    environment: checkout.environment,
    entitlementId: checkout.entitlementId,
    onboardingGroupId: checkout.onboardingGroupId,
    billingAccountId: checkout.billingAccountId,
    agreementDocumentId: checkout.agreementDocumentId,
    highLevelContactId: checkout.highLevelContactId,
    highLevelOpportunityId: checkout.highLevelOpportunityId,
    serviceStartMode: checkout.serviceStartMode,
    serviceStartDate: checkout.serviceStartDate,
    lines,
    expectedInitialAmount: 15000,
    expectedCurrency: "usd" as const,
    expectedTrialEnd: trialEnd,
  }
  const event = {
    id: "evt_1",
    type: "checkout.session.completed",
    created: 1787846400,
    checkoutSessionId: "cs_fixture",
    stripeAccountId: "fixture:acct_checkout",
    livemode: false,
    environment: "isolated_fixture" as const,
  }

  function ledger(): ReconciliationLedger {
    const seen = new Set<string>()
    return {
      expectedCheckout: vi.fn().mockResolvedValue(expected),
      reconcileProviderEventAtomic: vi.fn(async (input) => {
        const duplicate = seen.has(input.providerEventId)
        seen.add(input.providerEventId)
        return {
          result: "reconciled" as const,
          duplicate,
          attemptId: "attempt_1",
        }
      }),
      recordProviderConflictAtomic: vi.fn().mockResolvedValue({
        result: "conflict",
        duplicate: false,
        attemptId: "attempt_1",
      }),
    }
  }

  it("requires paid invoice, succeeded PaymentIntent, and exact scheduled trial", async () => {
    const eventLedger = ledger()
    const request = {
      rawBody: "signed-provider-payload",
      signature: "v1=fixture",
      verifyWebhook: vi.fn().mockResolvedValue(event),
      retrieveCheckout: vi.fn().mockResolvedValue(checkout),
      ledger: eventLedger,
    }
    await expect(reconcileSignedWebhook(request)).resolves.toEqual({
      result: "reconciled",
      duplicate: false,
      attemptId: "attempt_1",
    })
    await expect(reconcileSignedWebhook(request)).resolves.toEqual({
      result: "reconciled",
      duplicate: true,
      attemptId: "attempt_1",
    })
    expect(eventLedger.reconcileProviderEventAtomic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nextState: "payment_verified_scheduled",
        payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        ghlProjection: expect.objectContaining({
          stripe_subscription_id: "sub_fixture",
          stripe_initial_invoice_id: "in_fixture",
          stripe_payment_intent_id: "pi_fixture",
        }),
      })
    )
  })

  it("requires the setup fee plus first month and active state for immediate service", async () => {
    const eventLedger = ledger()
    vi.mocked(eventLedger.expectedCheckout).mockResolvedValue({
      ...expected,
      serviceStartMode: "immediate",
      serviceStartDate: null,
      expectedInitialAmount: 90000,
      expectedTrialEnd: null,
    })
    await expect(
      reconcileSignedWebhook({
        rawBody: "signed-immediate-provider-payload",
        signature: "v1=fixture",
        verifyWebhook: vi.fn().mockResolvedValue({
          ...event,
          id: "evt_immediate",
        }),
        retrieveCheckout: vi.fn().mockResolvedValue({
          ...checkout,
          serviceStartMode: "immediate",
          serviceStartDate: null,
          initialInvoiceAmountDue: 90000,
          initialInvoiceAmountPaid: 90000,
          paymentIntentAmountReceived: 90000,
          subscriptionStatus: "active",
          subscriptionTrialEnd: null,
        }),
        ledger: eventLedger,
      })
    ).resolves.toMatchObject({ result: "reconciled" })
  })

  it("maps normalized provider lines to the exact SQL RPC shape", async () => {
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> =
      []
    const database = {
      rpc: vi.fn(async (name: string, parameters: Record<string, unknown>) => {
        calls.push({ name, parameters })
        return {
          data: {
            result: "reconciled",
            duplicate: false,
            attempt_id: "attempt_1",
          },
          error: null,
        }
      }),
    }
    const repository = new DbReconciliationLedger(database)
    await repository.reconcileProviderEventAtomic({
      providerEventId: "evt_sql_shape",
      providerEventType: "checkout.session.completed",
      providerEventCreated: 1787846400,
      payloadSha256: "a".repeat(64),
      checkout: { ...checkout, lines: [...lines].reverse() },
      nextState: "payment_verified_scheduled",
      ghlProjection: {},
    })
    expect(calls[0].name).toBe("reconcile_server_checkout_event")
    expect(calls[0].parameters.p_provider_line_items).toEqual(lines)
    expect(calls[0].parameters).toMatchObject({
      p_initial_invoice_amount_paid: 15000,
      p_initial_invoice_currency: "usd",
      p_subscription_status: "trialing",
      p_subscription_trial_end: trialEnd,
    })
  })

  it.each([
    ["wrong account", { stripeAccountId: "fixture:wrong" }],
    ["wrong live mode", { livemode: true }],
    ["wrong currency", { initialInvoiceCurrency: "eur" }],
    ["wrong amount", { initialInvoiceAmountPaid: 14999 }],
    ["unpaid invoice", { initialInvoiceStatus: "open" as const }],
    ["missing invoice identity", { initialInvoiceId: "" }],
    [
      "wrong session invoice identity",
      { checkoutSessionInvoiceId: "in_other" },
    ],
    [
      "failed PaymentIntent",
      { paymentIntentStatus: "requires_payment_method" },
    ],
    [
      "missing invoice payment",
      { paymentStatus: "no_payment_required" as const },
    ],
    ["wrong trial end", { subscriptionTrialEnd: trialEnd + 1 }],
    ["wrong subscription state", { subscriptionStatus: "active" }],
    [
      "line-item shape mismatch",
      { lines: lines.map((line) => ({ ...line, kind: "recurring" as const })) },
    ],
  ])("durably records %s as a bounded conflict", async (_label, changes) => {
    const eventLedger = ledger()
    const result = await reconcileSignedWebhook({
      rawBody: "signed-conflicting-payload",
      signature: "v1=fixture",
      verifyWebhook: vi.fn().mockResolvedValue(event),
      retrieveCheckout: vi.fn().mockResolvedValue({ ...checkout, ...changes }),
      ledger: eventLedger,
    })
    expect(result.result).toBe("conflict")
    expect(eventLedger.reconcileProviderEventAtomic).not.toHaveBeenCalled()
    expect(eventLedger.recordProviderConflictAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        errorCode: expect.any(String),
        observation: expect.not.objectContaining({
          rawBody: expect.anything(),
        }),
      })
    )
  })
})

describe("legal gates and structural boundaries", () => {
  it("rejects illegal state changes and payment-only Assembly handoff", () => {
    expect(() =>
      reduceCheckoutState("session_open", "payment_verified")
    ).toThrow("cannot transition")
    expect(() =>
      buildAssemblyHandoffCandidate({
        onboardingRunId: "run_1",
        checkoutAttemptId: "attempt_1",
        checkoutState: "payment_verified",
        entitlementStatus: "active",
        agreementRevision: 4,
        currentAgreementRevision: 4,
        finalOnboardingSubmittedAt: null,
        hasOwnedException: false,
        hasIdentityConflict: false,
        hasProviderConflict: false,
      })
    ).toThrow("Final onboarding submission is required")
    const approvedGate = {
      onboardingRunId: "run_1",
      checkoutAttemptId: "attempt_1",
      checkoutState: "ghl_onboarding_unlocked",
      entitlementStatus: "active" as const,
      agreementRevision: 4,
      currentAgreementRevision: 4,
      finalOnboardingSubmittedAt: "2026-08-28T00:00:00.000Z",
      hasOwnedException: false,
      hasIdentityConflict: false,
      hasProviderConflict: false,
    } as const
    expect(buildAssemblyHandoffCandidate(approvedGate).dedupeKey).toBe(
      "rf.onboarding.v1:run_1"
    )
    expect(
      buildAssemblyHandoffCandidate({
        ...approvedGate,
        checkoutAttemptId: "attempt_replacement",
      }).dedupeKey
    ).toBe("rf.onboarding.v1:run_1")
    expect(() =>
      buildAssemblyHandoffCandidate({
        onboardingRunId: "run_1",
        checkoutAttemptId: "attempt_replacement",
        checkoutState: "ghl_onboarding_unlocked",
        entitlementStatus: "superseded",
        agreementRevision: 4,
        currentAgreementRevision: 5,
        finalOnboardingSubmittedAt: "2026-08-28T00:00:00.000Z",
        hasOwnedException: false,
        hasIdentityConflict: false,
        hasProviderConflict: false,
      })
    ).toThrow("Only the current active agreement revision")
  })

  it("blocks consolidated Assembly until every billing account is current and verified", () => {
    const accounts = [1, 2].map((sequence) => ({
      billingAccountId: `account_${sequence}`,
      checkoutAttemptId: `attempt_${sequence}`,
      checkoutState: "ghl_onboarding_unlocked" as const,
      entitlementStatus: "active" as const,
      agreementRevision: 1,
      currentAgreementRevision: 1,
      hasOwnedException: false,
      hasIdentityConflict: false,
      hasProviderConflict: false,
    }))
    expect(
      buildGroupAssemblyHandoffCandidate({
        onboardingRunId: "run_group",
        onboardingGroupId: "group_1",
        expectedBillingAccountCount: 2,
        expectedListingCount: 2,
        finalOnboardingSubmittedAt: "2026-09-03T20:00:00.000Z",
        accounts,
      })
    ).toMatchObject({
      dedupeKey: "rf.onboarding.v1:run_group",
      billingAccountIds: ["account_1", "account_2"],
    })
    expect(() =>
      buildGroupAssemblyHandoffCandidate({
        onboardingRunId: "run_group",
        onboardingGroupId: "group_1",
        expectedBillingAccountCount: 2,
        expectedListingCount: 2,
        finalOnboardingSubmittedAt: "2026-09-03T20:00:00.000Z",
        accounts: accounts.slice(0, 1),
      })
    ).toThrow("Every expected billing account")
    expect(() =>
      buildGroupAssemblyHandoffCandidate({
        onboardingRunId: "run_group",
        onboardingGroupId: "group_1",
        expectedBillingAccountCount: 2,
        expectedListingCount: 2,
        finalOnboardingSubmittedAt: "2026-09-03T20:00:00.000Z",
        accounts: [
          accounts[0],
          { ...accounts[1], checkoutState: "payment_failed" },
        ],
      })
    ).toThrow("Checkout has not passed")
  })

  it("keeps provider code free of GHL and Assembly clients and leaves the GHL worker disabled", () => {
    const root = path.join(process.cwd(), "lib/server-checkout")
    const files = readdirSync(root).filter((name) =>
      statSync(path.join(root, name)).isFile()
    )
    const sources = files.map((name) =>
      readFileSync(path.join(root, name), "utf8")
    )
    const webhook = readFileSync(
      path.join(root, "webhook-reconciliation.server.ts"),
      "utf8"
    )
    expect(webhook).not.toMatch(
      /highlevel-onboarding|lib\/assembly|setHighLevelContact|addHighLevelContactTags/
    )
    expect(sources.join("\n")).not.toContain("STRIPE_SECRET_KEY")
    expect(
      readFileSync(path.join(root, "ghl-sync-outbox.ts"), "utf8")
    ).toContain("GHL_CHECKOUT_SYNC_WORKER_ENABLED = false")
    const checkoutService = readFileSync(
      path.join(root, "checkout-service.server.ts"),
      "utf8"
    )
    expect(checkoutService).toContain("entitlementToken: string")
    expect(checkoutService).not.toMatch(
      /input\.(primaryQuantity|childQuantity|priceId|onboardingFee)/
    )
    expect(
      readFileSync(
        path.join(
          process.cwd(),
          "app/api/webhooks/highlevel/onboarding-checkout/route.ts"
        ),
        "utf8"
      )
    ).not.toContain("server-checkout/checkout-service")
  })

  it("migration 088 owns concurrency, replay, RLS and service-only writes", () => {
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260903190000_server_checkout_boundary.sql"
      ),
      "utf8"
    )
    expect(sql).toContain("FOR UPDATE")
    expect(sql).toContain("server_checkout_attempts_one_active_generation")
    expect(sql).toContain("provider_event_id TEXT NOT NULL UNIQUE")
    expect(sql).toContain("payment_verified_scheduled")
    expect(sql).toContain("service_billing_state")
    expect(sql).toContain("owned_exception_approver")
    expect(sql).toContain("enforce_server_checkout_transition_trigger")
    expect(sql).toContain(
      "enforce_server_checkout_service_billing_transition_trigger"
    )
    expect(sql).toContain("enforce_agreement_entitlement_immutability_trigger")
    expect(sql).toContain("stripe_initial_invoice_id")
    expect(sql).toContain("record_server_checkout_event_conflict")
    expect(sql).toContain("enforce_final_assembly_handoff_gate_trigger")
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)?.length).toBe(7)
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.server_checkout_attempts FROM PUBLIC, anon, authenticated"
    )
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.reconcile_server_checkout_event"
    )
    expect(sql).toContain("TO service_role")
    expect(sql).toContain("entitlement.environment <> 'isolated_fixture'")
    expect(sql).not.toMatch(/api\.assembly\.com|ASSEMBLY_API_KEY/)
  })

  it("keeps migration and TypeScript transition registries in exact parity", () => {
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260903190000_server_checkout_boundary.sql"
      ),
      "utf8"
    )
    const insert = sql.slice(
      sql.indexOf("INSERT INTO public.server_checkout_state_transitions"),
      sql.indexOf(
        "CREATE TABLE public.server_checkout_service_billing_transitions"
      )
    )
    const migrationPairs = new Set(
      [...insert.matchAll(/\('([^']+)', '([^']+)'\)/g)].map(
        (match) => `${match[1]}->${match[2]}`
      )
    )
    const applicationPairs = new Set(
      Object.entries(legalCheckoutTransitions).flatMap(([from, targets]) =>
        targets.map((to) => `${from}->${to}`)
      )
    )
    expect(migrationPairs).toEqual(applicationPairs)

    const billingInsert = sql.slice(
      sql.indexOf(
        "INSERT INTO public.server_checkout_service_billing_transitions"
      ),
      sql.indexOf(
        "CREATE OR REPLACE FUNCTION public.server_checkout_line_items_valid"
      )
    )
    const billingMigrationPairs = new Set(
      [...billingInsert.matchAll(/\('([^']+)', '([^']+)'\)/g)].map(
        (match) => `${match[1]}->${match[2]}`
      )
    )
    const billingApplicationPairs = new Set(
      Object.entries(legalServiceBillingTransitions).flatMap(
        ([from, targets]) => targets.map((to) => `${from}->${to}`)
      )
    )
    expect(billingMigrationPairs).toEqual(billingApplicationPairs)
  })

  it("adds per-account commercial authority and an all-accounts Assembly gate", () => {
    const sql = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260903200000_multi_business_onboarding.sql"
      ),
      "utf8"
    )
    expect(sql).toContain("CREATE TABLE public.onboarding_commercial_groups")
    expect(sql).toContain("CREATE TABLE public.onboarding_billing_accounts")
    expect(sql).toContain("highlevel_opportunity_id")
    expect(sql).toContain("onboarding_fee_total_cents = 15000")
    expect(sql).toContain(
      "monthly_amount_cents = monthly_rate_cents * listing_quantity"
    )
    expect(sql).toContain(
      "agreement_entitlements_one_active_billing_account_revision"
    )
    expect(sql).toContain("onboarding_group_commercially_complete")
    expect(sql).toContain(
      "Every billing account must be signed and payment-verified"
    )
    expect(sql).toContain("populate_multi_business_checkout_outbox_trigger")
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY")
    expect(sql).toContain("TO service_role")
    expect(sql).not.toMatch(/api\.assembly\.com|STRIPE_SECRET_KEY/)
  })
})
