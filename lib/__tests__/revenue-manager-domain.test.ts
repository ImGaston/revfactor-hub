import { describe, expect, it } from "vitest"
import fixture from "@/lib/revenue-manager/fixtures/ashwood.v1.json"
import {
  REVENUE_CONTRACT_VERSIONS,
  diagnosticCandidateSchema,
  metricEvidenceSchema,
  revenuePropertyProfileSchema,
  revenueRecommendationSchema,
} from "@/lib/revenue-manager/contracts"
import {
  choosePreferredObservation,
  computeInventoryMetrics,
  computeMinimumPriceExposure,
  evaluateRevenueGoal,
  findProtectedDateConflicts,
  reconcileReservationImport,
  type SourceReservationRow,
} from "@/lib/revenue-manager/domain"

describe("Revenue Manager v1 contracts", () => {
  const observedAt = "2026-08-19T14:02:05-04:00"
  const field = {
    value: "observed",
    unit: null,
    effectiveFrom: "2026-08-19",
    effectiveTo: null,
    sourceType: "fixture",
    sourceReference: "ashwood-sanitized.v1",
    observedAt,
    confidence: "high" as const,
    verificationState: "observed" as const,
    notes: null,
  }

  it("accepts a profile only when every section carries field evidence", () => {
    const parsed = revenuePropertyProfileSchema.parse({
      schemaVersion: REVENUE_CONTRACT_VERSIONS.profile,
      propertyKey: fixture.property.propertyKey,
      displayName: fixture.property.displayName,
      version: 1,
      lifecycleMode: fixture.property.lifecycleMode,
      status: "needs_confirmation",
      dataConfidence: "medium",
      identity: { market: field },
      positioning: { capacity: field },
      objective: {
        annualRevenueGoal: {
          ...field,
          value: fixture.objective.target,
          unit: "USD",
        },
      },
      economics: {
        revenueDefinition: { ...field, value: null, confidence: "unknown" },
      },
      inventoryOperations: { permitBlocks: field },
      pricingStrategy: { basePrice: { ...field, value: 285, unit: "USD" } },
      distribution: { airbnbMarkup: { ...field, value: 44, unit: "percent" } },
      demandMarket: { closeInPace: field },
      policies: { protectedDates: field },
      dataHealth: { openIssues: field },
      sourceSnapshotIds: [fixture.sourceSnapshots.hospitable.snapshotId],
      createdAt: "2026-08-20T00:00:00-04:00",
    })
    expect(parsed.schemaVersion).toBe("revenue-profile.v1")
    expect(parsed.objective.annualRevenueGoal.verificationState).toBe(
      "observed"
    )
  })

  it("requires explicit values and non-empty profile sections", () => {
    const missingValue = { ...field } as Partial<typeof field>
    delete missingValue.value

    const parsed = revenuePropertyProfileSchema.safeParse({
      schemaVersion: REVENUE_CONTRACT_VERSIONS.profile,
      propertyKey: fixture.property.propertyKey,
      displayName: fixture.property.displayName,
      version: 1,
      lifecycleMode: fixture.property.lifecycleMode,
      status: "draft",
      dataConfidence: "unknown",
      identity: { market: missingValue },
      positioning: {},
      objective: { goal: field },
      economics: { costs: field },
      inventoryOperations: { availability: field },
      pricingStrategy: { basePrice: field },
      distribution: { channels: field },
      demandMarket: { market: field },
      policies: { constraints: field },
      dataHealth: { issues: field },
      sourceSnapshotIds: [fixture.sourceSnapshots.hospitable.snapshotId],
      createdAt: "2026-08-20T00:00:00-04:00",
    })

    expect(parsed.success).toBe(false)
  })

  it("requires metric scope, definition, source, range, grain, and freshness", () => {
    const parsed = metricEvidenceSchema.parse({
      schemaVersion: REVENUE_CONTRACT_VERSIONS.metric,
      evidenceId: "ashwood-sellable-occ",
      metricKey: "sellable_occupancy",
      propertyKey: fixture.property.propertyKey,
      stayRange: { start: "2024-08-20", end: "2026-08-19" },
      asOf: observedAt,
      grain: "window",
      sourceSnapshotId: fixture.sourceSnapshots.hospitable.snapshotId,
      sourceType: "hospitable_export",
      definitionVersion: "sellable_occupancy.v1",
      comparisonType: "none",
      benchmark: null,
      value: fixture.historicalInventory.expectedSellableOccupancy,
      unit: "ratio",
      numerator: fixture.historicalInventory.bookedNights,
      denominator:
        fixture.historicalInventory.calendarNights -
        fixture.historicalInventory.blockedNights,
      freshness: "stale",
      exclusions: ["intentionally blocked nights"],
      notes: null,
    })
    expect(parsed.denominator).toBe(639)
  })

  it("rejects underspecified diagnostics and recommendations", () => {
    expect(diagnosticCandidateSchema.safeParse({ title: "Pace" }).success).toBe(
      false
    )
    expect(
      revenueRecommendationSchema.safeParse({ title: "Raise price" }).success
    ).toBe(false)
  })
})

