import { describe, expect, it } from "vitest"

import type { NormalizedProviderEvent } from "@/lib/market-signals/contracts"
import {
  buildReviewProposal,
  canonicalEventFingerprint,
  classifyEventChange,
  determineActionGate,
  eventFamilyKey,
} from "@/lib/market-signals/domain"
import {
  calculateListingVulnerability,
  selectMarketReviewCandidates,
  selectPersistedListingExposures,
  summarizeMarketVulnerability,
} from "@/lib/market-signals/vulnerability"

const baseEvent: NormalizedProviderEvent = {
  sourceType: "predicthq",
  externalId: "phq-123",
  sourceUrl: "https://example.com/events/123",
  title: "2027 NFL Draft",
  category: "sports",
  startDate: "2027-04-29T12:00:00-04:00",
  endDate: "2027-05-01T22:00:00-04:00",
  timezone: "America/New_York",
  venueName: "National Mall",
  city: "Washington",
  region: "DC",
  countryCode: "US",
  latitude: 38.8895,
  longitude: -77.0353,
  providerStatus: "scheduled",
  attendance: 250000,
  localRank: 95,
  firstSeenAt: "2025-05-05T12:00:00-04:00",
  updatedAt: "2026-06-25T12:00:00-04:00",
}

describe("Market Signals event identity", () => {
  it("deduplicates equivalent cross-source formatting", () => {
    const first = canonicalEventFingerprint(baseEvent)
    const secondEvent: NormalizedProviderEvent = {
      ...baseEvent,
      title: "The 2027 NFL Draft!",
      sourceType: "official_feed",
      externalId: "nfl-draft-2027",
    }
    const second = canonicalEventFingerprint(secondEvent)

    expect(second).toBe(first)
  })

  it("never collapses unrelated events to their broad category", () => {
    expect(eventFamilyKey("Commanders vs. Eagles 2027")).not.toBe(
      eventFamilyKey("Capitals vs. Rangers 2027")
    )
    expect(eventFamilyKey("Commanders vs. Eagles 2027")).not.toBe("sports")
  })

  it("keeps annual editions in one explicit event family", () => {
    expect(eventFamilyKey("2027 NFL Draft")).toBe(
      eventFamilyKey("2028 NFL Draft")
    )
  })
})

describe("Market Signals event changes", () => {
  it("detects date movement before generic detail changes", () => {
    expect(
      classifyEventChange(baseEvent, {
        ...baseEvent,
        startDate: "2027-05-06T12:00:00-04:00",
        endDate: "2027-05-08T22:00:00-04:00",
        updatedAt: "2027-02-01T12:00:00-05:00",
      })
    ).toBe("date_moved")
  })

  it("detects cancellation even when dates do not move", () => {
    expect(
      classifyEventChange(baseEvent, {
        ...baseEvent,
        providerStatus: "canceled",
        updatedAt: "2027-02-01T12:00:00-05:00",
      })
    ).toBe("canceled")
  })
})

describe("Market Signals action boundary", () => {
  it("requires current, verified, material evidence for review now", () => {
    expect(
      determineActionGate({
        state: "verified",
        verificationState: "verified",
        authorityTier: 1,
        corroborationCount: 1,
        materialityScore: 82,
        vulnerabilityScore: 61,
        evidenceFreshness: "current",
      })
    ).toBe("review_now")

    expect(
      determineActionGate({
        state: "verified",
        verificationState: "verified",
        authorityTier: 1,
        corroborationCount: 1,
        materialityScore: 82,
        vulnerabilityScore: 61,
        evidenceFreshness: "stale",
      })
    ).toBe("watch")

    expect(
      determineActionGate({
        state: "verified",
        verificationState: "verified",
        authorityTier: 1,
        corroborationCount: 1,
        materialityScore: 82,
        vulnerabilityScore: null,
        evidenceFreshness: "current",
      })
    ).toBe("watch")
  })

  it("routes cancellations and postponements to unwind", () => {
    expect(
      determineActionGate({
        state: "canceled",
        verificationState: "corroborating",
        authorityTier: 2,
        corroborationCount: 1,
        materialityScore: 10,
        vulnerabilityScore: null,
        evidenceFreshness: "current",
      })
    ).toBe("unwind")
  })

  it("produces review categories without inventing an ADR percentage", () => {
    const proposal = buildReviewProposal({
      gate: "review_now",
      category: "sports",
      durationDays: 3,
      hasInventoryEvidence: true,
      hasPricingEvidence: false,
      hasStayRuleEvidence: false,
    })

    expect(proposal.actions).toEqual([
      "verify_inventory_and_pace",
      "review_rate_premium",
      "review_minimum_stay",
      "review_arrival_departure_rules",
    ])
    expect(proposal.missingEvidence).toEqual([
      "current pricing state",
      "current stay restrictions",
    ])
    expect(JSON.stringify(proposal)).not.toMatch(/adrLift|suggestedAdr|%/i)
  })
})

describe("Market Signals PriceLabs vulnerability", () => {
  it("scores open, behind-market inventory as exposed", () => {
    const result = calculateListingVulnerability({
      occupancyPct: 20,
      marketOccupancyPct: 55,
      occupancyStlyPct: 45,
      medianBookingWindowDays: 30,
      daysUntilImpact: 21,
    })

    expect(result.score).toBeGreaterThanOrEqual(45)
    expect(result.components.inventoryExposure).toBe(80)
    expect(result.components.marketOccupancyGap).toBe(35)
  })

  it("keeps substantially booked inventory below the review threshold", () => {
    const result = calculateListingVulnerability({
      occupancyPct: 82,
      marketOccupancyPct: 78,
      occupancyStlyPct: 75,
      medianBookingWindowDays: 25,
      daysUntilImpact: 20,
    })

    expect(result.score).toBeLessThan(45)
  })

  it("uses the most exposed quartile without hiding a vulnerable listing", () => {
    const summary = summarizeMarketVulnerability([72, 60, 20, 15, 10, 8])

    expect(summary.score).toBe(66)
    expect(summary.exposedListings).toBe(2)
    expect(summary.evaluatedListings).toBe(6)
  })

  it("returns unknown when no current listing evidence exists", () => {
    expect(summarizeMarketVulnerability([])).toEqual({
      score: null,
      evaluatedListings: 0,
      exposedListings: 0,
      topScore: null,
    })
  })

  it("keeps one event per family inside a bounded market review queue", () => {
    const result = selectMarketReviewCandidates(
      [
        { id: "series-1", familyKey: "series", priority: 90 },
        { id: "series-2", familyKey: "series", priority: 88 },
        { id: "festival", familyKey: "festival", priority: 80 },
        { id: "conference", familyKey: "conference", priority: 70 },
      ],
      2
    )

    expect([...result.selected]).toEqual(["series-1", "festival"])
  })

  it("bounds persisted exposures without changing full-market scoring inputs", () => {
    const exposures = Array.from({ length: 1000 }, (_, index) => ({
      impactId: index < 500 ? "selected" : "watch",
      listingId: `listing-${String(index).padStart(4, "0")}`,
      score: 100 - (index % 100),
    }))

    const persisted = selectPersistedListingExposures(
      exposures,
      new Set(["selected"]),
      45,
      25
    )

    expect(persisted).toHaveLength(25)
    expect(persisted.every((row) => row.impactId === "selected")).toBe(true)
    expect(persisted.every((row) => row.score >= 45)).toBe(true)
    expect(persisted[0].score).toBe(100)
  })
})
