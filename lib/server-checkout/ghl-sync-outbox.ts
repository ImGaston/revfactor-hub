import { CheckoutBoundaryError } from "@/lib/server-checkout/contracts"

// Intentionally compile-time disabled in this Draft/Test stage. There is no
// worker, scheduler, route, or feature flag that can drain the outbox.
export const GHL_CHECKOUT_SYNC_WORKER_ENABLED = false as const

export type GhlCheckoutProjection = {
  highlevel_contact_id: string
  agreement_document_id: string
  checkout_session_id: string
  stripe_customer_id: string
  stripe_subscription_id: string
  payment_state: "payment_verified" | "payment_verified_scheduled"
}

export function assertGhlWorkerDisabled(): never {
  throw new CheckoutBoundaryError(
    "worker_disabled",
    "GHL checkout synchronization is disabled pending production authorization"
  )
}
