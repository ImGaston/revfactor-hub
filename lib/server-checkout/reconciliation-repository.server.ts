import { normalizeCanonicalLineItems } from "@/lib/server-checkout/price-book"
import type { RpcResult } from "@/lib/server-checkout/repository.server"
import type {
  CanonicalProviderCheckout,
  ExpectedProviderCheckout,
  ProviderConflictObservation,
  ReconciliationLedger,
  ReconciliationResult,
} from "@/lib/server-checkout/webhook-reconciliation.server"

type RpcClient = {
  rpc(name: string, parameters: Record<string, unknown>): RpcResult<unknown>
}

function result(data: unknown): ReconciliationResult {
  const row = data as Record<string, unknown> | null
  if (!row) throw new Error("Reconciliation RPC returned no result")
  return {
    result: row.result as ReconciliationResult["result"],
    duplicate: Boolean(row.duplicate),
    attemptId: row.attempt_id ? String(row.attempt_id) : null,
  }
}

export class DbReconciliationLedger implements ReconciliationLedger {
  constructor(private readonly database: RpcClient) {}

  async expectedCheckout(
    checkoutSessionId: string
  ): Promise<ExpectedProviderCheckout | null> {
    const response = await this.database.rpc("get_server_checkout_expected", {
      p_checkout_session_id: checkoutSessionId,
    })
    if (response.error) throw new Error(response.error.message)
    if (!response.data) return null
    const row = response.data as ExpectedProviderCheckout
    return { ...row, lines: normalizeCanonicalLineItems(row.lines) }
  }

  async reconcileProviderEventAtomic(input: {
    providerEventId: string
    providerEventType: string
    providerEventCreated: number
    payloadSha256: string
    checkout: CanonicalProviderCheckout
    nextState: Parameters<
      ReconciliationLedger["reconcileProviderEventAtomic"]
    >[0]["nextState"]
    ghlProjection: Record<string, string>
  }): Promise<ReconciliationResult> {
    const checkout = input.checkout
    const response = await this.database.rpc(
      "reconcile_server_checkout_event",
      {
        p_provider_event_id: input.providerEventId,
        p_provider_event_type: input.providerEventType,
        p_provider_event_created: input.providerEventCreated,
        p_payload_sha256: input.payloadSha256,
        p_checkout_session_id: checkout.checkoutSessionId,
        p_stripe_account_id: checkout.stripeAccountId,
        p_provider_environment: checkout.environment,
        p_livemode: checkout.livemode,
        p_provider_line_items: normalizeCanonicalLineItems(checkout.lines),
        p_stripe_customer_id: checkout.customerId,
        p_stripe_subscription_id: checkout.subscriptionId,
        p_stripe_initial_invoice_id: checkout.initialInvoiceId,
        p_checkout_session_invoice_id: checkout.checkoutSessionInvoiceId,
        p_stripe_payment_intent_id: checkout.paymentIntentId,
        p_payment_status: checkout.paymentStatus,
        p_initial_invoice_status: checkout.initialInvoiceStatus,
        p_initial_invoice_amount_due: checkout.initialInvoiceAmountDue,
        p_initial_invoice_amount_paid: checkout.initialInvoiceAmountPaid,
        p_initial_invoice_currency: checkout.initialInvoiceCurrency,
        p_payment_intent_status: checkout.paymentIntentStatus,
        p_payment_intent_amount_received: checkout.paymentIntentAmountReceived,
        p_subscription_status: checkout.subscriptionStatus,
        p_subscription_trial_end: checkout.subscriptionTrialEnd,
        p_next_state: input.nextState,
      }
    )
    if (response.error) throw new Error(response.error.message)
    return result(response.data)
  }

  async recordProviderConflictAtomic(input: {
    providerEventId: string
    providerEventType: string
    providerEventCreated: number
    payloadSha256: string
    checkoutSessionId: string
    errorCode: string
    observation: ProviderConflictObservation
  }): Promise<ReconciliationResult> {
    const response = await this.database.rpc(
      "record_server_checkout_event_conflict",
      {
        p_provider_event_id: input.providerEventId,
        p_provider_event_type: input.providerEventType,
        p_provider_event_created: input.providerEventCreated,
        p_payload_sha256: input.payloadSha256,
        p_checkout_session_id: input.checkoutSessionId,
        p_stripe_account_id: input.observation.stripeAccountId,
        p_provider_environment: input.observation.environment,
        p_livemode: input.observation.livemode,
        p_error_code: input.errorCode,
        p_observation: input.observation,
      }
    )
    if (response.error) throw new Error(response.error.message)
    return result(response.data)
  }
}
