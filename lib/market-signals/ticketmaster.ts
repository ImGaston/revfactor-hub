import { z } from "zod"

import { normalizedProviderEventSchema } from "@/lib/market-signals/contracts"
import {
  MarketSignalProviderRequestError,
  type MarketSignalMarket,
  type MarketSignalProviderCandidate,
  type MarketSignalProviderFetchResult,
} from "@/lib/market-signals/provider"

const namedValueSchema = z.object({ name: z.string().nullable().optional() })

const ticketmasterEventSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url().nullable().optional(),
  dates: z.object({
    start: z.object({
      dateTime: z.iso.datetime({ offset: true }).nullable().optional(),
      localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      localTime: z.string().nullable().optional(),
    }),
    end: z
      .object({
        dateTime: z.iso.datetime({ offset: true }).nullable().optional(),
        localDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        localTime: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    timezone: z.string().nullable().optional(),
    status: z
      .object({ code: z.string().min(1) })
      .nullable()
      .optional(),
  }),
  sales: z
    .object({
      public: z
        .object({
          startDateTime: z.iso.datetime({ offset: true }).nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  classifications: z
    .array(
      z.object({
        segment: namedValueSchema.nullable().optional(),
        genre: namedValueSchema.nullable().optional(),
        subGenre: namedValueSchema.nullable().optional(),
      })
    )
    .default([]),
  _embedded: z
    .object({
      venues: z
        .array(
          z.object({
            name: z.string().nullable().optional(),
            city: namedValueSchema.nullable().optional(),
            state: namedValueSchema.nullable().optional(),
            country: z
              .object({ countryCode: z.string().nullable().optional() })
              .nullable()
              .optional(),
            location: z
              .object({
                latitude: z.string().nullable().optional(),
                longitude: z.string().nullable().optional(),
              })
              .nullable()
              .optional(),
          })
        )
        .default([]),
    })
    .default({ venues: [] }),
})

const ticketmasterResponseSchema = z.object({
  _embedded: z
    .object({ events: z.array(ticketmasterEventSchema).default([]) })
    .default({ events: [] }),
  page: z
    .object({
      totalElements: z.number().int().nonnegative().default(0),
      totalPages: z.number().int().nonnegative().default(0),
      number: z.number().int().nonnegative().default(0),
    })
    .default({ totalElements: 0, totalPages: 0, number: 0 }),
})

const ticketmasterQueryConfigSchema = z.object({
  days_forward: z.number().int().min(1).max(365).default(180),
  max_events: z.number().int().min(1).max(1000).default(300),
  segments: z
    .array(z.string().trim().min(1))
    .default(["Music", "Sports", "Arts & Theatre", "Miscellaneous"]),
})

export type TicketmasterRawEvent = z.infer<typeof ticketmasterEventSchema>
export type TicketmasterQueryConfig = z.infer<
  typeof ticketmasterQueryConfigSchema
>

export function parseTicketmasterQueryConfig(
  value: unknown
): TicketmasterQueryConfig {
  const parsed = ticketmasterQueryConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : ticketmasterQueryConfigSchema.parse({})
}

function localDateFallback(date: string, time?: string | null) {
  const normalizedTime = /^\d{2}:\d{2}(:\d{2})?$/.test(time ?? "")
    ? time!
    : "12:00:00"
  return `${date}T${normalizedTime.length === 5 ? `${normalizedTime}:00` : normalizedTime}Z`
}

function categoryFor(event: TicketmasterRawEvent) {
  const classification = event.classifications[0]
  return (
    classification?.segment?.name ??
    classification?.genre?.name ??
    "ticketed-event"
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
}

export function normalizeTicketmasterEvent(
  event: TicketmasterRawEvent,
  market: MarketSignalMarket
): MarketSignalProviderCandidate {
  const venue = event._embedded.venues[0]
  const startDate =
    event.dates.start.dateTime ??
    localDateFallback(event.dates.start.localDate, event.dates.start.localTime)
  const rawEnd = event.dates.end?.dateTime
    ? event.dates.end.dateTime
    : event.dates.end?.localDate
      ? localDateFallback(event.dates.end.localDate, event.dates.end.localTime)
      : startDate
  const endDate =
    new Date(rawEnd).getTime() >= new Date(startDate).getTime()
      ? rawEnd
      : startDate
  const publishedAt = event.sales?.public?.startDateTime ?? startDate
  const status = event.dates.status?.code ?? "scheduled"
  const latitude = venue?.location?.latitude
    ? Number(venue.location.latitude)
    : null
  const longitude = venue?.location?.longitude
    ? Number(venue.location.longitude)
    : null
  const normalized = normalizedProviderEventSchema.parse({
    sourceType: "ticketmaster",
    externalId: event.id,
    sourceUrl: event.url ?? null,
    title: event.name,
    category: categoryFor(event),
    startDate,
    endDate,
    timezone: event.dates.timezone ?? market.timezone,
    venueName: venue?.name?.trim() || null,
    city: venue?.city?.name?.trim() || market.name.split(",")[0].trim(),
    region: venue?.state?.name?.trim() || null,
    countryCode: venue?.country?.countryCode?.trim() || market.countryCode,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    providerStatus: status,
    attendance: null,
    localRank: null,
    firstSeenAt: publishedAt,
    updatedAt: publishedAt,
  })

  return {
    normalized,
    providerState: status,
    rank: null,
    accommodationSpend: null,
    impactStart: normalized.startDate.slice(0, 10),
    impactEnd: normalized.endDate.slice(0, 10),
    publisher: "Ticketmaster",
    authorityTier: 2,
    verificationState: /cancel|postpon/i.test(status)
      ? "corroborating"
      : "verified",
    evidenceSummary: `${event.name} is listed by Ticketmaster with status ${status}.`,
    retentionFloor: 10,
  }
}

export async function fetchTicketmasterEvents(input: {
  apiKey: string
  market: MarketSignalMarket
  queryConfig: TicketmasterQueryConfig
  now?: Date
  fetchImpl?: typeof fetch
}): Promise<MarketSignalProviderFetchResult<TicketmasterRawEvent>> {
  const now = input.now ?? new Date()
  const end = new Date(now)
  end.setUTCDate(end.getUTCDate() + input.queryConfig.days_forward)
  const fetchImpl = input.fetchImpl ?? fetch
  const pageSize = Math.min(200, input.queryConfig.max_events)
  const events: TicketmasterRawEvent[] = []
  let totalAvailable = 0
  let page = 0
  let totalPages = 1

  while (page < totalPages && events.length < input.queryConfig.max_events) {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json")
    url.searchParams.set("apikey", input.apiKey)
    url.searchParams.set(
      "latlong",
      `${input.market.centerLat},${input.market.centerLon}`
    )
    url.searchParams.set("radius", String(input.market.radiusMiles))
    url.searchParams.set("unit", "miles")
    url.searchParams.set("countryCode", input.market.countryCode)
    url.searchParams.set("startDateTime", now.toISOString())
    url.searchParams.set("endDateTime", end.toISOString())
    url.searchParams.set("includeTBA", "no")
    url.searchParams.set("sort", "date,asc")
    url.searchParams.set("size", String(pageSize))
    url.searchParams.set("page", String(page))
    if (input.queryConfig.segments.length > 0) {
      url.searchParams.set(
        "classificationName",
        input.queryConfig.segments.join(",")
      )
    }

    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      const label = response.status === 429 ? "rate limited" : "request failed"
      throw new MarketSignalProviderRequestError(
        "Ticketmaster",
        `Ticketmaster ${label} with status ${response.status}`,
        response.status
      )
    }
    const parsed = ticketmasterResponseSchema.parse(await response.json())
    events.push(...parsed._embedded.events)
    totalAvailable = parsed.page.totalElements
    totalPages = parsed.page.totalPages
    page += 1
  }

  return {
    events: events.slice(0, input.queryConfig.max_events),
    totalAvailable,
    overflow: totalAvailable > input.queryConfig.max_events,
  }
}
