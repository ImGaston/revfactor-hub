import {
  CheckoutBoundaryError,
  type CheckoutState,
} from "@/lib/server-checkout/contracts"
import { verifiedPaymentState } from "@/lib/server-checkout/state-machine"

export type VerifiedProviderEvent = {
  id: string
  type: string
  created: number
  checkoutSessionId: string
}

export type CanonicalProviderCheckout = {
  checkoutSessionId: string
  paymentIntentId: string | null
  subscriptionId: string
  customerId: string
  paymentStatus: "paid" | "unpaid" | "no_payment_required"
  subscriptionStatus: string
  entitlementId: string
  agreementDocumentId: string
  highLevelContactId: string
  serviceStartMode: "immediate" | "scheduled"
  serviceStartDate: string | null
  lines: Array<{ priceId: string; quantity: number }>
}

export type ExpectedProviderCheckout = Omit<
  CanonicalProviderCheckout,
  | "paymentIntentId"
  | "subscriptionId"
  | "customerId"
  | "paymentStatus"
  | "subscriptionStatus"
>

export type WebhookVerifier = (
  rawBody: string,
  signature: string
) => Promise<VerifiedProviderEvent>
export type ProviderCheckoutRetriever = (
  checkoutSessionId: string
) => Promise<CanonicalProviderCheckout>

export type ReconciliationLedger = {
  expectedCheckout(
    checkoutSessionId: string
  ): Promise<ExpectedProviderCheckout | null>
  reconcileProviderEventAtomic(input: {
    providerEventId: string
    providerEventType: string
    providerEventCreated: number
    checkout: CanonicalProviderCheckout
    nextState: CheckoutState
    ghlProjection: Record<string, string>
  }): Promise<{ duplicate: boolean; attemptId: string }>
}

function sortedLines(lines: Array<{ priceId: string; quantity: number }>) {
  return [...lines].sort((a, b) => a.priceId.localeCompare(b.priceId))
}

function assertCanonicalMatch(
  expected: ExpectedProviderCheckout,
  actual: CanonicalProviderCheckout
) {
  const fixedPairs: Array<[string, unknown, unknown]> = [
    ["session", expected.checkoutSessionId, actual.checkoutSessionId],
    ["entitlement", expected.entitlementId, actual.entitlementId],
    ["agreement", expected.agreementDocumentId, actual.agreementDocumentId],
    ["GHL contact", expected.highLevelContactId, actual.highLevelContactId],
    ["service-start mode", expected.serviceStartMode, actual.serviceStartMode],
    ["service-start date", expected.serviceStartDate, actual.serviceStartDate],
  ]
  const mismatch = fixedPairs.find(([, left, right]) => left !== right)
  if (mismatch) {
    throw new CheckoutBoundaryError(
      "provider_conflict",
      `Provider ${mismatch[0]} does not match canonical state`
    )
  }
  if (
    JSON.stringify(sortedLines(expected.lines)) !==
    JSON.stringify(sortedLines(actual.lines))
  ) {
    throw new CheckoutBoundaryError(
      "provider_conflict",
      "Provider prices or quantities do not match canonical state"
    )
  }
  if (!actual.subscriptionId || !actual.customerId) {
    throw new CheckoutBoundaryError(
      "provider_conflict",
      "Provider did not return canonical billing identifiers"
    )
  }
  if (
    actual.paymentStatus !== "paid" &&
    actual.paymentStatus !== "no_payment_required"
  ) {
    throw new CheckoutBoundaryError(
      "payment_unverified",
      "Provider payment is not verified"
    )
  }
}

// This service has no GHL client. The sole side effect is an atomic ledger call
// that commits provider truth and a bounded outbox row in one DB transaction.
export async function reconcileSignedWebhook(input: {
  rawBody: string
  signature: string
  verifyWebhook: WebhookVerifier
  retrieveCheckout: ProviderCheckoutRetriever
  ledger: ReconciliationLedger
}): Promise<{ duplicate: boolean; attemptId: string }> {
  const event = await input.verifyWebhook(input.rawBody, input.signature)
  if (event.type !== "checkout.session.completed") {
    throw new CheckoutBoundaryError(
      "unsupported_event",
      "Provider event is not allowlisted"
    )
  }
  const expected = await input.ledger.expectedCheckout(event.checkoutSessionId)
  if (!expected) {
    throw new CheckoutBoundaryError(
      "unknown_checkout",
      "Checkout session is not in the canonical ledger"
    )
  }
  const checkout = await input.retrieveCheckout(event.checkoutSessionId)
  assertCanonicalMatch(expected, checkout)
  const nextState = verifiedPaymentState(checkout.serviceStartMode)
  return input.ledger.reconcileProviderEventAtomic({
    providerEventId: event.id,
    providerEventType: event.type,
    providerEventCreated: event.created,
    checkout,
    nextState,
    ghlProjection: {
      highlevel_contact_id: checkout.highLevelContactId,
      agreement_document_id: checkout.agreementDocumentId,
      checkout_session_id: checkout.checkoutSessionId,
      stripe_customer_id: checkout.customerId,
      stripe_subscription_id: checkout.subscriptionId,
      payment_state: nextState,
    },
  })
}
