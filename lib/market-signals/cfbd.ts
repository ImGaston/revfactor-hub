import { z } from "zod"

import { normalizedProviderEventSchema } from "@/lib/market-signals/contracts"
import { distanceMiles } from "@/lib/market-signals/domain"
import {
  MarketSignalProviderRequestError,
  type MarketSignalMarket,
  type MarketSignalProviderCandidate,
  type MarketSignalProviderFetchResult,
} from "@/lib/market-signals/provider"

const cfbdGameSchema = z.object({
  id: z.number().int().positive(),
  season: z.number().int().min(2000).max(2200),
  week: z.number().int().nonnegative(),
  seasonType: z.string().min(1),
  startDate: z.iso.datetime({ offset: true }),
  startTimeTBD: z.boolean(),
  completed: z.boolean(),
  neutralSite: z.boolean(),
  conferenceGame: z.boolean(),
  attendance: z.number().int().nonnegative().nullable(),
  venueId: z.number().int().positive().nullable(),
  venue: z.string().nullable(),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
})

const cfbdVenueSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  capacity: z.number().int().nonnegative().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  countryCode: z.string().length(2).nullable(),
  timezone: z.string().nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
})

const cfbdQueryConfigSchema = z.object({
  team: z.string().trim().min(1).max(120),
  days_forward: z.number().int().min(1).max(730).default(370),
  max_games: z.number().int().min(1).max(100).default(40),
  home_only: z.boolean().default(true),
  official_schedule_url: z.string().url().optional(),
})

export type CFBDRawGame = z.infer<typeof cfbdGameSchema> & {
  venueDetails: z.infer<typeof cfbdVenueSchema> | null
}
export type CFBDQueryConfig = z.infer<typeof cfbdQueryConfigSchema>

type Venue = z.infer<typeof cfbdVenueSchema>

let venueCache: { expiresAt: number; venues: Venue[] } | null = null

export function parseCFBDQueryConfig(value: unknown): CFBDQueryConfig {
  return cfbdQueryConfigSchema.parse(value)
}

function addHours(value: string, hours: number) {
  return new Date(
    new Date(value).getTime() + hours * 60 * 60 * 1000
  ).toISOString()
}

function impactDate(value: string, dayOffset: number) {
  const date = new Date(value)
  date.setUTCDate(date.getUTCDate() + dayOffset)
  return date.toISOString().slice(0, 10)
}

function capacityMaterialityFloor(capacity: number | null) {
  if (capacity != null && capacity >= 60_000) return 65
  if (capacity != null && capacity >= 40_000) return 55
  if (capacity != null && capacity >= 25_000) return 45
  return 35
}

function providerStatus(game: CFBDRawGame) {
  if (game.completed) return "completed"
  if (game.startTimeTBD) return "time_tbd"
  return "scheduled"
}

export function normalizeCFBDGame(
  game: CFBDRawGame,
  market: MarketSignalMarket,
  queryConfig: CFBDQueryConfig
): MarketSignalProviderCandidate {
  const venue = game.venueDetails
  const status = providerStatus(game)
  const endDate = addHours(game.startDate, 4)
  const sourceUrl =
    queryConfig.official_schedule_url ?? "https://collegefootballdata.com/"
  const normalized = normalizedProviderEventSchema.parse({
    sourceType: "cfbd",
    externalId: String(game.id),
    sourceUrl,
    title: `${game.homeTeam} Football vs ${game.awayTeam}`,
    category: "college-football",
    startDate: game.startDate,
    endDate,
    timezone: venue?.timezone?.trim() || market.timezone,
    venueName: venue?.name.trim() || game.venue?.trim() || null,
    city: venue?.city?.trim() || market.name.split(",")[0].trim(),
    region: venue?.state?.trim() || null,
    countryCode: venue?.countryCode?.trim() || market.countryCode,
    latitude: venue?.latitude ?? null,
    longitude: venue?.longitude ?? null,
    providerStatus: status,
    attendance: game.completed ? game.attendance : null,
    localRank: null,
    // CFBD does not expose schedule publication/revision timestamps. These
    // stable values avoid manufacturing a content change on every sync; Hub
    // provider records separately retain the real first/last observation.
    firstSeenAt: game.startDate,
    updatedAt: game.startDate,
  })
  const capacity = venue?.capacity ?? null

  return {
    normalized,
    providerState: status,
    rank: null,
    accommodationSpend: null,
    impactStart: impactDate(game.startDate, -1),
    impactEnd: impactDate(endDate, 1),
    publisher: "College Football Data",
    authorityTier: 2,
    verificationState: "verified",
    evidenceSummary: [
      `College Football Data lists ${game.homeTeam} vs ${game.awayTeam} in week ${game.week}.`,
      capacity == null
        ? null
        : `${venue?.name ?? "The venue"} has a listed capacity of ${capacity.toLocaleString("en-US")}; capacity is not treated as attendance.`,
      game.completed && game.attendance != null
        ? `Reported attendance was ${game.attendance.toLocaleString("en-US")}.`
        : null,
    ]
      .filter((value): value is string => value != null)
      .join(" "),
    materialityFloor: capacityMaterialityFloor(capacity),
    retentionFloor: 25,
  }
}

