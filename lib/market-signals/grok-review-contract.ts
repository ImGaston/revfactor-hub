import { z } from "zod"

import {
  marketSignalSourceTypeSchema,
  normalizedProviderEventSchema,
  type NormalizedProviderEvent,
} from "@/lib/market-signals/contracts"

const isoDate = z.iso.datetime({ offset: true })

const evidenceSchema = z.object({
  url: z.string().url(),
  sourceType: z.enum(["official", "ticketing", "news", "social", "other"]),
  observedAt: isoDate,
})

const baseSchema = z.object({
  candidateId: z.string().trim().min(1).max(160),
  kind: z.enum(["event", "property", "market"]),
  status: z.literal("needs_review"),
  confidence: z.enum(["low", "medium", "high"]),
  marketHint: z.string().trim().min(1).max(160).nullable(),
  localityHint: z.string().trim().min(1).max(160).nullable(),
  rationale: z.string().trim().min(20).max(2000),
  evidence: z.array(evidenceSchema).min(1).max(12),
  observedAt: isoDate,
})

const eventSchema = baseSchema.extend({
  kind: z.literal("event"),
  title: z.string().trim().min(2).max(300),
  category: z.string().trim().min(1).max(80),
  startDate: isoDate,
  endDate: isoDate,
  recurrence: z
    .object({
      annual: z.boolean(),
      years: z.array(z.number().int().min(2000).max(2200)).max(10),
    })
    .nullable(),
})

const propertySchema = baseSchema.extend({
  kind: z.literal("property"),
  propertyName: z.string().trim().min(2).max(200),
  city: z.string().trim().min(1).max(120),
  region: z.string().trim().min(1).max(120).nullable(),
  listingUrl: z.string().url().nullable(),
})

const marketSchema = baseSchema.extend({
  kind: z.literal("market"),
  marketName: z.string().trim().min(2).max(160),
  stateOrRegion: z.string().trim().min(1).max(120),
  cities: z.array(z.string().trim().min(1).max(120)).min(1).max(30),
})

export const grokReviewCandidateSchema = z.discriminatedUnion("kind", [
  eventSchema,
  propertySchema,
  marketSchema,
])

export const grokReviewFileSchema = z.object({
  contractVersion: z.literal("rf-grok-review/v1"),
  generatedAt: isoDate,
  source: z.literal("grok"),
  candidates: z.array(grokReviewCandidateSchema).max(500),
})

export type GrokReviewCandidate = z.infer<typeof grokReviewCandidateSchema>
export type GrokReviewFile = z.infer<typeof grokReviewFileSchema>

export type ExistingEventMatch = {
  externalId: string
  normalized: NormalizedProviderEvent
  sourceType: z.infer<typeof marketSignalSourceTypeSchema>
}

export type GrokEventDisposition =
  | "new"
  | "corroborating"
  | "duplicate"
  | "unresolved"

export function getGrokEventDisposition(
  candidate: Extract<GrokReviewCandidate, { kind: "event" }>,
  existing: ExistingEventMatch[]
): GrokEventDisposition {
  const exact = existing.find(
    (item) =>
      item.normalized.title.trim().toLowerCase() ===
        candidate.title.trim().toLowerCase() &&
      item.normalized.startDate === candidate.startDate &&
      item.normalized.endDate === candidate.endDate
  )
  if (exact) return "duplicate"

  const title = candidate.title.trim().toLowerCase()
  const city = candidate.localityHint?.trim().toLowerCase() ?? null
  if (
    existing.some(
      (item) =>
        item.normalized.title.trim().toLowerCase() === title &&
        (!city || item.normalized.city.trim().toLowerCase() === city)
    )
  ) {
    return "corroborating"
  }
  return candidate.confidence === "low" ? "unresolved" : "new"
}
