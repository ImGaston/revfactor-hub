import {
  CheckoutBoundaryError,
  type CheckoutState,
} from "@/lib/server-checkout/contracts"
import {
  normalizeCanonicalLineItems,
  type CanonicalLineItem,
} from "@/lib/server-checkout/price-book"
import { verifiedPaymentState } from "@/lib/server-checkout/state-machine"

type ProviderEnvironment = "isolated_fixture" | "test" | "live"

export type VerifiedProviderEvent = {
  id: string
  type: string
  created: number
  checkoutSessionId: string
  stripeAccountId: string
  livemode: boolean
  environment: ProviderEnvironment
}

export type CanonicalProviderCheckout = {
  checkoutSessionId: string
  stripeAccountId: string
  livemode: boolean
  environment: ProviderEnvironment
  customerId: string
  entitlementId: string
  onboardingGroupId: string
  billingAccountId: string
  agreementDocumentId: string
  highLevelContactId: string
  highLevelOpportunityId: string
  serviceStartMode: "immediate" | "scheduled"
  serviceStartDate: string | null
  lines: CanonicalLineItem[]
  paymentStatus: "paid" | "unpaid" | "no_payment_required"
  checkoutSessionInvoiceId: string | null
  initialInvoiceId: string
  initialInvoiceStatus: "draft" | "open" | "paid" | "void" | "uncollectible"
  initialInvoiceAmountDue: number
  initialInvoiceAmountPaid: number
  initialInvoiceCurrency: string
  paymentIntentId: string | null
  paymentIntentStatus: string | null
  paymentIntentAmountReceived: number
  subscriptionId: string
  subscriptionStatus: string
  subscriptionLatestInvoiceId: string | null
  subscriptionTrialEnd: number | null
}

export type ExpectedProviderCheckout = Pick<
  CanonicalProviderCheckout,
  | "checkoutSessionId"
  | "stripeAccountId"
  | "livemode"
  | "environment"
  | "entitlementId"
  | "onboardingGroupId"
  | "billingAccountId"
  | "agreementDocumentId"
  | "highLevelContactId"
  | "highLevelOpportunityId"
  | "serviceStartMode"
  | "serviceStartDate"
  | "lines"
> & {
  expectedInitialAmount: number
  expectedCurrency: "usd"
  expectedTrialEnd: number | null
}

export type ProviderConflictObservation = {
  checkoutSessionId: string
  stripeAccountId: string
  livemode: boolean
  environment: ProviderEnvironment
  paymentStatus?: string
  invoiceStatus?: string
  invoiceAmountDue?: number
  invoiceAmountPaid?: number
  invoiceCurrency?: string
  paymentIntentStatus?: string | null
  paymentIntentAmountReceived?: number
  subscriptionStatus?: string
  subscriptionTrialEnd?: number | null
}

export type WebhookVerifier = (
  rawBody: string,
  signature: string
) => Promise<VerifiedProviderEvent>
export type ProviderCheckoutRetriever = (
  checkoutSessionId: string
) => Promise<CanonicalProviderCheckout>

export type ReconciliationResult = {
  result: "reconciled" | "conflict"
  duplicate: boolean
  attemptId: string | null
}

export type ReconciliationLedger = {
  expectedCheckout(
    checkoutSessionId: string
  ): Promise<ExpectedProviderCheckout | null>
  reconcileProviderEventAtomic(input: {
    providerEventId: string
    providerEventType: string
    providerEventCreated: number
    payloadSha256: string
    checkout: CanonicalProviderCheckout
    nextState: CheckoutState
    ghlProjection: Record<string, string>
  }): Promise<ReconciliationResult>
  recordProviderConflictAtomic(input: {
    providerEventId: string
    providerEventType: string
    providerEventCreated: number
    payloadSha256: string
    checkoutSessionId: string
    errorCode: string
    observation: ProviderConflictObservation
  }): Promise<ReconciliationResult>
}