describe("Ashwood acceptance scenario C — permit-related inventory", () => {
  it("excludes blocked nights from sellable occupancy but keeps them in calendar utilization", () => {
    const result = computeInventoryMetrics({
      calendarNights: fixture.historicalInventory.calendarNights,
      bookedNights: fixture.historicalInventory.bookedNights,
      blockedNights: fixture.historicalInventory.blockedNights,
    })

    expect(result.openNights).toBe(
      fixture.historicalInventory.expectedOpenNights
    )
    expect(result.calendarUtilization).toBeCloseTo(
      fixture.historicalInventory.expectedCalendarUtilization,
      9
    )
    expect(result.sellableOccupancy).toBeCloseTo(
      fixture.historicalInventory.expectedSellableOccupancy,
      9
    )
    expect(result.sellableOccupancy).toBeGreaterThan(
      result.calendarUtilization ?? 0
    )
  })

  it("preserves permit blocks as intentional temporary constraints", () => {
    const permitNights = fixture.forwardInventory.knownPermitBlocks.reduce(
      (sum, block) => sum + block.nights,
      0
    )
    expect(permitNights).toBe(fixture.forwardInventory.blockedNights)
    expect(
      fixture.forwardInventory.knownPermitBlocks.every((block) =>
        block.reason.includes("permit")
      )
    ).toBe(true)
  })
})

describe("Ashwood acceptance scenario D — revenue definitions", () => {
  const observations = [
    {
      source: "hospitable",
      measure: "host_revenue" as const,
      value: fixture.sourceSnapshots.hospitable.hostRevenue,
      periodStart: fixture.sourceSnapshots.hospitable.periodStart,
      periodEnd: fixture.sourceSnapshots.hospitable.periodEnd,
    },
    {
      source: "pricelabs",
      measure: "rental_revenue" as const,
      value: fixture.sourceSnapshots.pricelabs.rentalRevenue,
      periodStart: fixture.sourceSnapshots.pricelabs.periodStart,
      periodEnd: fixture.sourceSnapshots.pricelabs.periodEnd,
    },
  ]

  it("blocks target attainment while both revenue measure and period are unresolved", () => {
    const result = evaluateRevenueGoal(
      {
        value: fixture.objective.target,
        measure: fixture.objective.revenueMeasure,
        periodStart: fixture.objective.periodStart,
        periodEnd: fixture.objective.periodEnd,
      },
      observations
    )
    expect(result.status).toBe("blocked")
    expect(result.reasons).toEqual([
      "Goal revenue measure is unresolved",
      "Goal period is unresolved",
    ])
    expect(result.attainment).toBeNull()
  })

  it("uses only the observation matching the confirmed measure and period", () => {
    const result = evaluateRevenueGoal(
      {
        value: fixture.objective.target,
        measure: "host_revenue",
        periodStart: fixture.sourceSnapshots.hospitable.periodStart,
        periodEnd: fixture.sourceSnapshots.hospitable.periodEnd,
      },
      observations
    )
    expect(result.status).toBe("comparable")
    if (result.status === "comparable") {
      expect(result.matchingObservation.source).toBe("hospitable")
      expect(result.matchingObservation.value).not.toBe(
        fixture.sourceSnapshots.pricelabs.rentalRevenue
      )
    }
  })
})

