import { describe, expect, it, vi } from "vitest"

import {
  fetchNWSAlerts,
  normalizeNWSAlert,
  parseNWSQueryConfig,
  type NWSRawAlert,
} from "@/lib/market-signals/nws"
import type { MarketSignalMarket } from "@/lib/market-signals/provider"
import {
  fetchTicketmasterEvents,
  normalizeTicketmasterEvent,
  parseTicketmasterQueryConfig,
  type TicketmasterRawEvent,
} from "@/lib/market-signals/ticketmaster"

const market: MarketSignalMarket = {
  id: "76000000-0000-4000-8000-000000000001",
  name: "Washington, DC",
  countryCode: "US",
  timezone: "America/New_York",
  centerLat: 38.9072,
  centerLon: -77.0369,
  radiusMiles: 5,
  kind: "urban",
}

const ticketmasterEvent: TicketmasterRawEvent = {
  id: "tm-nfl-draft",
  name: "NFL Draft Experience",
  url: "https://www.ticketmaster.com/event/tm-nfl-draft",
  dates: {
    start: {
      dateTime: "2027-04-29T16:00:00Z",
      localDate: "2027-04-29",
      localTime: "12:00:00",
    },
    end: {
      dateTime: "2027-05-02T02:00:00Z",
      localDate: "2027-05-01",
      localTime: "22:00:00",
    },
    timezone: "America/New_York",
    status: { code: "onsale" },
  },
  sales: { public: { startDateTime: "2026-08-20T14:00:00Z" } },
  classifications: [
    {
      segment: { name: "Sports" },
      genre: { name: "Football" },
      subGenre: { name: "NFL" },
    },
  ],
  _embedded: {
    venues: [
      {
        name: "National Mall",
        city: { name: "Washington" },
        state: { name: "District of Columbia" },
        country: { countryCode: "US" },
        location: { latitude: "38.8895", longitude: "-77.0353" },
      },
    ],
  },
}

const nwsAlert: NWSRawAlert = {
  id: "https://api.weather.gov/alerts/alert-id",
  properties: {
    id: "urn:oid:alert-id",
    areaDesc: "District of Columbia",
    sent: "2026-08-25T12:00:00-04:00",
    effective: "2026-08-25T12:00:00-04:00",
    onset: "2026-08-25T14:00:00-04:00",
    expires: "2026-08-26T02:00:00-04:00",
    ends: "2026-08-26T00:00:00-04:00",
    status: "Actual",
    messageType: "Alert",
    category: "Met",
    severity: "Severe",
    certainty: "Likely",
    urgency: "Immediate",
    event: "Flash Flood Warning",
    headline: "Flash Flood Warning issued for Washington, DC",
  },
}

describe("Ticketmaster Market Signals adapter", () => {
  it("normalizes ticketed events without inventing attendance", () => {
    const candidate = normalizeTicketmasterEvent(ticketmasterEvent, market)
    expect(candidate.normalized).toMatchObject({
      sourceType: "ticketmaster",
      title: "NFL Draft Experience",
      category: "sports",
      venueName: "National Mall",
      attendance: null,
      latitude: 38.8895,
      longitude: -77.0353,
    })
    expect(candidate.verificationState).toBe("verified")
    expect(candidate.retentionFloor).toBe(10)
  })

  it("bounds pagination and never includes the key in thrown errors", async () => {
    const key = "consumer-key-that-must-not-leak"
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      expect(url.origin).toBe("https://app.ticketmaster.com")
      expect(url.searchParams.get("apikey")).toBe(key)
      expect(url.searchParams.get("latlong")).toBe("38.9072,-77.0369")
      return new Response(
        JSON.stringify({
          _embedded: { events: [ticketmasterEvent] },
          page: { totalElements: 1, totalPages: 1, number: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    })
    const result = await fetchTicketmasterEvents({
      apiKey: key,
      market,
      queryConfig: parseTicketmasterQueryConfig({ max_events: 25 }),
      now: new Date("2026-08-25T12:00:00Z"),
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(result.events).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledOnce()

    const failedFetch = vi.fn(async () => new Response(null, { status: 401 }))
    await expect(
      fetchTicketmasterEvents({
        apiKey: key,
        market,
        queryConfig: parseTicketmasterQueryConfig({}),
        fetchImpl: failedFetch as typeof fetch,
      })
    ).rejects.not.toThrow(key)
  })
})

describe("NWS Market Signals adapter", () => {
  it("maps official severity to an auditable materiality floor", () => {
    const candidate = normalizeNWSAlert(nwsAlert, market)
    expect(candidate.normalized).toMatchObject({
      sourceType: "nws",
      category: "weather",
      city: "Washington",
      latitude: market.centerLat,
      longitude: market.centerLon,
    })
    expect(candidate.authorityTier).toBe(1)
    expect(candidate.materialityFloor).toBe(70)
    expect(candidate.verificationState).toBe("verified")
  })

  it("identifies the application and scopes active alerts to the market point", async () => {
    const userAgent = "(hub.revfactor.io, info@revfactor.io)"
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input.toString())
        expect(url.origin).toBe("https://api.weather.gov")
        expect(url.searchParams.get("point")).toBe("38.9072,-77.0369")
        expect(init?.headers).toMatchObject({
          Accept: "application/geo+json",
          "User-Agent": userAgent,
        })
        return new Response(JSON.stringify({ features: [nwsAlert] }), {
          status: 200,
          headers: { "Content-Type": "application/geo+json" },
        })
      }
    )
    const result = await fetchNWSAlerts({
      userAgent,
      market,
      queryConfig: parseNWSQueryConfig({}),
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(result.events).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
