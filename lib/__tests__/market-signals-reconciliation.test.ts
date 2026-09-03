import { describe, expect, it } from "vitest"

import { normalizedProviderEventSchema } from "@/lib/market-signals/contracts"
import {
  reconcileUniversityObservations,
  reconcileUniversitySnapshot,
  type UniversityEventObservation,
} from "@/lib/market-signals/reconciliation"

function observation(input: {
  sourceId: string
  sourceRole: UniversityEventObservation["sourceRole"]
  start: string
  end?: string
  externalId?: string
  title?: string
  observedAt?: string
}): UniversityEventObservation {
  const startDate = new Date(input.start).toISOString()
  const endDate = new Date(input.end ?? input.start).toISOString()
  return {
    sourceId: input.sourceId,
    institutionSlug: "university-of-tennessee-knoxville",
    sourceRole: input.sourceRole,
    observedAt: input.observedAt ?? "2026-09-01T12:00:00.000Z",
    normalized: normalizedProviderEventSchema.parse({
      sourceType: "official_feed",
      externalId: input.externalId ?? `${input.sourceId}-event`,
      sourceUrl: `https://${input.sourceId}.utk.edu/calendar`,
      title: input.title ?? "UT Knoxville Commencement",
      category: "commencement",
      startDate,
      endDate,
      timezone: "America/New_York",
      venueName: "Knoxville",
      city: "Knoxville",
      region: "TN",
      countryCode: "US",
      latitude: null,
      longitude: null,
      providerStatus: "scheduled",
      attendance: null,
      localRank: null,
      firstSeenAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
    }),
  }
}

describe("university observation reconciliation", () => {
  it("selects canonical program evidence and retains registrar date conflicts", () => {
    const occurrences = reconcileUniversityObservations([
      observation({
        sourceId: "ceremony",
        sourceRole: "canonical",
        start: "2027-05-13T09:00:00-04:00",
        end: "2027-05-16T17:00:00-04:00",
      }),
      observation({
        sourceId: "registrar",
        sourceRole: "corroborating",
        start: "2027-05-14T00:00:00-04:00",
        end: "2027-05-17T00:00:00-04:00",
      }),
    ])

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0].canonical.sourceId).toBe("ceremony")
    expect(occurrences[0].corroboratingCount).toBe(1)
    expect(occurrences[0].conflicts.map((conflict) => conflict.field)).toEqual(
      expect.arrayContaining(["startDate", "endDate"])
    )
  })

  it("keeps separate family windows as separate occurrence slots", () => {
    const events = [
      observation({
        sourceId: "family",
        sourceRole: "canonical",
        start: "2026-09-18T00:00:00-04:00",
        end: "2026-09-20T23:59:00-04:00",
        title: "UT Knoxville Vol Family Reunion",
        externalId: "sep",
      }),
      observation({
        sourceId: "family",
        sourceRole: "canonical",
        start: "2026-10-16T00:00:00-04:00",
        end: "2026-10-18T23:59:00-04:00",
        title: "UT Knoxville Vol Family Reunion",
        externalId: "oct",
      }),
    ].map((item) => ({
      ...item,
      normalized: { ...item.normalized, category: "family_weekend" },
    }))

    const occurrences = reconcileUniversityObservations(events)
    expect(occurrences).toHaveLength(2)
    expect(occurrences[0].occurrenceKey).not.toBe(occurrences[1].occurrenceKey)
  })

  it("classifies a canonical date move without treating it as a new event", () => {
    const previous = observation({
      sourceId: "ceremony",
      sourceRole: "canonical",
      start: "2027-05-13T09:00:00-04:00",
      end: "2027-05-16T17:00:00-04:00",
      externalId: "commencement-2027",
    })
    const current = observation({
      sourceId: "ceremony",
      sourceRole: "canonical",
      start: "2027-05-14T09:00:00-04:00",
      end: "2027-05-17T17:00:00-04:00",
      externalId: "commencement-2027",
    })
    const result = reconcileUniversitySnapshot({
      previous: [previous],
      current: [current],
      completeSourceIds: new Set(),
      asOf: new Date("2026-09-03T00:00:00Z"),
    })

    expect(result.outcomes[0]).toMatchObject({
      kind: "changed",
      changeType: "date_moved",
    })
  })

  it("detects missing future observations only from complete source snapshots", () => {
    const future = observation({
      sourceId: "ceremony",
      sourceRole: "canonical",
      start: "2027-05-13T09:00:00-04:00",
      end: "2027-05-16T17:00:00-04:00",
      externalId: "future",
    })
    const past = observation({
      sourceId: "ceremony",
      sourceRole: "canonical",
      start: "2025-05-13T09:00:00-04:00",
      end: "2025-05-16T17:00:00-04:00",
      externalId: "past",
    })

    const complete = reconcileUniversitySnapshot({
      previous: [future, past],
      current: [],
      completeSourceIds: new Set(["ceremony"]),
      asOf: new Date("2026-09-03T00:00:00Z"),
    })
    expect(complete.missing).toHaveLength(1)
    expect(complete.missing[0].missingExternalId).toBe("future")

    const incomplete = reconcileUniversitySnapshot({
      previous: [future],
      current: [],
      completeSourceIds: new Set(),
      asOf: new Date("2026-09-03T00:00:00Z"),
    })
    expect(incomplete.missing).toEqual([])
  })
})
