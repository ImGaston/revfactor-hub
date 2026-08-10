import { describe, expect, it } from "vitest"

import {
  AirRoiEstimateResponseSchema,
  AirRoiNewPropertyIntakeSchema,
  mapAirRoiEstimateToRevenueBrief,
} from "@/lib/airroi-estimate"

const intake = AirRoiNewPropertyIntakeSchema.parse({
  preparedFor: "Morgan Owner",
  propertyName: "Maple House",
  propertyAddress: "12 Main St, Stowe, VT 05672",
  bedrooms: 4,
  baths: 3,
  guests: 10,
  radiusMiles: 5,
  ownerGoals: "Build a conservative launch plan before signing management.",
  knownConstraints: "Permit approval is still pending.",
})

const percentile = (p25: number, p50: number, p75: number, p90: number) => ({
  p25,
  p50,
  p75,
  p90,
})

describe("AirROI pre-launch estimates", () => {
  it("normalizes the tutorial response shape and monthly revenue dollars", () => {
    const response = AirRoiEstimateResponseSchema.parse({
      revenue: 72_000,
      adr: 350,
      occupancy: 0.62,
      percentiles: {
        revenue: percentile(54_000, 72_000, 91_000, 110_000),
        adr: percentile(290, 350, 410, 475),
        occupancy: percentile(0.48, 0.62, 0.72, 0.8),
      },
      currency: "USD",
      monthly_revenue_distributions: [
        4_000, 4_200, 4_800, 5_000, 5_600, 7_000, 8_000, 7_500, 6_000, 5_200,
        6_400, 8_300,
      ],
      comparable_listings: [1, 2, 3].map((index) => ({
        listing_id: `90000000000000000${index}`,
        name: `Comparable ${index}`,
        locality: "Stowe",
        region: "Vermont",
        bedrooms: 4,
        ttm_revenue: 60_000 + index * 5_000,
        ttm_avg_rate: 300 + index * 20,
        ttm_occupancy: 0.55 + index * 0.03,
      })),
    })

    const result = mapAirRoiEstimateToRevenueBrief(
      response,
      intake,
      "2026-08-10T14:00:00.000Z"
    )

    expect(result.projection).toMatchObject({
      provider: "AirROI",
      radiusMiles: 5,
      comparableCount: 3,
      conservative: { revenue: 54_000, adr: 290, occupancy: 0.48 },
      base: { revenue: 72_000, adr: 350, occupancy: 0.62 },
      strong: { revenue: 91_000, adr: 410, occupancy: 0.72 },
    })
    expect(
      result.projection.monthlyRevenueShares.reduce(
        (sum, value) => sum + value,
        0
      )
    ).toBeCloseTo(1)
    expect(result.projection.comparables[0]?.listingId).toBe(
      "900000000000000001"
    )
    expect(result.draft.listingStage).toBe("new")
    expect(result.draft.bottomLine).not.toContain("..")
  })

  it("accepts the nested OpenAPI response shape", () => {
    const response = AirRoiEstimateResponseSchema.safeParse({
      location: { latitude: 44.4654, longitude: -72.6874 },
      revenue: 72_000,
      average_daily_rate: 350,
      occupancy: 0.62,
      percentiles: {
        revenue: {
          avg: 72_000,
          ...percentile(54_000, 72_000, 91_000, 110_000),
        },
        average_daily_rate: { avg: 350, ...percentile(290, 350, 410, 475) },
        occupancy: { avg: 0.62, ...percentile(0.48, 0.62, 0.72, 0.8) },
      },
      currency: "USD",
      monthly_revenue_distributions: [
        0.05, 0.05, 0.06, 0.07, 0.08, 0.11, 0.13, 0.12, 0.09, 0.08, 0.07, 0.09,
      ],
      comparable_listings: [1, 2, 3].map((index) => ({
        listing_info: {
          listing_id: 43_036_530 + index,
          listing_name: `Nested comparable ${index}`,
        },
        location_info: { locality: "Stowe", region: "Vermont" },
        property_details: { bedrooms: 4 },
        performance_metrics: {
          ttm_revenue: 70_000,
          ttm_avg_rate: 340,
          ttm_adjusted_occupancy: 0.61,
        },
      })),
    })

    expect(response.success).toBe(true)
  })
})
