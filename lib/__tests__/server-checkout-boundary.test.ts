import { generateKeyPairSync, sign } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import { buildAssemblyHandoffCandidate } from "@/lib/server-checkout/assembly-gate"
import { prepareServerCheckout } from "@/lib/server-checkout/checkout-service.server"
import type {
  EntitlementPayload,
  StoredEntitlement,
} from "@/lib/server-checkout/contracts"
import {
  compareEntitlementToStoredRecord,
  verifyEntitlementToken,
} from "@/lib/server-checkout/entitlement"
import type { PriceBook, ProviderPrice } from "@/lib/server-checkout/price-book"
import type { CheckoutAttemptRepository } from "@/lib/server-checkout/repository.server"
import { loadServerPriceBooks } from "@/lib/server-checkout/server-price-books.server"
import {
  legalCheckoutTransitions,
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
    highLevel: { locationId: "loc_123", contactId: "contact_123" },
    agreement: {
      documentId: "doc_123",
      templateId: "template_123",
      revision: 4,
      contentSha256: "a".repeat(64),
      signedAt: "2026-08-27T15:59:00.000Z",
    },
    order: {
      primaryQuantity: 2,
      childQuantity: 1,
      onboardingFeeCents: 15000,
      serviceStartMode: "scheduled",
      serviceStartDate: "2026-09-15",
      currency: "usd",
      priceBookVersion: "rf-usd-v1",
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
    highLevelLocationId: payload.highLevel.locationId,
    highLevelContactId: payload.highLevel.contactId,
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
  stripeAccountId: "acct_fixture",
  mode: "test",
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
}

function inspectPrice(priceId: string): Promise<ProviderPrice> {
  const entry = [priceBook.primary, priceBook.child, priceBook.onboarding].find(
    (item) => item.priceId === priceId
  )!
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
    expect(body).toBeTruthy()
  })
})

describe("server-owned checkout preparation", () => {
  it("loads a versioned allowlist with fixed commercial values and no fallbacks", () => {
    const books = loadServerPriceBooks({
      RF_CHECKOUT_STRIPE_ACCOUNT_ID: "acct_fixture",
      RF_CHECKOUT_STRIPE_MODE: "test",
      RF_CHECKOUT_V1_PRIMARY_PRICE_ID: "price_primary",
      RF_CHECKOUT_V1_CHILD_PRICE_ID: "price_child",
      RF_CHECKOUT_V1_ONBOARDING_PRICE_ID: "price_onboarding",
    })
    expect(books["rf-standard-usd-v1"].primary.unitAmount).toBe(35000)
    expect(books["rf-standard-usd-v1"].child.unitAmount).toBe(5000)
    expect(books["rf-standard-usd-v1"].onboarding.unitAmount).toBe(15000)
    expect(() => loadServerPriceBooks({})).toThrow(
      "RF_CHECKOUT_STRIPE_MODE is not configured"
    )
  })

  it("derives exact prices and quantities only from signed and stored authority", async () => {
    const payload = entitlement()
    const provider = {
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
        lineItems: [
          { priceId: "price_primary", quantity: 2, kind: "recurring" },
          { priceId: "price_child", quantity: 1, kind: "recurring" },
          { priceId: "price_onboarding", quantity: 1, kind: "one_time" },
        ],
      })
    )
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
        provider: { createCheckout: vi.fn() },
        inspectPrice,
        priceBooks: { [priceBook.version]: priceBook },
        allowProvisionalFixturePolicy: true,
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "policy_blocked" })
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
  const checkout: CanonicalProviderCheckout = {
    checkoutSessionId: "cs_fixture",
    paymentIntentId: null,
    subscriptionId: "sub_fixture",
    customerId: "cus_fixture",
    paymentStatus: "paid",
    subscriptionStatus: "trialing",
    entitlementId: "entitlement_1",
    agreementDocumentId: "doc_123",
    highLevelContactId: "contact_123",
    serviceStartMode: "scheduled",
    serviceStartDate: "2026-09-15",
    lines: [
      { priceId: "price_primary", quantity: 2 },
      { priceId: "price_child", quantity: 1 },
      { priceId: "price_onboarding", quantity: 1 },
    ],
  }

  it("uses signed webhook truth and atomically deduplicates replay", async () => {
    const seen = new Set<string>()
    const ledger: ReconciliationLedger = {
      expectedCheckout: vi.fn().mockResolvedValue({ ...checkout }),
      reconcileProviderEventAtomic: vi.fn(async (input) => {
        const duplicate = seen.has(input.providerEventId)
        seen.add(input.providerEventId)
        return { duplicate, attemptId: "attempt_1" }
      }),
    }
    const request = {
      rawBody: "signed-provider-payload",
      signature: "v1=fixture",
      verifyWebhook: vi.fn().mockResolvedValue({
        id: "evt_1",
        type: "checkout.session.completed",
        created: 1787846400,
        checkoutSessionId: "cs_fixture",
      }),
      retrieveCheckout: vi.fn().mockResolvedValue(checkout),
      ledger,
    }
    await expect(reconcileSignedWebhook(request)).resolves.toEqual({
      duplicate: false,
      attemptId: "attempt_1",
    })
    await expect(reconcileSignedWebhook(request)).resolves.toEqual({
      duplicate: true,
      attemptId: "attempt_1",
    })
    expect(ledger.reconcileProviderEventAtomic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        nextState: "payment_verified_scheduled",
        ghlProjection: expect.objectContaining({
          stripe_subscription_id: "sub_fixture",
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
        finalOnboardingSubmittedAt: null,
        hasOwnedException: false,
      })
    ).toThrow("Final onboarding submission is required")
    expect(
      buildAssemblyHandoffCandidate({
        onboardingRunId: "run_1",
        checkoutAttemptId: "attempt_1",
        checkoutState: "ghl_onboarding_unlocked",
        finalOnboardingSubmittedAt: "2026-08-28T00:00:00.000Z",
        hasOwnedException: false,
      }).dedupeKey
    ).toContain("rf.onboarding.final.v1")
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
        "supabase/migrations/088_server_checkout_boundary.sql"
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
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)?.length).toBe(5)
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
        "supabase/migrations/088_server_checkout_boundary.sql"
      ),
      "utf8"
    )
    const insert = sql.slice(
      sql.indexOf("INSERT INTO public.server_checkout_state_transitions"),
      sql.indexOf("CREATE TABLE public.server_checkout_attempts")
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
  })
})
