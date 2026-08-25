import { z } from "zod"

export const MARKET_SIGNAL_BRIEF_MODEL_ID = "openai/gpt-5.6-luna" as const
export const MARKET_SIGNAL_BRIEF_PROMPT_VERSION = "signal-brief-v2" as const

export const marketSignalBriefOutputSchema = z.object({
  headline: z.string().trim().min(6).max(120),
  executiveSummary: z.string().trim().min(20).max(700),
  whyNow: z.array(z.string().trim().min(5).max(240)).min(2).max(4),
  propertyExposureSummary: z.string().trim().min(10).max(600),
  operatorNote: z.string().trim().min(10).max(500),
  confidence: z.enum(["low", "medium", "high"]),
})

export type MarketSignalBriefOutput = z.infer<
  typeof marketSignalBriefOutputSchema
>

export type MarketSignalBriefSnapshot = {
  event: {
    title: string
    category: string
    state: string
    startAt: string
    endAt: string
    venueName: string | null
    city: string
    region: string | null
  }
  market: {
    name: string
  }
  impact: {
    impactStart: string
    impactEnd: string
    materialityScore: number
    vulnerabilityScore: number
    evidenceFreshness: "current" | "stale" | "unknown"
    predictedAttendance: number | null
    evidenceCount: number
  }
  inventory: {
    approvedListings: number
    evaluatedListings: number
    exposedListings: number
    topListings: Array<{
      listingId: string
      name: string
      score: number
      occupancyPct: number
      marketOccupancyPct: number | null
      metricSource: string
    }>
  }
  deterministicReview: {
    actions: string[]
    missingEvidence: string[]
  }
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const

function briefText(output: MarketSignalBriefOutput) {
  return [
    output.headline,
    output.executiveSummary,
    ...output.whyNow,
    output.propertyExposureSummary,
    output.operatorNote,
  ].join("\n")
}

function allowedMonths(snapshot: MarketSignalBriefSnapshot) {
  const snapshotText = JSON.stringify(snapshot).toLowerCase()
  const allowed = new Set<string>()

  for (const month of MONTH_NAMES) {
    if (snapshotText.includes(month)) allowed.add(month)
  }
  for (const match of snapshotText.matchAll(/\b\d{4}-(\d{2})-\d{2}\b/g)) {
    const monthIndex = Number(match[1]) - 1
    if (monthIndex >= 0 && monthIndex < MONTH_NAMES.length) {
      allowed.add(MONTH_NAMES[monthIndex])
    }
  }

  return allowed
}

/**
 * Rejects common ungrounded or commercially unsafe language before a generated
 * brief can enter the reviewer queue. Deterministic review logic remains the
 * authority; this validator is a final content boundary, not a scoring model.
 */
export function validateMarketSignalBriefGrounding(
  output: MarketSignalBriefOutput,
  snapshot: MarketSignalBriefSnapshot
) {
  const text = briefText(output)
  const normalized = text.toLowerCase()
  const errors: string[] = []

  if (text.includes("?")) {
    errors.push("Briefs must not contain uncertain or interrogative date text")
  }
  if (/\$|\b(?:usd|dollars?)\b/i.test(text)) {
    errors.push("Briefs must not contain currency or rate amounts")
  }
  if (
    /\b(?:raise|increase|decrease|reduce|set|price|rate|adr|discount|minimum stay)\b.{0,48}\b\d+(?:\.\d+)?\s*(?:%|percent|night|nights)\b/i.test(
      text
    )
  ) {
    errors.push("Briefs must not contain numeric commercial recommendations")
  }

  const permittedMonths = allowedMonths(snapshot)
  for (const month of MONTH_NAMES) {
    if (new RegExp(`\\b${month}\\b`, "i").test(normalized) && !permittedMonths.has(month)) {
      errors.push(`Brief contains an unsupported month: ${month}`)
    }
  }

  return errors
}
