import { describe, expect, it } from "vitest"

import {
  getGrokEventDisposition,
  grokReviewFileSchema,
} from "@/lib/market-signals/grok-review-contract"

const base = {
  candidateId: "grok-event-1",
  kind: "event" as const,
  status: "needs_review" as const,
  confidence: "high" as const,
  marketHint: "Smokies",
  localityHint: "Gatlinburg",
  rationale: "Official university page publishes the event dates and location.",
  evidence: [
    {
      url: "https://example.edu/event",
      sourceType: "official" as const,
      observedAt: "2026-09-03T12:00:00Z",
    },
  ],
  observedAt: "2026-09-03T12:00:00Z",
  title: "Family Weekend",
  category: "university_family",
  startDate: "2026-09-18T00:00:00Z",
  endDate: "2026-09-20T00:00:00Z",
  recurrence: { annual: true, years: [2026, 2027] },
}

describe("Grok review contract", () => {
  it("accepts only review-state candidates", () => {
    const parsed = grokReviewFileSchema.parse({
      contractVersion: "rf-grok-review/v1",
      generatedAt: "2026-09-03T12:00:00Z",
      source: "grok",
      candidates: [base],
    })
    expect(parsed.candidates).toHaveLength(1)
  })

  it("fails closed when evidence is missing", () => {
    expect(() =>
      grokReviewFileSchema.parse({
        contractVersion: "rf-grok-review/v1",
        generatedAt: "2026-09-03T12:00:00Z",
        source: "grok",
        candidates: [{ ...base, evidence: [] }],
      })
    ).toThrow()
  })

  it("distinguishes duplicates, corroboration, and new events", () => {
    const normalized = {
      sourceType: "official_feed" as const,
      externalId: "u1",
      sourceUrl: "https://example.edu/event",
      title: base.title,
      category: base.category,
      startDate: base.startDate,
      endDate: base.endDate,
      timezone: "America/New_York",
      venueName: null,
      city: "Gatlinburg",
      region: "TN",
      countryCode: "US",
      latitude: null,
      longitude: null,
      providerStatus: "confirmed",
      attendance: null,
      localRank: null,
      firstSeenAt: base.observedAt,
      updatedAt: base.observedAt,
    }
    expect(
      getGrokEventDisposition(base, [
        { externalId: "u1", normalized, sourceType: "official_feed" },
      ])
    ).toBe("duplicate")
    expect(
      getGrokEventDisposition(
        {
          ...base,
          startDate: "2026-09-19T00:00:00Z",
          endDate: "2026-09-21T00:00:00Z",
        },
        [{ externalId: "u1", normalized, sourceType: "official_feed" }]
      )
    ).toBe("corroborating")
    expect(
      getGrokEventDisposition(
        { ...base, title: "New Commencement", confidence: "medium" },
        []
      )
    ).toBe("new")
  })
})
