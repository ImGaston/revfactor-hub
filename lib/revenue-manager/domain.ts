export const REVENUE_DEFINITION_VERSIONS = {
  calendarUtilization: "calendar_utilization.v1",
  sellableOccupancy: "sellable_occupancy.v1",
  minimumPriceExposure: "minimum_price_exposure.v1",
  sourcePrecedence: "source_precedence.v1",
  reservationReconciliation: "reservation_reconciliation.v1",
} as const

export const REVENUE_METRIC_DEFINITIONS = {
  [REVENUE_DEFINITION_VERSIONS.calendarUtilization]: {
    label: "Calendar utilization",
    formula: "booked_nights / calendar_nights",
    exclusions: [],
  },
  [REVENUE_DEFINITION_VERSIONS.sellableOccupancy]: {
    label: "Sellable occupancy",
    formula: "booked_nights / (calendar_nights - blocked_nights)",
    exclusions: ["intentionally blocked nights"],
  },
  [REVENUE_DEFINITION_VERSIONS.minimumPriceExposure]: {
    label: "Minimum-price exposure",
    formula: "available nights at configured minimum / available nights",
    exclusions: ["booked nights", "blocked nights"],
  },
} as const

export type InventoryCounts = {
  calendarNights: number
  bookedNights: number
  blockedNights: number
}

export type InventoryMetrics = InventoryCounts & {
  openNights: number
  calendarUtilization: number | null
  sellableOccupancy: number | null
}

function assertWholeNonNegative(label: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
}

export function computeInventoryMetrics(
  counts: InventoryCounts
): InventoryMetrics {
  assertWholeNonNegative("calendarNights", counts.calendarNights)
  assertWholeNonNegative("bookedNights", counts.bookedNights)
  assertWholeNonNegative("blockedNights", counts.blockedNights)

  if (counts.bookedNights + counts.blockedNights > counts.calendarNights) {
    throw new Error("Booked and blocked nights cannot exceed calendar nights")
  }

  const sellableNights = counts.calendarNights - counts.blockedNights
  return {
    ...counts,
    openNights:
      counts.calendarNights - counts.bookedNights - counts.blockedNights,
    calendarUtilization:
      counts.calendarNights === 0
        ? null
        : counts.bookedNights / counts.calendarNights,
    sellableOccupancy:
      sellableNights === 0 ? null : counts.bookedNights / sellableNights,
  }
}

export type ForwardPriceNight = {
  date: string
  availabilityStatus: "available" | "booked" | "blocked"
  recommendedPrice: number | null
  minimumPrice: number | null
}

export function computeMinimumPriceExposure(rows: ForwardPriceNight[]): {
  availableNights: number
  nightsAtMinimum: number
  exposure: number | null
} {
  const available = rows.filter((row) => row.availabilityStatus === "available")
  const nightsAtMinimum = available.filter(
    (row) =>
      row.recommendedPrice != null &&
      row.minimumPrice != null &&
      row.recommendedPrice <= row.minimumPrice
  ).length

  return {
    availableNights: available.length,
    nightsAtMinimum,
    exposure:
      available.length === 0 ? null : nightsAtMinimum / available.length,
  }
}

export type RevenueMeasure =
  | "gross_booking_value"
  | "rental_revenue"
  | "host_revenue"
  | "net_owner_revenue"

export type RevenueObservation = {
  source: string
  measure: RevenueMeasure
  value: number
  periodStart: string
  periodEnd: string
}

export type RevenueGoal = {
  value: number
  measure: RevenueMeasure | null
  periodStart: string | null
  periodEnd: string | null
}

