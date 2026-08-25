import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  MARKET_SIGNAL_BRIEF_MODEL_ID,
  type MarketSignalBriefSnapshot,
  marketSignalBriefOutputSchema,
  validateMarketSignalBriefGrounding,
} from "@/lib/market-signals/brief"

const agentSource = readFileSync(
  join(process.cwd(), "lib/market-signals/brief-agent.server.ts"),
  "utf8"
)

describe("Market Signal Brief contract", () => {
  const snapshot: MarketSignalBriefSnapshot = {
    event: {
      title: "Championship weekend",
      category: "sports",
      state: "active",
      startAt: "2026-11-01T12:00:00Z",
      endAt: "2026-11-02T03:00:00Z",
      venueName: "Downtown Stadium",
      city: "Tucson",
      region: "AZ",
    },
    market: { name: "Tucson, AZ" },
    impact: {
      impactStart: "2026-11-01",
      impactEnd: "2026-11-07",
      materialityScore: 82,
      vulnerabilityScore: 68,
      evidenceFreshness: "current",
      predictedAttendance: 42000,
      evidenceCount: 1,
    },
    inventory: {
      approvedListings: 7,
      evaluatedListings: 7,
      exposedListings: 3,
      topListings: [],
    },
    deterministicReview: {
      actions: ["Review live pricing"],
      missingEvidence: ["Current stay rules"],
    },
  }

  it("uses the current governed Gateway model", () => {
    expect(MARKET_SIGNAL_BRIEF_MODEL_ID).toBe("openai/gpt-5.6-luna")
  })

  it("accepts concise structured operator output", () => {
    const result = marketSignalBriefOutputSchema.safeParse({
      headline: "Material festival demand meets exposed October inventory",
      executiveSummary:
        "A verified festival is material for the market while several approved listings retain open event-month inventory.",
      whyNow: [
        "The event is inside the active pricing horizon.",
        "Current property occupancy trails the market benchmark.",
      ],
      propertyExposureSummary:
        "Three supplied properties have the highest current exposure scores.",
      operatorNote:
        "Verify live pricing, stay rules, and channel restrictions before opening an Adjustment.",
      confidence: "high",
    })

    expect(result.success).toBe(true)
  })

  it("forbids invented rates and completed-action claims in agent instructions", () => {
    expect(agentSource).toContain("Never recommend a numeric ADR percentage")
    expect(agentSource).toContain("Never claim that RevFactor")
    expect(agentSource).toContain("do not replace or expand them")
    expect(agentSource).not.toMatch(/tool\s*\(/)
  })

  it("rejects unsupported dates and numeric commercial recommendations", () => {
    const safeOutput = {
      headline: "November event demand meets exposed inventory",
      executiveSummary:
        "The supplied event and current listing exposure warrant a human review.",
      whyNow: [
        "The impact window begins in November.",
        "Three approved listings are currently exposed.",
      ],
      propertyExposureSummary:
        "The deterministic score identifies three exposed listings.",
      operatorNote:
        "Verify live pricing and stay rules before opening an Adjustment.",
      confidence: "medium" as const,
    }

    expect(validateMarketSignalBriefGrounding(safeOutput, snapshot)).toEqual([])
    expect(
      validateMarketSignalBriefGrounding(
        {
          ...safeOutput,
          executiveSummary:
            "June? demand supports increasing ADR by 20 percent for this window.",
        },
        snapshot
      )
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("uncertain"),
        expect.stringContaining("numeric commercial"),
        expect.stringContaining("june"),
      ])
    )
  })
})