async function requestCFBD(url: URL, apiKey: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const label = response.status === 429 ? "rate limited" : "request failed"
    throw new MarketSignalProviderRequestError(
      "College Football Data",
      `College Football Data ${label} with status ${response.status}`,
      response.status
    )
  }
  return response.json()
}

async function fetchVenues(input: {
  apiKey: string
  fetchImpl: typeof fetch
  cacheAllowed: boolean
}) {
  if (input.cacheAllowed && venueCache && venueCache.expiresAt > Date.now()) {
    return venueCache.venues
  }
  const value = await requestCFBD(
    new URL("https://api.collegefootballdata.com/venues"),
    input.apiKey,
    input.fetchImpl
  )
  const venues = z.array(cfbdVenueSchema).parse(value)
  if (input.cacheAllowed) {
    venueCache = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, venues }
  }
  return venues
}

export async function fetchCFBDGames(input: {
  apiKey: string
  market: MarketSignalMarket
  queryConfig: CFBDQueryConfig
  now?: Date
  fetchImpl?: typeof fetch
}): Promise<MarketSignalProviderFetchResult<CFBDRawGame>> {
  const now = input.now ?? new Date()
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() + input.queryConfig.days_forward)
  const fetchImpl = input.fetchImpl ?? fetch
  const seasons: number[] = []
  for (
    let year = now.getUTCFullYear();
    year <= cutoff.getUTCFullYear();
    year += 1
  ) {
    seasons.push(year)
  }

  const seasonResponses = await Promise.all(
    seasons.map(async (year) => {
      const url = new URL("https://api.collegefootballdata.com/games")
      url.searchParams.set("year", String(year))
      url.searchParams.set("team", input.queryConfig.team)
      return z
        .array(cfbdGameSchema)
        .parse(await requestCFBD(url, input.apiKey, fetchImpl))
    })
  )
  const games = seasonResponses.flat().filter((game) => {
    const start = new Date(game.startDate).getTime()
    if (start < now.getTime() || start > cutoff.getTime()) return false
    if (
      input.queryConfig.home_only &&
      game.homeTeam.toLowerCase() !== input.queryConfig.team.toLowerCase()
    ) {
      return false
    }
    return true
  })

  const venues = await fetchVenues({
    apiKey: input.apiKey,
    fetchImpl,
    cacheAllowed: input.fetchImpl == null,
  })
  const venuesById = new Map(venues.map((venue) => [venue.id, venue]))
  const inMarket = games
    .map(
      (game): CFBDRawGame => ({
        ...game,
        venueDetails:
          game.venueId == null ? null : (venuesById.get(game.venueId) ?? null),
      })
    )
    .filter((game) => {
      const venue = game.venueDetails
      if (venue?.latitude == null || venue.longitude == null) return true
      return (
        distanceMiles(
          {
            latitude: input.market.centerLat,
            longitude: input.market.centerLon,
          },
          { latitude: venue.latitude, longitude: venue.longitude }
        ) <= input.market.radiusMiles
      )
    })
    .sort(
      (first, second) =>
        new Date(first.startDate).getTime() -
        new Date(second.startDate).getTime()
    )

  return {
    events: inMarket.slice(0, input.queryConfig.max_games),
    totalAvailable: inMarket.length,
    overflow: inMarket.length > input.queryConfig.max_games,
  }
}
