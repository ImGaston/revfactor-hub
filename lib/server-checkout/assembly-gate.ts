import {
  CheckoutBoundaryError,
  type CheckoutState,
} from "@/lib/server-checkout/contracts"

export type AssemblyHandoffCandidate = {
  onboardingRunId: string
  checkoutAttemptId: string
  agreementRevision: number
  finalOnboardingSubmittedAt: string
  dedupeKey: string
}

// Payment alone is never an Assembly gate. A final, immutable onboarding
// submission is mandatory and owned exceptions remain human-only.
export function buildAssemblyHandoffCandidate(input: {
  onboardingRunId: string
  checkoutAttemptId: string
  checkoutState: CheckoutState
  entitlementStatus: "active" | "superseded" | "revoked"
  agreementRevision: number
  currentAgreementRevision: number
  finalOnboardingSubmittedAt: string | null
  hasOwnedException: boolean
  hasIdentityConflict: boolean
  hasProviderConflict: boolean
}): AssemblyHandoffCandidate {
  if (
    input.entitlementStatus !== "active" ||
    input.agreementRevision !== input.currentAgreementRevision
  ) {
    throw new CheckoutBoundaryError(
      "inactive_entitlement",
      "Only the current active agreement revision can trigger Assembly"
    )
  }
  if (
    input.hasOwnedException ||
    input.hasIdentityConflict ||
    input.hasProviderConflict
  ) {
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
    agreementRevision: input.agreementRevision,
    finalOnboardingSubmittedAt: input.finalOnboardingSubmittedAt,
    dedupeKey: `rf.onboarding.v1:${input.onboardingRunId}`,
  }
}
