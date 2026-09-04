import { CheckoutBoundaryError } from "@/lib/server-checkout/contracts"

// Intentionally compile-time disabled in this Draft/Test stage. There is no
// worker, scheduler, route, or feature flag that can drain the outbox.
export const GHL_CHECKOUT_SYNC_WORKER_ENABLED = false as const

export type GhlCheckoutProjection = {
  onboarding_group_id: string
  billing_account_id: string
  highlevel_contact_id: string
  highlevel_opportunity_id: string
  agreement_document_id: string
  checkout_session_id: string
  stripe_customer_id: string
  stripe_subscription_id: string
  stripe_initial_invoice_id: string
  stripe_payment_intent_id: string
  payment_state: "payment_verified" | "payment_verified_scheduled"
}

export function assertGhlWorkerDisabled(): never {
  throw new CheckoutBoundaryError(
    "worker_disabled",
    "GHL checkout synchronization is disabled pending production authorization"
  )
}
