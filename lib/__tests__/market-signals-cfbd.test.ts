import { describe, expect, it, vi } from "vitest"

import {
  fetchCFBDGames,
  normalizeCFBDGame,
  parseCFBDQueryConfig,
  type CFBDRawGame,
} from "@/lib/market-signals/cfbd"
import type { MarketSignalMarket } from "@/lib/market-signals/provider"

const market: MarketSignalMarket = {
  id: "76000000-0000-4000-8000-000000000099",
  name: "East Hartford, CT",
  countryCode: "US",
  timezone: "America/New_York",
  centerLat: 41.7595675,
  centerLon: -72.6187728,
  radiusMiles: 20,
  kind: "urban",
}

const game: CFBDRawGame = {
  id: 401861962,
  season: 2026,
  week: 1,
  seasonType: "regular",
  startDate: "2026-09-05T16:00:00.000Z",
  startTimeTBD: false,
  completed: false,
  neutralSite: false,
  conferenceGame: false,
  attendance: null,
  venueId: 3892,
  venue: "Pratt & Whitney Stadium",
  homeTeam: "UConn",
  awayTeam: "Lafayette",
  venueDetails: {
    id: 3892,
    name: "Pratt & Whitney Stadium",
    capacity: 40000,
    city: "East Hartford",
    state: "CT",
    countryCode: "US",
    timezone: "America/New_York",
    latitude: 41.7595675,
    longitude: -72.6187728,
  },
}

const queryConfig = parseCFBDQueryConfig({
  team: "UConn",
  days_forward: 90,
  max_games: 40,
  home_only: true,
  official_schedule_url: "https://uconnhuskies.com/sports/football/schedule",
})

describe("College Football Data Market Signals adapter", () => {
  it("normalizes a home game without treating stadium capacity as attendance", () => {
    const candidate = normalizeCFBDGame(game, market, queryConfig)

    expect(candidate.normalized).toMatchObject({
      sourceType: "cfbd",
      externalId: "401861962",
      title: "UConn Football vs Lafayette",
      category: "college-football",
      venueName: "Pratt & Whitney Stadium",
      city: "East Hartford",
      region: "CT",
      attendance: null,
      latitude: 41.7595675,
      longitude: -72.6187728,
    })
    expect(candidate.impactStart).toBe("2026-09-04")
    expect(candidate.impactEnd).toBe("2026-09-06")
    expect(candidate.materialityFloor).toBe(55)
    expect(candidate.evidenceSummary).toContain(
      "capacity is not treated as attendance"
    )
  })

  it("uses a bearer credential, bounds the horizon, and filters to local home games", async () => {
    const key = "cfbd-key-that-must-not-leak"
    const awayGame = {
      ...game,
      id: 401861963,
      homeTeam: "Maryland",
      awayTeam: "UConn",
    }
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input.toString())
        expect(url.origin).toBe("https://api.collegefootballdata.com")
        expect(url.search).not.toContain(key)
        expect(init?.headers).toMatchObject({
          Authorization: `Bearer ${key}`,
        })
        if (url.pathname === "/games") {
          expect(url.searchParams.get("year")).toBe("2026")
          expect(url.searchParams.get("team")).toBe("UConn")
          return new Response(JSON.stringify([game, awayGame]), { status: 200 })
        }
        return new Response(JSON.stringify([game.venueDetails]), {
          status: 200,
        })
      }
    )

    const result = await fetchCFBDGames({
      apiKey: key,
      market,
      queryConfig,
      now: new Date("2026-09-02T12:00:00Z"),
      fetchImpl: fetchImpl as typeof fetch,
    })

    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.homeTeam).toBe("UConn")
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const failedFetch = vi.fn(async () => new Response(null, { status: 401 }))
    await expect(
      fetchCFBDGames({
        apiKey: key,
        market,
        queryConfig,
        fetchImpl: failedFetch as typeof fetch,
      })
    ).rejects.not.toThrow(key)
  })
})
