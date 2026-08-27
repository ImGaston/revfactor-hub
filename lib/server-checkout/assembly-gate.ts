import {
  CheckoutBoundaryError,
  type CheckoutState,
} from "@/lib/server-checkout/contracts"

export type AssemblyHandoffCandidate = {
  onboardingRunId: string
  checkoutAttemptId: string
  finalOnboardingSubmittedAt: string
  dedupeKey: string
}

// Payment alone is never an Assembly gate. A final, immutable onboarding
// submission is mandatory and owned exceptions remain human-only.
export function buildAssemblyHandoffCandidate(input: {
  onboardingRunId: string
  checkoutAttemptId: string
  checkoutState: CheckoutState
  finalOnboardingSubmittedAt: string | null
  hasOwnedException: boolean
}): AssemblyHandoffCandidate {
  if (input.hasOwnedException) {
    throw new CheckoutBoundaryError(
      "manual_review",
      "Owned exceptions cannot trigger Assembly"
    )
  }
  if (!input.finalOnboardingSubmittedAt) {
    throw new CheckoutBoundaryError(
      "onboarding_incomplete",
      "Final onboarding submission is required before Assembly handoff"
    )
  }
  if (
    !["ghl_onboarding_unlocked", "service_billing_active"].includes(
      input.checkoutState
    )
  ) {
    throw new CheckoutBoundaryError(
      "payment_gate_incomplete",
      "Checkout has not passed the GHL onboarding completion gate"
    )
  }
  return {
    onboardingRunId: input.onboardingRunId,
    checkoutAttemptId: input.checkoutAttemptId,
    finalOnboardingSubmittedAt: input.finalOnboardingSubmittedAt,
    dedupeKey: `rf.onboarding.final.v1:${input.onboardingRunId}:${input.checkoutAttemptId}`,
  }
}
