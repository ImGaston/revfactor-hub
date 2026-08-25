import { z } from "zod"

import {
  normalizedProviderEventSchema,
  type NormalizedProviderEvent,
} from "@/lib/market-signals/contracts"
import type {
  MarketSignalMarket,
  MarketSignalProviderCandidate,
} from "@/lib/market-signals/provider"

const predictHQImpactSchema = z.object({
  date_local: z.string().min(10),
  value: z.number().nullable().optional(),
  position: z.string().nullable().optional(),
})

const predictHQImpactPatternSchema = z.object({
  vertical: z.string(),
  impact_type: z.string().nullable().optional(),
  impacts: z.array(predictHQImpactSchema).default([]),
})

const predictHQEntitySchema = z.object({
  name: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  formatted_address: z.string().nullable().optional(),
})

export const predictHQEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  rank: z.number().min(0).max(100).nullable().optional(),
  local_rank: z.number().min(0).max(100).nullable().optional(),
  phq_attendance: z.number().nonnegative().nullable().optional(),
  predicted_event_spend: z.number().nonnegative().nullable().optional(),
  predicted_event_spend_industries: z
    .object({ accommodation: z.number().nonnegative().nullable().optional() })
    .passthrough()
    .nullable()
    .optional(),
  entities: z.array(predictHQEntitySchema).default([]),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }).nullable().optional(),
  predicted_end: z.iso.datetime({ offset: true }).nullable().optional(),
  updated: z.iso.datetime({ offset: true }),
  first_seen: z.iso.datetime({ offset: true }),
  timezone: z.string().nullable().optional(),
  location: z.tuple([z.number(), z.number()]).nullable().optional(),
  geo: z
    .object({
      address: z
        .object({
          locality: z.string().nullable().optional(),
          region: z.string().nullable().optional(),
          country_code: z.string().nullable().optional(),
        })
        .passthrough()
        .nullable()
        .optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  country: z.string().nullable().optional(),
  state: z.string().min(1),
  deleted_reason: z.string().nullable().optional(),
  impact_patterns: z.array(predictHQImpactPatternSchema).default([]),
})

const predictHQResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  overflow: z.boolean().default(false),
  next: z.string().url().nullable(),
  results: z.array(predictHQEventSchema),
})

const predictHQQueryConfigSchema = z.object({
  days_forward: z.number().int().min(1).max(730).default(90),
  rank_gte: z.number().int().min(0).max(100).default(40),
  max_events: z.number().int().min(1).max(5000).default(1000),
  categories: z
    .array(z.string().trim().min(1))
    .min(1)
    .default([
      "community",
      "conferences",
      "concerts",
      "expos",
      "festivals",
      "performing-arts",
      "sports",
    ]),
})

export type PredictHQRawEvent = z.infer<typeof predictHQEventSchema>
export type PredictHQQueryConfig = z.infer<typeof predictHQQueryConfigSchema>

export type PredictHQMarket = MarketSignalMarket

export type PredictHQCandidate = MarketSignalProviderCandidate & {
  normalized: NormalizedProviderEvent
}

export type PredictHQFetchResult = {
  events: PredictHQRawEvent[]
  totalAvailable: number
  overflow: boolean
}

export class PredictHQRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "PredictHQRequestError"
    this.status = status
  }
}

export function parsePredictHQQueryConfig(
  value: unknown
): PredictHQQueryConfig {
  const result = predictHQQueryConfigSchema.safeParse(value)
  return result.success ? result.data : predictHQQueryConfigSchema.parse({})
}

function dateOnly(value: string) {
  return value.slice(0, 10)
}

function providerStatus(event: PredictHQRawEvent) {
  if (event.state === "deleted" && event.deleted_reason) {
    return `${event.state}:${event.deleted_reason}`
  }
  return event.state
}

function impactWindow(event: PredictHQRawEvent) {
  const accommodation = event.impact_patterns.find(
    (pattern) => pattern.vertical === "accommodation"
  )
  const dates = (accommodation?.impacts ?? [])
    .map((impact) => impact.date_local.slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()

  const fallbackEnd = event.predicted_end ?? event.end ?? event.start
  return {
    start: dates[0] ?? dateOnly(event.start),
    end: dates.at(-1) ?? dateOnly(fallbackEnd),
  }
}

export function normalizePredictHQEvent(
  event: PredictHQRawEvent,
  market: PredictHQMarket
): PredictHQCandidate {
  const venue = event.entities.find((entity) => entity.type === "venue")
  const address = event.geo?.address
  const longitude = event.location?.[0] ?? null
  const latitude = event.location?.[1] ?? null
  const endDate = event.predicted_end ?? event.end ?? event.start
  const window = impactWindow(event)
  const normalized = normalizedProviderEventSchema.parse({
    sourceType: "predicthq",
    externalId: event.id,
    sourceUrl: `https://api.predicthq.com/v1/events/${encodeURIComponent(event.id)}/`,
    title: event.title,
    category: event.category,
    startDate: event.start,
    endDate,
    timezone: event.timezone ?? market.timezone,
    venueName: venue?.name?.trim() || null,
    city: address?.locality?.trim() || market.name.split(",")[0].trim(),
    region: address?.region?.trim() || null,
    countryCode:
      address?.country_code?.trim() ||
      event.country?.trim() ||
      market.countryCode,
    latitude,
    longitude,
    providerStatus: providerStatus(event),
    attendance: event.phq_attendance ?? null,
    localRank: event.local_rank ?? null,
    firstSeenAt: event.first_seen,
    updatedAt: event.updated,
  })

  return {
    normalized,
    providerState: providerStatus(event),
    rank: event.rank ?? null,
    accommodationSpend:
      event.predicted_event_spend_industries?.accommodation ?? null,
    impactStart: window.start,
    impactEnd: window.end,
    publisher: "PredictHQ",
    authorityTier: 2,
    verificationState: event.state === "active" ? "verified" : "unverified",
    evidenceSummary: `${event.title} is ${providerStatus(event)} in the PredictHQ Events feed.`,
  }
}

function assertPredictHQUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.hostname !== "api.predicthq.com") {
    throw new PredictHQRequestError(
      "PredictHQ returned an invalid pagination URL",
      502
    )
  }
  return url
}