function exactLines(lines: readonly CanonicalLineItem[]) {
  return JSON.stringify(normalizeCanonicalLineItems(lines))
}

function assertProviderTruth(input: {
  event: VerifiedProviderEvent
  expected: ExpectedProviderCheckout
  actual: CanonicalProviderCheckout
}) {
  const { event, expected, actual } = input
  const fixedPairs: Array<[string, unknown, unknown]> = [
    ["event account", expected.stripeAccountId, event.stripeAccountId],
    ["event live mode", expected.livemode, event.livemode],
    ["event environment", expected.environment, event.environment],
    ["retrieved account", expected.stripeAccountId, actual.stripeAccountId],
    ["retrieved live mode", expected.livemode, actual.livemode],
    ["retrieved environment", expected.environment, actual.environment],
    ["session", expected.checkoutSessionId, actual.checkoutSessionId],
    ["entitlement", expected.entitlementId, actual.entitlementId],
    ["onboarding group", expected.onboardingGroupId, actual.onboardingGroupId],
    ["billing account", expected.billingAccountId, actual.billingAccountId],
    ["agreement", expected.agreementDocumentId, actual.agreementDocumentId],
    ["GHL contact", expected.highLevelContactId, actual.highLevelContactId],
    [
      "GHL opportunity",
      expected.highLevelOpportunityId,
      actual.highLevelOpportunityId,
    ],
    ["service-start mode", expected.serviceStartMode, actual.serviceStartMode],
    ["service-start date", expected.serviceStartDate, actual.serviceStartDate],
  ]
  const mismatch = fixedPairs.find(([, left, right]) => left !== right)
  if (mismatch) {
    throw new CheckoutBoundaryError(
      "provider_identity_conflict",
      `Provider ${mismatch[0]} does not match canonical state`
    )
  }
  if (exactLines(expected.lines) !== exactLines(actual.lines)) {
    throw new CheckoutBoundaryError(
      "provider_line_item_conflict",
      "Provider line items do not match canonical state"
    )
  }
  if (actual.paymentStatus !== "paid") {
    throw new CheckoutBoundaryError(
      "initial_payment_unverified",
      "The required nonzero initial payment is not paid"
    )
  }
  if (
    actual.initialInvoiceStatus !== "paid" ||
    actual.initialInvoiceAmountDue !== expected.expectedInitialAmount ||
    actual.initialInvoiceAmountPaid !== expected.expectedInitialAmount ||
    actual.initialInvoiceCurrency !== expected.expectedCurrency ||
    !actual.paymentIntentId ||
    actual.paymentIntentStatus !== "succeeded" ||
    actual.paymentIntentAmountReceived !== expected.expectedInitialAmount ||
    actual.subscriptionLatestInvoiceId !== actual.initialInvoiceId ||
    actual.checkoutSessionInvoiceId !== actual.initialInvoiceId
  ) {
    throw new CheckoutBoundaryError(
      "initial_invoice_conflict",
      "Initial invoice or PaymentIntent does not prove the canonical amount"
    )
  }
  if (!actual.subscriptionId || !actual.customerId) {
    throw new CheckoutBoundaryError(
      "provider_identity_conflict",
      "Provider did not return canonical billing identifiers"
    )
  }
  if (expected.serviceStartMode === "immediate") {
    if (
      actual.subscriptionStatus !== "active" ||
      actual.subscriptionTrialEnd !== null ||
      expected.expectedTrialEnd !== null
    ) {
      throw new CheckoutBoundaryError(
        "subscription_state_conflict",
        "Immediate service requires an active non-trialing subscription"
      )
    }
  } else if (
    actual.subscriptionStatus !== "trialing" ||
    actual.subscriptionTrialEnd !== expected.expectedTrialEnd ||
    expected.expectedTrialEnd === null
  ) {
    throw new CheckoutBoundaryError(
      "scheduled_trial_conflict",
      "Scheduled service requires the exact signed trial end"
    )
  }
}

