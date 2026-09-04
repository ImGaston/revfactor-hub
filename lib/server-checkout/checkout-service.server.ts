import { CheckoutBoundaryError } from "@/lib/server-checkout/contracts"
import {
  agreementRevisionIdentity,
  compareEntitlementToStoredRecord,
  verifyEntitlementToken,
  type EntitlementKeyResolver,
} from "@/lib/server-checkout/entitlement"
import {
  resolveCanonicalLineItems,
  type PriceBook,
  type PriceInspector,
} from "@/lib/server-checkout/price-book"
import type { CheckoutAttemptRepository } from "@/lib/server-checkout/repository.server"

export type CheckoutProviderAdapter = {
  environment: "isolated_fixture" | "test" | "live"
  stripeAccountId: string
  createCheckout(input: {
    idempotencyKey: string
    entitlementId: string
    onboardingGroupId: string
    billingAccountId: string
    accountSequence: number
    highLevelContactId: string
    highLevelOpportunityId: string
    agreementDocumentId: string
    serviceStartMode: "immediate" | "scheduled"
    serviceStartDate: string | null
    lineItems: Array<{
      priceId: string
      quantity: number
      kind: "one_time" | "recurring"
      unitAmount: number
      currency: "usd"
    }>
  }): Promise<{ checkoutSessionId: string; checkoutUrl: string }>
}

// The only browser-controlled value is the signed token. Price IDs, quantities,
// account, cadence and tax policy are all recovered from verified server state.
export async function prepareServerCheckout(input: {
  entitlementToken: string
  resolvePublicKey: EntitlementKeyResolver
  repository: CheckoutAttemptRepository
  provider: CheckoutProviderAdapter
  inspectPrice: PriceInspector
  priceBooks: Readonly<Record<string, PriceBook>>
  now?: Date
  allowProvisionalFixturePolicy?: boolean
}): Promise<{
  attemptId: string
  checkoutSessionId: string
  checkoutUrl: string
  reused: boolean
}> {
  const entitlement = await verifyEntitlementToken({
    token: input.entitlementToken,
    resolvePublicKey: input.resolvePublicKey,
    now: input.now,
  })
  const stored = await input.repository.findEntitlementByJti(entitlement.jti)
  if (!stored) {
    throw new CheckoutBoundaryError(
      "unknown_entitlement",
      "Entitlement is not present in the canonical ledger"
    )
  }
  compareEntitlementToStoredRecord(entitlement, stored, input.now)

  const lineItems = await resolveCanonicalLineItems({
    entitlement,
    priceBooks: input.priceBooks,
    inspectPrice: input.inspectPrice,
    allowProvisionalFixturePolicy: input.allowProvisionalFixturePolicy,
  })
  if (
    input.provider.environment !== entitlement.environment ||
    input.provider.stripeAccountId !== entitlement.order.stripeAccountId
  ) {
    throw new CheckoutBoundaryError(
      "environment_mismatch",
      "Provider adapter is not bound to the signed environment and account"
    )
  }
  const identitySha256 = agreementRevisionIdentity(entitlement)
  const attempt = await input.repository.claimAttempt(
    stored.id,
    identitySha256,
    lineItems
  )
  if (attempt.checkoutSessionId && attempt.checkoutUrl) {
    return {
      attemptId: attempt.id,
      checkoutSessionId: attempt.checkoutSessionId,
      checkoutUrl: attempt.checkoutUrl,
      reused: true,
    }
  }

  const checkout = await input.provider.createCheckout({
    idempotencyKey: attempt.idempotencyKey,
    entitlementId: stored.id,
    onboardingGroupId: stored.onboardingGroupId,
    billingAccountId: stored.billingAccountId,
    accountSequence: stored.accountSequence,
    highLevelContactId: stored.highLevelContactId,
    highLevelOpportunityId: stored.highLevelOpportunityId,
    agreementDocumentId: stored.agreementDocumentId,
    serviceStartMode: stored.serviceStartMode,
    serviceStartDate: stored.serviceStartDate,
    lineItems,
  })
  const saved = await input.repository.attachSession({
    attemptId: attempt.id,
    expectedState: "session_creating",
    checkoutSessionId: checkout.checkoutSessionId,
    checkoutUrl: checkout.checkoutUrl,
  })
  return {
    attemptId: saved.id,
    checkoutSessionId: checkout.checkoutSessionId,
    checkoutUrl: checkout.checkoutUrl,
    reused: false,
  }
}
