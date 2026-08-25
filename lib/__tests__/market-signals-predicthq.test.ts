import { describe, expect, it, vi } from "vitest"

import {
  calculateMaterialityScore,
  shouldRetainProviderCandidate,
} from "@/lib/market-signals/domain"
import {
  fetchPredictHQEvents,
  normalizePredictHQEvent,
  parsePredictHQQueryConfig,
  type PredictHQMarket,
  type PredictHQRawEvent,
} from "@/lib/market-signals/predicthq"

const market: PredictHQMarket = {
  id: "76000000-0000-4000-8000-000000000001",
  name: "Washington, DC",
  countryCode: "US",
  timezone: "America/New_York",
  centerLat: 38.9072,
  centerLon: -77.0369,
  radiusMiles: 5,
  kind: "urban",
}

const rawEvent: PredictHQRawEvent = {
  id: "phq-nfl-draft",
  title: "2027 NFL Draft",
  category: "sports",
  rank: 92,
  local_rank: 96,
  phq_attendance: 250_000,
  predicted_event_spend: 50_000_000,
  predicted_event_spend_industries: { accommodation: 8_000_000 },
  entities: [{ name: "National Mall", type: "venue" }],
  start: "2027-04-29T16:00:00Z",
  end: "2027-05-02T02:00:00Z",
  predicted_end: null,
  updated: "2026-08-20T12:00:00Z",
  first_seen: "2025-05-05T12:00:00Z",
  timezone: "America/New_York",
  location: [-77.0353, 38.8895],
  geo: {
    address: {
      locality: "Washington",
      region: "District of Columbia",
      country_code: "US",
    },
  },
  country: "US",
  state: "active",
  deleted_reason: null,
  impact_patterns: [
    {
      vertical: "accommodation",
      impact_type: "phq_attendance",
      impacts: [
        { date_local: "2027-04-28", value: 25_000, position: "leading" },
        { date_local: "2027-05-02", value: 50_000, position: "lagging" },
      ],
    },
  ],
}

describe("PredictHQ adapter", () => {
  it("normalizes provider coordinates, venue, and accommodation impact days", () => {
    const candidate = normalizePredictHQEvent(rawEvent, market)

    expect(candidate.normalized).toMatchObject({
      sourceType: "predicthq",
      externalId: "phq-nfl-draft",
      venueName: "National Mall",
      city: "Washington",
      region: "District of Columbia",
      latitude: 38.8895,
      longitude: -77.0353,
      attendance: 250_000,
      localRank: 96,
    })
    expect(candidate.impactStart).toBe("2027-04-28")
    expect(candidate.impactEnd).toBe("2027-05-02")
    expect(candidate.accommodationSpend).toBe(8_000_000)
  })

  it("uses bounded defaults when source query config is absent", () => {
    expect(parsePredictHQQueryConfig(null)).toMatchObject({
      days_forward: 90,
      rank_gte: 40,
      max_events: 1000,
    })
  })

  it("builds the accommodation query and sends the token only as a bearer header", async () => {
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input.toString())
        expect(url.origin).toBe("https://api.predicthq.com")
        expect(url.searchParams.get("impact.industry")).toBe("accommodation")
        expect(url.searchParams.get("within")).toBe("5mi@38.9072,-77.0369")
        expect(url.searchParams.get("rank.gte")).toBe("40")
        expect(url.toString()).not.toContain("test-token")
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer test-token",
        })
        return new Response(
          JSON.stringify({
            count: 1,
            overflow: false,
            previous: null,
            next: null,
            results: [rawEvent],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
    )

    const result = await fetchPredictHQEvents({
      token: "test-token",
      market,
      queryConfig: parsePredictHQQueryConfig({}),
      highWaterMark: null,
      now: new Date("2026-08-21T12:00:00Z"),
      fetchImpl: fetchImpl as typeof fetch,
    })

    expect(result.events).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

describe("PredictHQ candidate materiality", () => {
  it("retains a major attended event while filtering weak predicted noise", () => {
    const major = calculateMaterialityScore({
      attendance: 250_000,
      localRank: 96,
      rank: 92,
      accommodationSpend: 8_000_000,
      category: "sports",
      marketKind: "urban",
      distanceMiles: 1.2,
      radiusMiles: 5,
    })
    const weak = calculateMaterialityScore({
      attendance: null,
      localRank: 20,
      rank: 20,
      accommodationSpend: null,
      category: "community",
      marketKind: "urban",
      distanceMiles: 4.8,
      radiusMiles: 5,
    })

    expect(major).toBeGreaterThanOrEqual(65)
    expect(
      shouldRetainProviderCandidate({
        providerStatus: "active",
        materialityScore: major,
      })
    ).toBe(true)
    expect(
      shouldRetainProviderCandidate({
        providerStatus: "predicted",
        materialityScore: weak,
      })
    ).toBe(false)
  })

  it("always retains cancellations for unwind review", () => {
    expect(
      shouldRetainProviderCandidate({
        providerStatus: "deleted:cancelled",
        materialityScore: 0,
      })
    ).toBe(true)
    expect(
      shouldRetainProviderCandidate({
        providerStatus: "deleted:duplicate",
        materialityScore: 90,
      })
    ).toBe(false)
  })
})