describe("Ashwood acceptance scenario E — source precedence", () => {
  it("prefers the current direct PriceLabs value over a stale Hub cache", () => {
    const preferred = choosePreferredObservation([
      {
        sourceReference: fixture.sourceSnapshots.hubCache.snapshotId,
        sourceTier: 3,
        observedAt: fixture.sourceSnapshots.hubCache.observedAt,
        freshness: fixture.sourceSnapshots.hubCache.freshness as "stale",
        value: fixture.sourceSnapshots.hubCache.basePrice,
      },
      {
        sourceReference: fixture.sourceSnapshots.pricelabs.snapshotId,
        sourceTier: 2,
        observedAt: fixture.sourceSnapshots.pricelabs.observedAt,
        freshness: "current",
        value: fixture.sourceSnapshots.pricelabs.pricing.basePrice,
      },
    ])
    expect(preferred?.value).toBe(285)
    expect(preferred?.sourceReference).toContain("direct")
  })
})

describe("Ashwood acceptance scenario F — idempotent reconciliation", () => {
  it("does not duplicate source records or duplicate issues when the import runs twice", () => {
    const sample = fixture.duplicateReservationSample as SourceReservationRow[]
    const first = reconcileReservationImport([], sample)
    const second = reconcileReservationImport(first.records, sample)

    expect(first.records).toHaveLength(2)
    expect(first.duplicateIssues).toHaveLength(1)
    expect(second.records).toEqual(first.records)
    expect(second.duplicateIssues).toEqual(first.duplicateIssues)
    expect(second.duplicateIssues[0].sourceRecordIds).toEqual([
      "sanitized-cancelled-row-a",
      "sanitized-cancelled-row-b",
    ])
  })

  it("preserves the source-native status mismatch instead of forcing the totals to agree", () => {
    expect(fixture.sourceSnapshots.hospitable.reservationCounts.total).toBe(172)
    expect(fixture.sourceSnapshots.pricelabs.reservationCounts.total).toBe(174)
    expect(fixture.sourceSnapshots.hospitable.reservationCounts.accepted).toBe(
      fixture.sourceSnapshots.pricelabs.reservationCounts.booked
    )
  })
})

describe("Additional Phase 0 deterministic guardrails", () => {
  it("calculates minimum-price exposure from sellable nights only", () => {
    const result = computeMinimumPriceExposure([
      {
        date: "2026-08-20",
        availabilityStatus: "available",
        recommendedPrice: 125,
        minimumPrice: 125,
      },
      {
        date: "2026-08-21",
        availabilityStatus: "available",
        recommendedPrice: 150,
        minimumPrice: 125,
      },
      {
        date: "2026-08-22",
        availabilityStatus: "booked",
        recommendedPrice: 125,
        minimumPrice: 125,
      },
      {
        date: "2026-08-23",
        availabilityStatus: "blocked",
        recommendedPrice: 125,
        minimumPrice: 125,
      },
    ])
    expect(result).toEqual({
      availableNights: 2,
      nightsAtMinimum: 1,
      exposure: 0.5,
    })
  })

  it("blocks discount recommendations that overlap a protected date", () => {
    const conflicts = findProtectedDateConflicts(
      "2026-12-30",
      "2027-01-02",
      "discount",
      fixture.constraints.protectedDates as Array<{
        date: string
        action: "discount_prohibited"
        policyReference: string
      }>
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].date).toBe("2026-12-31")
  })
})