export function evaluateRevenueGoal(
  goal: RevenueGoal,
  observations: RevenueObservation[]
):
  | {
      status: "blocked"
      reasons: string[]
      matchingObservation: null
      attainment: null
    }
  | {
      status: "comparable"
      reasons: []
      matchingObservation: RevenueObservation
      attainment: number
    } {
  const reasons: string[] = []
  if (!goal.measure) reasons.push("Goal revenue measure is unresolved")
  if (!goal.periodStart || !goal.periodEnd)
    reasons.push("Goal period is unresolved")
  if (reasons.length > 0) {
    return {
      status: "blocked",
      reasons,
      matchingObservation: null,
      attainment: null,
    }
  }

  const match = observations.find(
    (observation) =>
      observation.measure === goal.measure &&
      observation.periodStart === goal.periodStart &&
      observation.periodEnd === goal.periodEnd
  )
  if (!match) {
    return {
      status: "blocked",
      reasons: [
        "No observation matches both the goal revenue measure and period",
      ],
      matchingObservation: null,
      attainment: null,
    }
  }

  return {
    status: "comparable",
    reasons: [],
    matchingObservation: match,
    attainment: goal.value === 0 ? 0 : match.value / goal.value,
  }
}

export type SourceObservation<T> = {
  sourceReference: string
  sourceTier: 1 | 2 | 3 | 4 | 5 | 6
  observedAt: string
  freshness: "current" | "stale" | "unknown"
  value: T
}

export function choosePreferredObservation<T>(
  observations: SourceObservation<T>[]
): SourceObservation<T> | null {
  if (observations.length === 0) return null
  const current = observations.filter(
    (observation) => observation.freshness === "current"
  )
  const candidates = current.length > 0 ? current : observations
  return [...candidates].sort((a, b) => {
    if (a.sourceTier !== b.sourceTier) return a.sourceTier - b.sourceTier
    return b.observedAt.localeCompare(a.observedAt)
  })[0]
}

export type CanonicalReservationStatus = "booked" | "cancelled" | "other"

export type SourceReservationRow = {
  source: string
  sourceRecordId: string
  rawStatus: string
  canonicalStatus: CanonicalReservationStatus
  bookedDate: string | null
  checkIn: string
  checkOut: string
  nights: number
  rentalRevenue: number | null
}

export type DuplicateIssue = {
  issueKey: string
  source: string
  fingerprint: string
  sourceRecordIds: string[]
}

function reservationIdentity(row: SourceReservationRow): string {
  return `${row.source}:${row.sourceRecordId}`
}

function reservationFingerprint(row: SourceReservationRow): string {
  return [
    row.rawStatus,
    row.bookedDate ?? "null",
    row.checkIn,
    row.checkOut,
    row.nights,
    row.rentalRevenue ?? "null",
  ].join("|")
}

export function reconcileReservationImport(
  existing: SourceReservationRow[],
  incoming: SourceReservationRow[]
): { records: SourceReservationRow[]; duplicateIssues: DuplicateIssue[] } {
  const recordsByIdentity = new Map<string, SourceReservationRow>()
  for (const row of [...existing, ...incoming]) {
    recordsByIdentity.set(reservationIdentity(row), row)
  }

  const records = [...recordsByIdentity.values()].sort((a, b) =>
    reservationIdentity(a).localeCompare(reservationIdentity(b))
  )
  const fingerprintGroups = new Map<string, SourceReservationRow[]>()
  for (const row of records) {
    const key = `${row.source}:${reservationFingerprint(row)}`
    const group = fingerprintGroups.get(key) ?? []
    group.push(row)
    fingerprintGroups.set(key, group)
  }

  const duplicateIssues = [...fingerprintGroups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      issueKey: `duplicate_reservation:${key}`,
      source: rows[0].source,
      fingerprint: reservationFingerprint(rows[0]),
      sourceRecordIds: rows.map((row) => row.sourceRecordId).sort(),
    }))
    .sort((a, b) => a.issueKey.localeCompare(b.issueKey))

  return { records, duplicateIssues }
}

export type ProtectedDateConstraint = {
  date: string
  action: "discount_prohibited"
  policyReference: string
}

export function findProtectedDateConflicts(
  stayStart: string,
  stayEnd: string,
  actionType: "discount" | "increase" | "other",
  constraints: ProtectedDateConstraint[]
): ProtectedDateConstraint[] {
  if (actionType !== "discount") return []
  return constraints.filter(({ date }) => date >= stayStart && date <= stayEnd)
}
