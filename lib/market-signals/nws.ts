import { z } from "zod"

import { normalizedProviderEventSchema } from "@/lib/market-signals/contracts"
import {
  MarketSignalProviderRequestError,
  type MarketSignalMarket,
  type MarketSignalProviderCandidate,
  type MarketSignalProviderFetchResult,
} from "@/lib/market-signals/provider"

const nwsAlertSchema = z.object({
  id: z.string().url(),
  properties: z.object({
    id: z.string().min(1).nullable().optional(),
    areaDesc: z.string().nullable().optional(),
    sent: z.iso.datetime({ offset: true }),
    effective: z.iso.datetime({ offset: true }).nullable().optional(),
    onset: z.iso.datetime({ offset: true }).nullable().optional(),
    expires: z.iso.datetime({ offset: true }).nullable().optional(),
    ends: z.iso.datetime({ offset: true }).nullable().optional(),
    status: z.string().min(1),
    messageType: z.string().min(1),
    category: z.string().min(1),
    severity: z.string().min(1),
    certainty: z.string().min(1),
    urgency: z.string().min(1),
    event: z.string().min(1),
    headline: z.string().nullable().optional(),
  }),
})

const nwsResponseSchema = z.object({ features: z.array(nwsAlertSchema) })

const nwsQueryConfigSchema = z.object({
  max_alerts: z.number().int().min(1).max(500).default(200),
  statuses: z.array(z.string().trim().min(1)).default(["actual"]),
})

export type NWSRawAlert = z.infer<typeof nwsAlertSchema>
export type NWSQueryConfig = z.infer<typeof nwsQueryConfigSchema>

export function parseNWSQueryConfig(value: unknown): NWSQueryConfig {
  const parsed = nwsQueryConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : nwsQueryConfigSchema.parse({})
}

function severityFloor(severity: string) {
  if (/extreme/i.test(severity)) return 85
  if (/severe/i.test(severity)) return 70
  if (/moderate/i.test(severity)) return 50
  if (/minor/i.test(severity)) return 25
  return 20
}

export function normalizeNWSAlert(
  alert: NWSRawAlert,
  market: MarketSignalMarket
): MarketSignalProviderCandidate {
  const properties = alert.properties
  const startDate = properties.onset ?? properties.effective ?? properties.sent
  const proposedEnd = properties.ends ?? properties.expires ?? startDate
  const endDate =
    new Date(proposedEnd).getTime() >= new Date(startDate).getTime()
      ? proposedEnd
      : startDate
  const providerState = [
    properties.status,
    properties.messageType,
    properties.severity,
    properties.urgency,
    properties.certainty,
  ].join(":")
  const normalized = normalizedProviderEventSchema.parse({
    sourceType: "nws",
    externalId: properties.id ?? alert.id,
    sourceUrl: alert.id,
    title: properties.headline?.trim() || properties.event,
    category: "weather",
    startDate,
    endDate,
    timezone: market.timezone,
    venueName: null,
    city: market.name.split(",")[0].trim(),
    region: properties.areaDesc?.trim().slice(0, 120) || null,
    countryCode: market.countryCode,
    latitude: market.centerLat,
    longitude: market.centerLon,
    providerStatus: providerState,
    attendance: null,
    localRank: null,
    firstSeenAt: properties.sent,
    updatedAt: properties.sent,
  })

  return {
    normalized,
    providerState,
    rank: null,
    accommodationSpend: null,
    impactStart: normalized.startDate.slice(0, 10),
    impactEnd: normalized.endDate.slice(0, 10),
    publisher: "National Weather Service",
    authorityTier: 1,
    verificationState:
      properties.status.toLowerCase() === "actual" ? "verified" : "unverified",
    evidenceSummary: `${properties.event} is an active National Weather Service alert rated ${properties.severity}.`,
    materialityFloor: severityFloor(properties.severity),
    retentionFloor: 25,
  }
}

export async function fetchNWSAlerts(input: {
  userAgent: string
  market: MarketSignalMarket
  queryConfig: NWSQueryConfig
  fetchImpl?: typeof fetch
}): Promise<MarketSignalProviderFetchResult<NWSRawAlert>> {
  const url = new URL("https://api.weather.gov/alerts/active")
  url.searchParams.set(
    "point",
    `${input.market.centerLat},${input.market.centerLon}`
  )
  if (input.queryConfig.statuses.length > 0) {
    url.searchParams.set("status", input.queryConfig.statuses.join(","))
  }
  const response = await (input.fetchImpl ?? fetch)(url, {
    headers: {
      Accept: "application/geo+json",
      "User-Agent": input.userAgent,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const label = response.status === 429 ? "rate limited" : "request failed"
    throw new MarketSignalProviderRequestError(
      "NWS",
      `NWS ${label} with status ${response.status}`,
      response.status
    )
  }
  const parsed = nwsResponseSchema.parse(await response.json())
  return {
    events: parsed.features.slice(0, input.queryConfig.max_alerts),
    totalAvailable: parsed.features.length,
    overflow: parsed.features.length > input.queryConfig.max_alerts,
  }
}
