import { describe, expect, it } from "vitest"
import {
  buildStandardOnboardingValues,
  getStandardServiceTrialEnd,
} from "@/lib/onboarding-signup"

const now = new Date("2026-08-21T12:00:00.000Z")

describe("standard onboarding signup", () => {
  it("calculates immediate standard pricing", () => {
    const values = buildStandardOnboardingValues(
      {
        legalName: "Ashwood LLC",
        contactName: "Test Client",
        email: "client@example.com",
        primaryListingQuantity: 2,
        childListingQuantity: 3,
        serviceStartMode: "immediate",
        serviceStartDate: null,
      },
      now,
    )

    expect(values).toMatchObject({
      pricingProgram: "Regular",
      primaryMonthlyAmount: 700,
      childMonthlyAmount: 150,
      monthlyServiceFee: 850,
      onboardingFee: 150,
      initialCheckoutTotal: 1000,
      serviceStartDate: null,
      trialEnd: undefined,
    })
  })

  it("charges onboarding now and delays recurring service for a scheduled start", () => {
    const values = buildStandardOnboardingValues(
      {
        legalName: "Ashwood LLC",
        contactName: "Test Client",
        email: "client@example.com",
        primaryListingQuantity: 1,
        childListingQuantity: 0,
        serviceStartMode: "scheduled",
        serviceStartDate: "2026-09-15",
      },
      now,
    )

    expect(values).toMatchObject({
      pricingProgram: "Regular - Monthly service begins September 15, 2026",
      monthlyServiceFee: 350,
      onboardingFee: 150,
      initialCheckoutTotal: 150,
      serviceStartDate: "2026-09-15",
      trialEnd: getStandardServiceTrialEnd("2026-09-15"),
    })
  })

  it("rejects scheduled dates outside the 3-to-120-day window", () => {
    expect(() =>
      buildStandardOnboardingValues(
        {
          legalName: "Ashwood LLC",
          contactName: "Test Client",
          email: "client@example.com",
          primaryListingQuantity: 1,
          childListingQuantity: 0,
          serviceStartMode: "scheduled",
          serviceStartDate: "2026-08-22",
        },
        now,
      ),
    ).toThrow("Scheduled service must begin between")
  })
})
