import { describe, expect, it } from "vitest"

import {
  AirRoiListingResponseSchema,
  AirRoiRevenueBriefIntakeSchema,
  extractAirbnbListingId,
  mapAirRoiListingToRevenueBrief,
} from "@/lib/airroi"

const intake = AirRoiRevenueBriefIntakeSchema.parse({
  preparedFor: "Karl",
  propertyAddress: "121 South St, Willimantic, CT 06226",
  listingUrl: "https://www.airbnb.com/rooms/43036533?source_impression_id=test",
  ownerGoals:
    "Protect peak dates and improve revenue without blanket discounting.",
  knownConstraints: "Two-car parking limit",
})

const listing = AirRoiListingResponseSchema.parse({
  listing_info: {
    listing_id: 43036533,
    listing_name: "121 South St",
    description: "Four-bedroom group home.",
    listing_type: "Entire home",
    room_type: "entire_home",
    cover_photo_url: "https://example.com/cover.jpg",
    guest_favorite: true,
  },
  host_info: {
    superhost: true,
    professional_management: false,
  },
  location_info: {
    country: "United States",
    region: "Connecticut",
    locality: "Willimantic",
    district: null,
    exact_location: false,
  },
  property_details: {
    guests: 10,
    bedrooms: 4,
    beds: 6,
    baths: 3,
    amenities: ["wifi", "free_parking_on_premises", "dedicated_workspace"],
  },
  booking_settings: {
    instant_book: false,
    min_nights: 2,
    cancellation_policy: "strict",
  },
  pricing_info: { currency: "USD" },
  ratings: {
    num_reviews: 41,
    rating_overall: 4.96,
  },
  performance_metrics: {
    ttm_revenue: 82000,
    ttm_avg_rate: 410,
    ttm_occupancy: 0.58,
    ttm_adjusted_occupancy: 0.61,
    ttm_revpar: 238,
    ttm_adjusted_revpar: 250,
  },
})

describe("AirROI revenue brief intake", () => {
  it("extracts only a numeric Airbnb listing ID from an Airbnb URL", () => {
    expect(extractAirbnbListingId(intake.listingUrl)).toBe("43036533")
    expect(
      extractAirbnbListingId("https://example.com/rooms/43036533")
    ).toBeNull()
    expect(
      extractAirbnbListingId("https://airbnb.com.evil.test/rooms/43036533")
    ).toBeNull()
  })

  it("maps AirROI listing facts into an analyst-reviewable brief draft", () => {
    const result = mapAirRoiListingToRevenueBrief(
      listing,
      intake,
      "2026-08-10T14:00:00.000Z"
    )

    expect(result.draft).toMatchObject({
      preparedFor: "Karl",
      propertyName: "121 South St",
      propertyAddress: "121 South St, Willimantic, CT 06226",
      locationLabel: "Willimantic, Connecticut",
      metrics: {
        rating: "4.96",
        reviews: "41",
        layout: "4BR / 3BA",
        guests: "10",
      },
    })
    expect(result.draft.strengths).toContain("guest-favorite status")
    expect(result.draft.visibleConstraints).toContain("Two-car parking limit")
    expect(result.source).toEqual({
      provider: "AirROI",
      listingId: "43036533",
      retrievedAt: "2026-08-10T14:00:00.000Z",
      currency: "USD",
      modeledTtmRevenue: 82000,
      modeledTtmAdr: 410,
      modeledTtmOccupancy: 0.61,
      modeledTtmRevpar: 250,
    })
  })
})
