import fixture from "@/lib/revenue-manager/fixtures/ashwood.v1.json"
import {
  REVENUE_CONTRACT_VERSIONS,
  metricEvidenceSchema,
  revenuePropertyProfileSchema,
  type MetricEvidence,
  type RevenuePropertyProfile,
} from "@/lib/revenue-manager/contracts"
import {
  REVENUE_DEFINITION_VERSIONS,
  computeInventoryMetrics,
} from "@/lib/revenue-manager/domain"

export type RevenueEvidenceBundle = {
  profile: RevenuePropertyProfile
  metrics: MetricEvidence[]
  sourceManifest: {
    fixtureVersion: string
    snapshots: string[]
    asOf: string
    mode: "sanitized_fixture"
  }
}

function field(
  value: unknown,
  options: {
    sourceReference: string
    observedAt: string
    confidence?: "high" | "medium" | "low" | "unknown"
    verificationState?:
      | "observed"
      | "inferred"
      | "human_confirmed"
      | "superseded"
    unit?: string | null
    notes?: string | null
  }
) {
  return {
    value,
    unit: options.unit ?? null,
    effectiveFrom: options.observedAt.slice(0, 10),
    effectiveTo: null,
    sourceType: "sanitized_fixture",
    sourceReference: options.sourceReference,
    observedAt: options.observedAt,
    confidence: options.confidence ?? "high",
    verificationState: options.verificationState ?? "observed",
    notes: options.notes ?? null,
  } as const
}

function metric(input: Omit<MetricEvidence, "schemaVersion">): MetricEvidence {
  return metricEvidenceSchema.parse({
    schemaVersion: REVENUE_CONTRACT_VERSIONS.metric,
    ...input,
  })
}

