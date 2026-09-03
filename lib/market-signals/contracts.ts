import { z } from "zod"

export const marketSignalSourceTypeSchema = z.enum([
  "official_feed",
  "ticketmaster",
  "cfbd",
  "nws",
  "gdelt",
  "predicthq",
  "google_news",
  "curated",
])

export const marketEventStateSchema = z.enum([
  "candidate",
  "corroborating",
  "verified",
  "review_required",
  "actioned",
  "monitoring",
  "ended",
  "rejected",
  "duplicate",
  "postponed",
  "canceled",
  "unwind_required",
  "superseded",
])

export const marketSignalActionGateSchema = z.enum([
  "watch",
  "review_now",
  "unwind",
])

export const marketEventChangeTypeSchema = z.enum([
  "new",
  "date_moved",
  "postponed",
  "canceled",
  "restored",
  "details_changed",
  "unchanged",
])

export const normalizedProviderEventSchema = z
  .object({
    sourceType: marketSignalSourceTypeSchema,
    externalId: z.string().trim().min(1).max(300),
    sourceUrl: z.string().url().nullable(),
    title: z.string().trim().min(2).max(300),
    category: z.string().trim().min(1).max(80),
    startDate: z.iso.datetime({ offset: true }),
    endDate: z.iso.datetime({ offset: true }),
    timezone: z.string().trim().min(1).max(80),
    venueName: z.string().trim().min(1).max(200).nullable(),
    city: z.string().trim().min(1).max(120),
    region: z.string().trim().min(1).max(120).nullable(),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase()),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    providerStatus: z.string().trim().min(1).max(80).nullable(),
    attendance: z.number().int().nonnegative().nullable(),
    localRank: z.number().min(0).max(100).nullable(),
    firstSeenAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (event) =>
      new Date(event.endDate).getTime() >= new Date(event.startDate).getTime(),
    { message: "endDate must not precede startDate", path: ["endDate"] }
  )

export type MarketSignalSourceType = z.infer<
  typeof marketSignalSourceTypeSchema
>
export type MarketEventState = z.infer<typeof marketEventStateSchema>
export type MarketSignalActionGate = z.infer<
  typeof marketSignalActionGateSchema
>
export type MarketEventChangeType = z.infer<typeof marketEventChangeTypeSchema>
export type NormalizedProviderEvent = z.infer<
  typeof normalizedProviderEventSchema
>

export type MarketSignalReviewProposal = {
  gate: MarketSignalActionGate
  actions: Array<
    | "review_rate_premium"
    | "review_minimum_stay"
    | "review_arrival_departure_rules"
    | "verify_inventory_and_pace"
    | "unwind_existing_overlay"
  >
  explanation: string
  missingEvidence: string[]
}
