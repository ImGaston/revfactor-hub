import {
  CheckoutBoundaryError,
  type CheckoutState,
} from "@/lib/server-checkout/contracts"

export const legalCheckoutTransitions: Readonly<
  Record<CheckoutState, readonly CheckoutState[]>
> = {
  policy_blocked: ["eligible", "revoked"],
  eligible: ["session_creating", "policy_blocked", "revoked", "cancelled"],
  session_creating: [
    "session_open",
    "provider_conflict",
    "manual_review",
    "cancelled",
  ],
  session_open: [
    "checkout_completed_unverified",
    "session_expired",
    "payment_failed",
    "cancelled",
  ],
  session_expired: ["superseded", "cancelled"],
  checkout_completed_unverified: [
    "provider_reconciling",
    "provider_conflict",
    "manual_review",
  ],
  provider_reconciling: [
    "payment_verified",
    "payment_verified_scheduled",
    "payment_failed",
    "identity_conflict",
    "provider_conflict",
    "manual_review",
  ],
  payment_verified: [
    "ghl_sync_pending",
    "service_billing_active",
    "service_billing_failed",
    "manual_review",
  ],
  payment_verified_scheduled: [
    "ghl_sync_pending",
    "service_billing_active",
    "service_billing_failed",
    "manual_review",
  ],
  ghl_sync_pending: ["ghl_onboarding_unlocked", "manual_review"],
  ghl_onboarding_unlocked: [
    "service_billing_active",
    "service_billing_failed",
    "manual_review",
  ],
  service_billing_active: ["service_billing_failed", "manual_review"],
  service_billing_failed: [
    "service_billing_active",
    "manual_review",
    "cancelled",
  ],
  payment_failed: ["superseded", "manual_review", "cancelled"],
  identity_conflict: ["manual_review", "revoked"],
  provider_conflict: ["manual_review", "revoked"],
  manual_review: ["eligible", "revoked", "cancelled"],
  superseded: [],
  revoked: [],
  cancelled: [],
}

export function reduceCheckoutState(
  current: CheckoutState,
  next: CheckoutState
): CheckoutState {
  if (!legalCheckoutTransitions[current].includes(next)) {
    throw new CheckoutBoundaryError(
      "illegal_state_transition",
      `Checkout cannot transition from ${current} to ${next}`
    )
  }
  return next
}

export function verifiedPaymentState(
  serviceStartMode: "immediate" | "scheduled"
): CheckoutState {
  return serviceStartMode === "scheduled"
    ? "payment_verified_scheduled"
    : "payment_verified"
}
