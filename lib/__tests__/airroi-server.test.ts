import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { buildAirRoiRevenueBriefDraft } from "@/lib/airroi.server"

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
})