export function getAshwoodEvidenceBundle(): RevenueEvidenceBundle {
  const property = fixture.property
  const hospitable = fixture.sourceSnapshots.hospitable
  const pricelabs = fixture.sourceSnapshots.pricelabs
  const inventory = computeInventoryMetrics(fixture.historicalInventory)
  const sourceSnapshotIds = [
    hospitable.snapshotId,
    pricelabs.snapshotId,
    fixture.sourceSnapshots.hubCache.snapshotId,
  ]

  const profile = revenuePropertyProfileSchema.parse({
    schemaVersion: REVENUE_CONTRACT_VERSIONS.profile,
    propertyKey: property.propertyKey,
    displayName: property.displayName,
    version: 1,
    lifecycleMode: property.lifecycleMode,
    status: "needs_confirmation",
    dataConfidence: "medium",
    identity: {
      market: field(property.market, {
        sourceReference: fixture.fixtureVersion,
        observedAt: fixture.sanitizedAt,
      }),
      propertyShape: field(
        {
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          sleeps: property.sleeps,
        },
        {
          sourceReference: fixture.fixtureVersion,
          observedAt: fixture.sanitizedAt,
        }
      ),
    },
    positioning: {
      primaryAmenities: field(["pool", "game_room"], {
        sourceReference: fixture.fixtureVersion,
        observedAt: fixture.sanitizedAt,
        confidence: "medium",
      }),
    },
    objective: {
      annualRevenueGoal: field(fixture.objective.target, {
        sourceReference: "owner-input-v1",
        observedAt: fixture.sanitizedAt,
        verificationState: "human_confirmed",
        unit: fixture.objective.currency,
        notes: "Revenue measure and target period remain unresolved.",
      }),
      strategyPriority: field("improve_revenue_and_adr", {
        sourceReference: "owner-input-v1",
        observedAt: fixture.sanitizedAt,
        verificationState: "human_confirmed",
      }),
    },
    economics: {
      goalRevenueMeasure: field(fixture.objective.revenueMeasure, {
        sourceReference: "owner-input-v1",
        observedAt: fixture.sanitizedAt,
        confidence: "unknown",
        notes: "Required before target attainment can be calculated.",
      }),
      cleaningCostReference: field(172.55, {
        sourceReference: "historical-cost-reference",
        observedAt: fixture.sanitizedAt,
        confidence: "low",
        unit: "USD_per_turnover",
        notes: "Historical, non-audited reference; verify before profit use.",
      }),
    },
    inventoryOperations: {
      permitBlocks: field(fixture.forwardInventory.knownPermitBlocks, {
        sourceReference: fixture.fixtureVersion,
        observedAt: fixture.sanitizedAt,
        verificationState: "human_confirmed",
        notes: "Temporary test constraints for permit renewal.",
      }),
      sameDayTurnsAllowed: field(fixture.constraints.sameDayTurnsAllowed, {
        sourceReference: "owner-input-v1",
        observedAt: fixture.sanitizedAt,
        verificationState: "human_confirmed",
      }),
    },
    pricingStrategy: {
      basePrice: field(pricelabs.pricing.basePrice, {
        sourceReference: pricelabs.snapshotId,
        observedAt: pricelabs.observedAt,
        unit: "USD",
      }),
      minimumPrice: field(pricelabs.pricing.minimumPrice, {
        sourceReference: pricelabs.snapshotId,
        observedAt: pricelabs.observedAt,
        unit: "USD",
      }),
      lastMinuteRule: field(
        {
          discountPercent: pricelabs.pricing.lastMinuteDiscountPercent,
          windowDays: pricelabs.pricing.lastMinuteWindowDays,
        },
        {
          sourceReference: pricelabs.snapshotId,
          observedAt: pricelabs.observedAt,
        }
      ),
    },
    distribution: {
      airbnbMarkup: field(fixture.constraints.airbnbMarkupPercent, {
        sourceReference: "owner-input-v1",
        observedAt: fixture.sanitizedAt,
        verificationState: "human_confirmed",
        unit: "percent",
        notes: "Intentional because Airbnb discounts are heavily used.",
      }),
      directGuestPricePolicy: field(
        fixture.constraints.directFinalGuestPriceBelowAirbnbPercent,
        {
          sourceReference: "owner-input-v1",
          observedAt: fixture.sanitizedAt,
          verificationState: "human_confirmed",
          unit: "percent_below_airbnb_final_guest_price",
        }
      ),
    },
    demandMarket: {
      closeInAdjustedOccupancy: field(pricelabs.adjustedOccupancy, {
        sourceReference: pricelabs.snapshotId,
        observedAt: pricelabs.observedAt,
        confidence: "medium",
        notes: "Source metric definition and exact cohort are unresolved.",
      }),
    },
    policies: {
      protectedDates: field(fixture.constraints.protectedDates, {
        sourceReference: "owner-input-v1",
        observedAt: fixture.sanitizedAt,
        verificationState: "human_confirmed",
      }),
      guestCountExceptions: field(
        fixture.constraints.historicalGuestCountExceptionsConfirmed,
        {
          sourceReference: "owner-input-v1",
          observedAt: fixture.sanitizedAt,
          verificationState: "human_confirmed",
        }
      ),
    },
    dataHealth: {
      openIssues: field(fixture.knownDataIssues, {
        sourceReference: fixture.fixtureVersion,
        observedAt: fixture.sanitizedAt,
        confidence: "high",
      }),
    },
    sourceSnapshotIds,
    createdAt: fixture.sanitizedAt,
  })

  const common = {
    propertyKey: property.propertyKey,
    asOf: pricelabs.observedAt,
    grain: "window" as const,
    sourceSnapshotId: pricelabs.snapshotId,
    sourceType: "pricelabs_direct_fixture",
    comparisonType: "market" as const,
    freshness: "current" as const,
    exclusions: [] as string[],
  }

  const metrics = [
    metric({
      evidenceId: "ashwood-adjusted-occ-15d",
      metricKey: "adjusted_occupancy_15d",
      ...common,
      stayRange: { start: "2026-08-20", end: "2026-09-03" },
      definitionVersion: "pricelabs_adjusted_occupancy.unresolved",
      benchmark: {
        scope: pricelabs.adjustedOccupancy.benchmarkScope,
        definition: "PriceLabs market adjusted occupancy; unresolved",
        value: pricelabs.adjustedOccupancy.next15Days.market,
        unit: "ratio",
      },
      value: pricelabs.adjustedOccupancy.next15Days.property,
      unit: "ratio",
      numerator: null,
      denominator: null,
      notes: "Definition must be resolved before a commercial rate change.",
    }),
    metric({
      evidenceId: "ashwood-minimum-exposure-15d",
      metricKey: "minimum_price_exposure_15d",
      ...common,
      stayRange: { start: "2026-08-20", end: "2026-09-03" },
      definitionVersion: REVENUE_DEFINITION_VERSIONS.minimumPriceExposure,
      comparisonType: "none",
      benchmark: null,
      value: pricelabs.minimumPriceExposure.next15Days,
      unit: "ratio",
      numerator: null,
      denominator: null,
      notes: "Supplied aggregate; raw forward rows remain the future source.",
    }),
    metric({
      evidenceId: "ashwood-calendar-utilization-history",
      metricKey: "calendar_utilization",
      ...common,
      stayRange: {
        start: fixture.historicalInventory.periodStart,
        end: fixture.historicalInventory.periodEnd,
      },
      sourceSnapshotId: hospitable.snapshotId,
      sourceType: "hospitable_fixture",
      definitionVersion: REVENUE_DEFINITION_VERSIONS.calendarUtilization,
      comparisonType: "none",
      benchmark: null,
      value: inventory.calendarUtilization,
      unit: "ratio",
      numerator: inventory.bookedNights,
      denominator: inventory.calendarNights,
      freshness: "stale",
      exclusions: [],
      notes: "Historical context; includes blocked nights in denominator.",
    }),
    metric({
      evidenceId: "ashwood-sellable-occupancy-history",
      metricKey: "sellable_occupancy",
      ...common,
      stayRange: {
        start: fixture.historicalInventory.periodStart,
        end: fixture.historicalInventory.periodEnd,
      },
      sourceSnapshotId: hospitable.snapshotId,
      sourceType: "hospitable_fixture",
      definitionVersion: REVENUE_DEFINITION_VERSIONS.sellableOccupancy,
      comparisonType: "none",
      benchmark: null,
      value: inventory.sellableOccupancy,
      unit: "ratio",
      numerator: inventory.bookedNights,
      denominator:
        inventory.calendarNights - fixture.historicalInventory.blockedNights,
      freshness: "stale",
      exclusions: ["intentionally blocked nights"],
      notes: "Historical context only.",
    }),
  ]

  return {
    profile,
    metrics,
    sourceManifest: {
      fixtureVersion: fixture.fixtureVersion,
      snapshots: sourceSnapshotIds,
      asOf: pricelabs.observedAt,
      mode: "sanitized_fixture",
    },
  }
}
