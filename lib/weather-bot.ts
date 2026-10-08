import { z } from "zod"

const nullableNumber = z.number().nullable()

export const weatherBotSignalPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  impactId: z.uuid(),
  eventId: z.uuid(),
  eventVersion: z.number().int().positive(),
  title: z.string().min(1).max(300),
  state: z.string().min(1).max(80),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  market: z.object({
    id: z.uuid(),
    slug: z.string().min(1).max(160),
    name: z.string().min(1).max(160),
    timezone: z.string().min(1).max(100),
  }),
  scores: z.object({
    materiality: z.number().min(0).max(100),
    vulnerability: nullableNumber,
    actionGate: z.enum(["watch", "review_now", "unwind"]),
    evidenceFreshness: z.enum(["current", "stale", "unknown"]),
  }),
  impactWindow: z.object({
    start: z.iso.date(),
    end: z.iso.date(),
    distanceMiles: nullableNumber,
  }),
  exposure: z
    .object({
      evaluatedListings: z.number().int().min(0).default(0),
      exposedListings: z.number().int().min(0).default(0),
      topListings: z
        .array(
          z.object({
            listingId: z.uuid(),
            name: z.string().min(1).max(300),
            score: z.number().min(0).max(100),
            occupancyPct: z.number().min(0).max(100).optional(),
            marketOccupancyPct: nullableNumber.optional(),
            metricSource: z.string().min(1).max(100).optional(),
          })
        )
        .default([]),
    })
    .default({ evaluatedListings: 0, exposedListings: 0, topListings: [] }),
  evidence: z
    .object({
      url: z.url(),
      publisher: z.string().min(1).max(200),
      summary: z.string().max(2000).nullable(),
      observedAt: z.iso.datetime({ offset: true }),
      authorityTier: z.number().int().min(1).max(4),
    })
    .nullable(),
  generatedAt: z.iso.datetime({ offset: true }),
  hubUrl: z.string().startsWith("/"),
})

export type WeatherBotSignalPayload = z.infer<
  typeof weatherBotSignalPayloadSchema
>

export const weatherBotDeliveryResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("delivered"),
    leaseToken: z.uuid(),
    slackChannelId: z.string().trim().min(1).max(120),
    slackMessageTs: z.string().trim().min(1).max(120),
  }),
  z.object({
    outcome: z.literal("failed"),
    leaseToken: z.uuid(),
    error: z.string().trim().min(1).max(2000),
  }),
])

export type WeatherBotDeliveryResult = z.infer<
  typeof weatherBotDeliveryResultSchema
>

export const weatherBotWorkRequestSchema = z.object({
  maximumJobs: z.number().int().min(1).max(10).default(5),
})

export function weatherBotSeverityLabel(payload: WeatherBotSignalPayload) {
  if (
    payload.scores.actionGate === "unwind" ||
    payload.state === "canceled" ||
    payload.state === "postponed"
  ) {
    return "critical" as const
  }
  if (payload.scores.materiality >= 85) return "high" as const
  if (payload.scores.materiality >= 70) return "medium" as const
  return "watch" as const
}

export function weatherBotSlackSummary(payload: WeatherBotSignalPayload) {
  const severity = weatherBotSeverityLabel(payload).toUpperCase()
  const vulnerable = payload.scores.vulnerability
  const exposure = payload.exposure.exposedListings
  const evaluated = payload.exposure.evaluatedListings
  const exposureLabel =
    evaluated > 0 ? `${exposure}/${evaluated} listings` : "inventory pending"

  return [
    `*${severity} WEATHER · ${payload.market.name}*`,
    payload.title,
    `${payload.impactWindow.start} → ${payload.impactWindow.end}`,
    `Materiality ${Math.round(payload.scores.materiality)} · Vulnerability ${
      vulnerable == null ? "pending" : Math.round(vulnerable)
    } · ${exposureLabel}`,
    payload.evidence?.summary ??
      "Official weather evidence is available in RevFactor Hub.",
  ].join("\n")
}
