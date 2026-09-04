import { describe, expect, it } from "vitest"
import {
  allocateOnboardingFee,
  freezeOnboardingGroup,
  onboardingGroupFingerprint,
  opportunityCommercialFields,
  selectGroupNextAction,
  type GroupSignup,
} from "../src/multi-business"

function signup(overrides: Partial<GroupSignup> = {}): GroupSignup {
  return {
    billingMode: "single",
    contactName: "Ada Lovelace",
    email: "ada@example.com",
    phone: null,
    totalListingCount: 2,
    legalBusinessNames: ["Analytical Stays LLC"],
    pricingProgram: "Regular",
    ...overrides,
  }
}

describe("multi-business commercial authority", () => {
  it.each([
    [1, [15000]],
    [2, [7500, 7500]],
    [3, [5000, 5000, 5000]],
    [4, [3750, 3750, 3750, 3750]],
    [5, [3000, 3000, 3000, 3000, 3000]],
  ])(
    "allocates exactly one $150 group fee across %i accounts",
    (count, expected) => {
      expect(allocateOnboardingFee(count)).toEqual(expected)
      expect(
        allocateOnboardingFee(count).reduce((sum, fee) => sum + fee, 0)
      ).toBe(15000)
    }
  )

  it.each([1, 2, 3, 4, 5])(
    "freezes a single-business standard agreement for %i listings",
    async (listingCount) => {
      const group = freezeOnboardingGroup({
        contactId: `contact-single-${listingCount}`,
        signup: signup({ totalListingCount: listingCount }),
      })
      expect(group.accounts).toHaveLength(1)
      expect(group.accounts[0]).toMatchObject({
        listingQuantity: listingCount,
        monthlyRateCents: 35000,
        monthlyAmountCents: listingCount * 35000,
        onboardingFeeCents: 15000,
        initialCheckoutTotalCents: listingCount * 35000 + 15000,
      })
      await expect(onboardingGroupFingerprint(group)).resolves.toMatch(
        /^[a-f0-9]{64}$/
      )
    }
  )

  it.each([2, 3, 4, 5])(
    "freezes isolated referral terms for %i separate businesses",
    (listingCount) => {
      const names = Array.from(
        { length: listingCount },
        (_, index) => `Property ${index + 1} LLC`
      )
      const group = freezeOnboardingGroup({
        contactId: `contact-separate-${listingCount}`,
        signup: signup({
          billingMode: "separate_per_listing",
          totalListingCount: listingCount,
          legalBusinessNames: names,
          pricingProgram: "Referral",
        }),
      })
      expect(group.accounts).toHaveLength(listingCount)
      for (const [index, account] of group.accounts.entries()) {
        expect(account).toMatchObject({
          sequence: index + 1,
          legalBusinessName: names[index],
          listingQuantity: 1,
          monthlyRateCents: 32000,
          monthlyAmountCents: 32000,
          initialCheckoutTotalCents: 32000 + 15000 / listingCount,
        })
        expect(opportunityCommercialFields(account)).toMatchObject({
          rf_legal_business_name: names[index],
          rf_listing_quantity: "1",
          rf_pricing_program: "Referral",
          rf_monthly_rate: "320.00",
        })
      }
      expect(
        group.accounts.reduce(
          (sum, account) => sum + account.onboardingFeeCents,
          0
        )
      ).toBe(15000)
    }
  )

  it("rejects missing, duplicate, and browser-expanded billing accounts", () => {
    expect(() =>
      freezeOnboardingGroup({
        contactId: "contact-missing",
        signup: signup({
          billingMode: "separate_per_listing",
          totalListingCount: 2,
          legalBusinessNames: ["Only One LLC"],
        }),
      })
    ).toThrow("one legal business name")
    expect(() =>
      freezeOnboardingGroup({
        contactId: "contact-duplicate",
        signup: signup({
          billingMode: "separate_per_listing",
          totalListingCount: 2,
          legalBusinessNames: ["Same LLC", " same   llc "],
        }),
      })
    ).toThrow("distinct legal business name")
    expect(() =>
      freezeOnboardingGroup({
        contactId: "contact-extra",
        signup: signup({ legalBusinessNames: ["One LLC", "Injected LLC"] }),
      })
    ).toThrow("one legal business name")
  })

  it("requires at least two listings for separate billing", () => {
    expect(() =>
      freezeOnboardingGroup({
        contactId: "contact-separate-one",
        signup: signup({
          billingMode: "separate_per_listing",
          totalListingCount: 1,
          legalBusinessNames: ["Only Property LLC"],
        }),
      })
    ).toThrow("Separate billing requires at least two listings")
  })

  it("keeps the journey sequential and withholds onboarding until all accounts complete", () => {
    const base = [
      {
        sequence: 1,
        state: "complete" as const,
        agreementUrl: "https://sign/1",
        checkoutUrl: "https://pay/1",
      },
      {
        sequence: 2,
        state: "agreement_pending" as const,
        agreementUrl: "https://sign/2",
      },
    ]
    expect(
      selectGroupNextAction({
        accounts: base,
        onboardingUrl: "https://onboard",
      })
    ).toEqual({ kind: "agreement", accountSequence: 2, url: "https://sign/2" })
    expect(
      selectGroupNextAction({
        accounts: base.map((account) => ({
          ...account,
          state: "complete" as const,
        })),
        onboardingUrl: "https://onboard",
      })
    ).toEqual({ kind: "onboarding", url: "https://onboard" })
  })
})
