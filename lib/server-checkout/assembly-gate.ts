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

export type GroupAssemblyAccount = {
  billingAccountId: string
  checkoutAttemptId: string
  checkoutState: CheckoutState
  entitlementStatus: "active" | "superseded" | "revoked"
  agreementRevision: number
  currentAgreementRevision: number
  hasOwnedException: boolean
  hasIdentityConflict: boolean
  hasProviderConflict: boolean
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

export function buildGroupAssemblyHandoffCandidate(input: {
  onboardingRunId: string
  onboardingGroupId: string
  expectedBillingAccountCount: number
  expectedListingCount: number
  finalOnboardingSubmittedAt: string | null
  accounts: GroupAssemblyAccount[]
}): AssemblyHandoffCandidate & {
  onboardingGroupId: string
  billingAccountIds: string[]
} {
  if (
    input.accounts.length !== input.expectedBillingAccountCount ||
    input.expectedBillingAccountCount < 1 ||
    input.expectedBillingAccountCount > input.expectedListingCount
  ) {
    throw new CheckoutBoundaryError(
      "group_incomplete",
      "Every expected billing account must be present"
    )
  }
  const accountIds = new Set(
    input.accounts.map((account) => account.billingAccountId)
  )
  if (accountIds.size !== input.accounts.length) {
    throw new CheckoutBoundaryError(
      "group_conflict",
      "Billing accounts must be unique within the onboarding group"
    )
  }
  for (const account of input.accounts) {
    buildAssemblyHandoffCandidate({
      onboardingRunId: input.onboardingRunId,
      checkoutAttemptId: account.checkoutAttemptId,
      checkoutState: account.checkoutState,
      entitlementStatus: account.entitlementStatus,
      agreementRevision: account.agreementRevision,
      currentAgreementRevision: account.currentAgreementRevision,
      finalOnboardingSubmittedAt: input.finalOnboardingSubmittedAt,
      hasOwnedException: account.hasOwnedException,
      hasIdentityConflict: account.hasIdentityConflict,
      hasProviderConflict: account.hasProviderConflict,
    })
  }
  const ordered = [...input.accounts].sort((left, right) =>
    left.billingAccountId.localeCompare(right.billingAccountId)
  )
  return {
    onboardingRunId: input.onboardingRunId,
    onboardingGroupId: input.onboardingGroupId,
    checkoutAttemptId: ordered[0].checkoutAttemptId,
    agreementRevision: ordered[0].agreementRevision,
    finalOnboardingSubmittedAt: input.finalOnboardingSubmittedAt!,
    billingAccountIds: ordered.map((account) => account.billingAccountId),
    dedupeKey: `rf.onboarding.v1:${input.onboardingRunId}`,
  }
}
