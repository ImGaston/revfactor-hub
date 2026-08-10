import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  buildAirRoiNewPropertyDraft,
  buildAirRoiRevenueBriefDraft,
} from "@/lib/airroi.server"

const originalApiKey = process.env.AIRROI_API_KEY

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalApiKey === undefined) delete process.env.AIRROI_API_KEY
  else process.env.AIRROI_API_KEY = originalApiKey
})

const intake = {
  preparedFor: "Karl",
  propertyAddress: "121 South St, Willimantic, CT 06226",
  listingUrl: "https://www.airbnb.com/rooms/43036533",
  ownerGoals:
    "Protect peak dates and improve revenue without blanket discounting.",
  knownConstraints: "",
}

describe("AirROI server client", () => {
  it("keeps authentication server-side and requests one listing by extracted ID", async () => {
    process.env.AIRROI_API_KEY = "test-airroi-key"
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        listing_info: {
          listing_id: 43036533,
          listing_name: "121 South St",
          listing_type: "Entire home",
        },
        location_info: {
          locality: "Willimantic",
          region: "Connecticut",
        },
        property_details: {
          guests: 10,
          bedrooms: 4,
          beds: 6,
          baths: 3,
          amenities: [],
        },
        ratings: {
          num_reviews: 41,
          rating_overall: 4.96,
        },
        pricing_info: { currency: "USD" },
        performance_metrics: {
          ttm_revenue: 82000,
          ttm_avg_rate: 410,
          ttm_adjusted_occupancy: 0.61,
          ttm_adjusted_revpar: 250,
        },
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await buildAirRoiRevenueBriefDraft(intake)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin + url.pathname).toBe("https://api.airroi.com/listings")
    expect(url.searchParams.get("listing_id")).toBe("43036533")
    expect(options.headers).toEqual({ "X-API-KEY": "test-airroi-key" })
    expect(options.cache).toBe("no-store")
    expect(result.source.modeledTtmRevenue).toBe(82000)
  })

  it("fails before making a request when the API key is absent", async () => {
    delete process.env.AIRROI_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(buildAirRoiRevenueBriefDraft(intake)).rejects.toMatchObject({
      status: 503,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("requests a pre-launch estimate from the documented calculator endpoint", async () => {
    process.env.AIRROI_API_KEY = "test-airroi-key"
    const percentiles = {
      revenue: {
        avg: 50_000,
        p25: 40_000,
        p50: 48_000,
        p75: 55_000,
        p90: 62_000,
      },
      average_daily_rate: { avg: 200, p25: 170, p50: 195, p75: 220, p90: 250 },
      occupancy: { avg: 0.68, p25: 0.55, p50: 0.65, p75: 0.75, p90: 0.82 },
    }
    const comparable = (id: number) => ({
      listing_info: { listing_id: id, listing_name: `Comparable ${id}` },
      property_details: { bedrooms: 4 },
      performance_metrics: {
        ttm_revenue: 52_000,
        ttm_avg_rate: 205,
        ttm_occupancy: 0.66,
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        location: { latitude: 41.7, longitude: -72.2 },
        revenue: 50_000,
        average_daily_rate: 200,
        occupancy: 0.68,
        percentiles,
        currency: "USD",
        monthly_revenue_distributions: Array.from({ length: 12 }, () => 1 / 12),
        comparable_listings: [comparable(1), comparable(2), comparable(3)],
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await buildAirRoiNewPropertyDraft({
      preparedFor: "Morgan",
      propertyName: "Maple House",
      propertyAddress: "12 Main St, Stowe, VT 05672",
      bedrooms: 4,
      baths: 3,
      guests: 10,
      radiusMiles: 5,
      ownerGoals: "Build a conservative launch plan before signing management.",
      knownConstraints: "",
    })

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin + url.pathname).toBe(
      "https://api.airroi.com/calculator/estimate"
    )
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      address: "12 Main St, Stowe, VT 05672",
      bedrooms: "4",
      baths: "3",
      guests: "10",
      radius: "5",
      room_type: "entire_home",
    })
    expect(options.headers).toEqual({ "X-API-KEY": "test-airroi-key" })
    expect(result.projection.base.revenue).toBe(48_000)
  })
})