async function fetchPredictHQPages(input: {
  url: URL
  token: string
  maxEvents: number
  fetchImpl: typeof fetch
}) {
  const events: PredictHQRawEvent[] = []
  let totalAvailable = 0
  let overflow = false
  let nextUrl: URL | null = input.url

  while (nextUrl && events.length < input.maxEvents) {
    const response = await input.fetchImpl(nextUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    })

    if (!response.ok) {
      const label = response.status === 429 ? "rate limited" : "request failed"
      throw new PredictHQRequestError(
        `PredictHQ ${label} with status ${response.status}`,
        response.status
      )
    }

    const page = predictHQResponseSchema.parse(await response.json())
    totalAvailable = Math.max(totalAvailable, page.count)
    overflow ||= page.overflow
    events.push(...page.results)
    nextUrl =
      page.next && events.length < input.maxEvents
        ? assertPredictHQUrl(page.next)
        : null
  }

  return {
    events: events.slice(0, input.maxEvents),
    totalAvailable,
    overflow,
  }
}

export async function fetchPredictHQEvents(input: {
  token: string
  market: PredictHQMarket
  queryConfig: PredictHQQueryConfig
  highWaterMark: string | null
  now?: Date
  fetchImpl?: typeof fetch
}): Promise<PredictHQFetchResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const now = input.now ?? new Date()
  const end = new Date(now)
  end.setUTCDate(end.getUTCDate() + input.queryConfig.days_forward)

  const discoveryUrl = new URL("https://api.predicthq.com/v1/events/")
  discoveryUrl.searchParams.set("impact.gte", dateOnly(now.toISOString()))
  discoveryUrl.searchParams.set("impact.lte", dateOnly(end.toISOString()))
  discoveryUrl.searchParams.set("impact.tz", input.market.timezone)
  discoveryUrl.searchParams.set("impact.industry", "accommodation")
  discoveryUrl.searchParams.set(
    "within",
    `${input.market.radiusMiles}mi@${input.market.centerLat},${input.market.centerLon}`
  )
  discoveryUrl.searchParams.set("country", input.market.countryCode)
  discoveryUrl.searchParams.set(
    "category",
    input.queryConfig.categories.join(",")
  )
  discoveryUrl.searchParams.set("state", "active,predicted")
  discoveryUrl.searchParams.set("rank.gte", String(input.queryConfig.rank_gte))
  discoveryUrl.searchParams.set("sort", "-local_rank,-rank")
  discoveryUrl.searchParams.set("limit", "200")

  const discovery = await fetchPredictHQPages({
    url: discoveryUrl,
    token: input.token,
    maxEvents: input.queryConfig.max_events,
    fetchImpl,
  })

  let changes: PredictHQFetchResult = {
    events: [],
    totalAvailable: 0,
    overflow: false,
  }
  if (input.highWaterMark) {
    const changesUrl = new URL("https://api.predicthq.com/v1/events/")
    changesUrl.searchParams.set("updated.gte", input.highWaterMark)
    changesUrl.searchParams.set("updated.tz", "UTC")
    changesUrl.searchParams.set(
      "within",
      `${input.market.radiusMiles}mi@${input.market.centerLat},${input.market.centerLon}`
    )
    changesUrl.searchParams.set("country", input.market.countryCode)
    changesUrl.searchParams.set("state", "active,predicted,deleted")
    changesUrl.searchParams.set("limit", "200")
    changes = await fetchPredictHQPages({
      url: changesUrl,
      token: input.token,
      maxEvents: Math.min(input.queryConfig.max_events, 1000),
      fetchImpl,
    })
  }

  const byId = new Map<string, PredictHQRawEvent>()
  for (const event of [...discovery.events, ...changes.events]) {
    const prior = byId.get(event.id)
    if (!prior || event.updated > prior.updated) byId.set(event.id, event)
  }

  return {
    events: Array.from(byId.values()),
    totalAvailable: discovery.totalAvailable,
    overflow: discovery.overflow || changes.overflow,
  }
}