function boundedObservation(
  event: VerifiedProviderEvent,
  checkout?: CanonicalProviderCheckout
): ProviderConflictObservation {
  return {
    checkoutSessionId: event.checkoutSessionId,
    stripeAccountId: event.stripeAccountId,
    livemode: event.livemode,
    environment: event.environment,
    ...(checkout
      ? {
          paymentStatus: checkout.paymentStatus,
          invoiceStatus: checkout.initialInvoiceStatus,
          invoiceAmountDue: checkout.initialInvoiceAmountDue,
          invoiceAmountPaid: checkout.initialInvoiceAmountPaid,
          invoiceCurrency: checkout.initialInvoiceCurrency,
          paymentIntentStatus: checkout.paymentIntentStatus,
          paymentIntentAmountReceived: checkout.paymentIntentAmountReceived,
          subscriptionStatus: checkout.subscriptionStatus,
          subscriptionTrialEnd: checkout.subscriptionTrialEnd,
        }
      : {}),
  }
}

// No GHL client is available here. Success and conflict outcomes both become a
// durable provider-event ledger result. Only a successful atomic transaction
// may create the disabled GHL outbox projection.
export async function reconcileSignedWebhook(input: {
  rawBody: string
  signature: string
  verifyWebhook: WebhookVerifier
  retrieveCheckout: ProviderCheckoutRetriever
  ledger: ReconciliationLedger
}): Promise<ReconciliationResult> {
  const event = await input.verifyWebhook(input.rawBody, input.signature)
  const payloadSha256 = createHash("sha256").update(input.rawBody).digest("hex")
  if (event.type !== "checkout.session.completed") {
    return input.ledger.recordProviderConflictAtomic({
      providerEventId: event.id,
      providerEventType: event.type,
      providerEventCreated: event.created,
      payloadSha256,
      checkoutSessionId: event.checkoutSessionId,
      errorCode: "unsupported_event",
      observation: boundedObservation(event),
    })
  }
  const expected = await input.ledger.expectedCheckout(event.checkoutSessionId)
  if (!expected) {
    return input.ledger.recordProviderConflictAtomic({
      providerEventId: event.id,
      providerEventType: event.type,
      providerEventCreated: event.created,
      payloadSha256,
      checkoutSessionId: event.checkoutSessionId,
      errorCode: "unknown_checkout",
      observation: boundedObservation(event),
    })
  }
  const checkout = await input.retrieveCheckout(event.checkoutSessionId)
  try {
    assertProviderTruth({ event, expected, actual: checkout })
  } catch (error) {
    if (!(error instanceof CheckoutBoundaryError)) throw error
    return input.ledger.recordProviderConflictAtomic({
      providerEventId: event.id,
      providerEventType: event.type,
      providerEventCreated: event.created,
      payloadSha256,
      checkoutSessionId: event.checkoutSessionId,
      errorCode: error.code,
      observation: boundedObservation(event, checkout),
    })
  }
  const nextState = verifiedPaymentState(checkout.serviceStartMode)
  return input.ledger.reconcileProviderEventAtomic({
    providerEventId: event.id,
    providerEventType: event.type,
    providerEventCreated: event.created,
    payloadSha256,
    checkout,
    nextState,
    ghlProjection: {
      onboarding_group_id: checkout.onboardingGroupId,
      billing_account_id: checkout.billingAccountId,
      highlevel_contact_id: checkout.highLevelContactId,
      highlevel_opportunity_id: checkout.highLevelOpportunityId,
      agreement_document_id: checkout.agreementDocumentId,
      checkout_session_id: checkout.checkoutSessionId,
      stripe_customer_id: checkout.customerId,
      stripe_subscription_id: checkout.subscriptionId,
      stripe_initial_invoice_id: checkout.initialInvoiceId,
      stripe_payment_intent_id: checkout.paymentIntentId!,
      payment_state: nextState,
    },
  })
}
import { createHash } from "node:crypto"
