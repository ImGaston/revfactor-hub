import { describe, expect, it } from "vitest"
import { buildOnboardingCheckoutLineItems } from "@/lib/stripe"

describe("buildOnboardingCheckoutLineItems", () => {
  it("includes primary, child, and onboarding products with locked quantities", () => {
    expect(
      buildOnboardingCheckoutLineItems({
        primaryPriceId: "price_primary",
        primaryQuantity: 2,
        childPriceId: "price_child",
        childQuantity: 3,
        onboardingPriceId: "price_onboarding",
        includeOnboardingFee: true,
      }),
    ).toEqual([
      { price: "price_primary", quantity: 2 },
      { price: "price_child", quantity: 3 },
      { price: "price_onboarding", quantity: 1 },
    ])
  })

  it("omits zero-quantity child listings and a waived onboarding fee", () => {
    expect(
      buildOnboardingCheckoutLineItems({
        primaryPriceId: "price_primary",
        primaryQuantity: 1,
        childPriceId: "price_child",
        childQuantity: 0,
        onboardingPriceId: "price_onboarding",
        includeOnboardingFee: false,
      }),
    ).toEqual([{ price: "price_primary", quantity: 1 }])
  })
})
