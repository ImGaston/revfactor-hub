export type BillingMode = "single" | "separate_per_listing"
export type PricingProgram = "Regular" | "Referral"

export type GroupSignup = {
  billingMode: BillingMode
  contactName: string
  email: string
  phone: string | null
  totalListingCount: number
  legalBusinessNames: string[]
  pricingProgram: PricingProgram
}

export type FrozenBillingAccount = {
  sequence: number
  legalBusinessName: string
  normalizedLegalBusinessName: string
  listingQuantity: number
  monthlyRateCents: 32000 | 35000
  monthlyAmountCents: number
  onboardingFeeCents: number
  initialCheckoutTotalCents: number
  pricingProgram: PricingProgram
}

export type FrozenOnboardingGroup = {
  version: 1
  billingMode: BillingMode
  contactId: string
  contactName: string
  email: string
  totalListingCount: number
  pricingProgram: PricingProgram
  onboardingFeeTotalCents: 15000
  accounts: FrozenBillingAccount[]
}

export type AccountCommercialState =
  | "agreement_pending"
  | "agreement_signed"
  | "payment_pending"
  | "payment_verified"
  | "complete"
  | "manual_review"

export type GroupNextAction =
  | { kind: "agreement"; accountSequence: number; url: string }
  | { kind: "payment"; accountSequence: number; url: string }
  | { kind: "awaiting_provider"; accountSequence: number }
  | { kind: "onboarding"; url: string }
  | { kind: "manual_review"; accountSequence: number }

export const ONBOARDING_FEE_TOTAL_CENTS = 15000 as const

export function normalizeLegalBusinessName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

export function allocateOnboardingFee(accountCount: number): number[] {
  if (!Number.isInteger(accountCount) || accountCount < 1 || accountCount > 5) {
    throw new Error("Billing account count must be between 1 and 5")
  }
  const base = Math.floor(ONBOARDING_FEE_TOTAL_CENTS / accountCount)
  const remainder = ONBOARDING_FEE_TOTAL_CENTS - base * accountCount
  return Array.from(
    { length: accountCount },
    (_, index) => base + (index < remainder ? 1 : 0)
  )
}

export function freezeOnboardingGroup(input: {
  contactId: string
  signup: GroupSignup
}): FrozenOnboardingGroup {
  const { signup } = input
  if (
    !Number.isInteger(signup.totalListingCount) ||
    signup.totalListingCount < 1 ||
    signup.totalListingCount > 5
  ) {
    throw new Error("Listings must be between 1 and 5")
  }
  if (
    signup.billingMode === "separate_per_listing" &&
    signup.totalListingCount < 2
  ) {
    throw new Error("Separate billing requires at least two listings")
  }
  const expectedAccountCount =
    signup.billingMode === "single" ? 1 : signup.totalListingCount
  if (signup.legalBusinessNames.length !== expectedAccountCount) {
    throw new Error("Provide one legal business name for each billing account")
  }
  const normalizedNames = signup.legalBusinessNames.map((name) =>
    normalizeLegalBusinessName(name)
  )
  if (normalizedNames.some((name) => name.length < 2 || name.length > 255)) {
    throw new Error("Enter every legal business name")
  }
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    throw new Error(
      "Each separate billing account needs a distinct legal business name"
    )
  }

  const monthlyRateCents: 32000 | 35000 =
    signup.pricingProgram === "Referral" ? 32000 : 35000
  const allocatedFees = allocateOnboardingFee(expectedAccountCount)
  const accounts = signup.legalBusinessNames.map((legalBusinessName, index) => {
    const listingQuantity =
      signup.billingMode === "single" ? signup.totalListingCount : 1
    const monthlyAmountCents = listingQuantity * monthlyRateCents
    const onboardingFeeCents = allocatedFees[index]
    return {
      sequence: index + 1,
      legalBusinessName: legalBusinessName.trim().replace(/\s+/g, " "),
      normalizedLegalBusinessName: normalizedNames[index],
      listingQuantity,
      monthlyRateCents,
      monthlyAmountCents,
      onboardingFeeCents,
      initialCheckoutTotalCents: monthlyAmountCents + onboardingFeeCents,
      pricingProgram: signup.pricingProgram,
    }
  })

  const group = {
    version: 1 as const,
    billingMode: signup.billingMode,
    contactId: input.contactId,
    contactName: signup.contactName.trim().replace(/\s+/g, " "),
    email: signup.email.trim().toLocaleLowerCase(),
    totalListingCount: signup.totalListingCount,
    pricingProgram: signup.pricingProgram,
    onboardingFeeTotalCents: ONBOARDING_FEE_TOTAL_CENTS,
    accounts,
  }
  if (
    group.accounts.reduce(
      (sum, account) => sum + account.onboardingFeeCents,
      0
    ) !== ONBOARDING_FEE_TOTAL_CENTS
  ) {
    throw new Error("Onboarding fee allocation is invalid")
  }
  return group
}

export async function onboardingGroupFingerprint(group: FrozenOnboardingGroup) {
  const bytes = new TextEncoder().encode(JSON.stringify(group))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export function opportunityCommercialFields(account: FrozenBillingAccount) {
  return {
    rf_legal_business_name: account.legalBusinessName,
    rf_listing_quantity: String(account.listingQuantity),
    rf_pricing_program: account.pricingProgram,
    rf_monthly_rate: (account.monthlyRateCents / 100).toFixed(2),
    rf_monthly_amount: (account.monthlyAmountCents / 100).toFixed(2),
    rf_allocated_onboarding_fee: (account.onboardingFeeCents / 100).toFixed(2),
    rf_initial_checkout_total: (
      account.initialCheckoutTotalCents / 100
    ).toFixed(2),
  }
}

export function selectGroupNextAction(input: {
  accounts: Array<{
    sequence: number
    state: AccountCommercialState
    agreementUrl?: string | null
    checkoutUrl?: string | null
  }>
  onboardingUrl: string
}): GroupNextAction {
  const accounts = [...input.accounts].sort((a, b) => a.sequence - b.sequence)
  for (const account of accounts) {
    if (account.state === "manual_review") {
      return { kind: "manual_review", accountSequence: account.sequence }
    }
    if (account.state === "agreement_pending") {
      if (!account.agreementUrl) {
        return { kind: "awaiting_provider", accountSequence: account.sequence }
      }
      return {
        kind: "agreement",
        accountSequence: account.sequence,
        url: account.agreementUrl,
      }
    }
    if (
      account.state === "agreement_signed" ||
      account.state === "payment_pending"
    ) {
      if (!account.checkoutUrl) {
        return { kind: "awaiting_provider", accountSequence: account.sequence }
      }
      return {
        kind: "payment",
        accountSequence: account.sequence,
        url: account.checkoutUrl,
      }
    }
    if (account.state === "payment_verified") {
      return { kind: "awaiting_provider", accountSequence: account.sequence }
    }
  }
  if (
    accounts.length === 0 ||
    accounts.some((account) => account.state !== "complete")
  ) {
    throw new Error("Onboarding group has no valid next action")
  }
  return { kind: "onboarding", url: input.onboardingUrl }
}
