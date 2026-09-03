import { createHash } from "node:crypto"

import {
  CASE_STUDY_WORKFLOW_VERSION,
  EXPECTED_REVFACTOR_PROJECT_REF,
  type CaseStudyCandidate,
  type CaseStudyFoundationResult,
  type CaseStudyMonthlyEvidence,
  type CaseStudyPeriodSummary,
  type CaseStudySourceInventory,
  type CaseStudyState,
  type CaseType,
  type HubListingSource,
  type OnboardingRunListingSource,
  type OnboardingRunSource,
  type PriorYearAttribution,
  type ReportMetricSource,
  type StartConfidence,
} from "@/lib/case-studies/contracts"
import { WINS_RULES_V1 } from "@/lib/wins"

const DAY_MS = 86_400_000
const REVPAR_INDEX_TOLERANCE = 2

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`
}

function addMonths(value: string, count: number): string {
  const date = new Date(`${monthStart(value)}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + count)
  return date.toISOString().slice(0, 10)
}

function monthEnd(value: string): string {
  const next = new Date(`${addMonths(value, 1)}T00:00:00Z`)
  next.setUTCDate(0)
  return next.toISOString().slice(0, 10)
}

export function firstCompleteManagedMonth(startDate: string): string {
  return startDate.endsWith("-01")
    ? monthStart(startDate)
    : addMonths(startDate, 1)
}

export function lastCompleteMonth(asOf: string): string {
  return addMonths(monthStart(asOf), -1)
}

export function monthsInclusive(start: string, end: string): string[] {
  const output: string[] = []
  for (
    let cursor = monthStart(start);
    cursor <= monthStart(end);
    cursor = addMonths(cursor, 1)
  ) {
    output.push(cursor)
    if (output.length > 1_200) throw new Error("Month range exceeded 100 years")
  }
  return output
}

function priorYearPeriod(period: string): string {
  return `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`
}

function daysBetween(earlier: string, later: string): number {
  return Math.floor(
    (Date.parse(`${later.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${earlier.slice(0, 10)}T00:00:00Z`)) /
      DAY_MS
  )
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  if (present.length === 0) return null
  return present.reduce((sum, value) => sum + value, 0) / present.length
}

function sum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  if (present.length === 0) return null
  return present.reduce((total, value) => total + value, 0)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function monthValue(year: number | null, month: number | null): string | null {
  if (year === null || month === null) return null
  return `${year}-${String(month).padStart(2, "0")}`
}

type StartEvidence = {
  date: string | null
  confidence: StartConfidence
  source: string | null
  flags: string[]
}

function resolveStartEvidence(
  listing: HubListingSource,
  setupDates: string[],
  rosterRows: OnboardingRunListingSource[],
  runsById: Map<string, OnboardingRunSource>,
  clientOnboardingDate: string | null
): StartEvidence {
  const flags: string[] = []
  const distinctSetupDates = unique(setupDates).sort()
  if (distinctSetupDates.length > 1) flags.push("conflicting_setup_adjustments")

  if (listing.initial_setup_date) {
    if (
      distinctSetupDates.length > 0 &&
      !distinctSetupDates.includes(listing.initial_setup_date)
    ) {
      flags.push("management_start_conflict")
    }
    return {
      date: listing.initial_setup_date,
      confidence: "high",
      source: "listings.initial_setup_date",
      flags,
    }
  }

  if (distinctSetupDates.length === 1) {
    return {
      date: distinctSetupDates[0],
      confidence: "high",
      source: "controlled_setup_adjustment.resolved_at",
      flags,
    }
  }

  const liveDates = unique(
    rosterRows
      .map((row) => runsById.get(row.run_id)?.live_at?.slice(0, 10) ?? null)
      .filter((value): value is string => value !== null)
  ).sort()
  if (liveDates.length > 1) flags.push("conflicting_onboarding_live_dates")
  if (liveDates.length === 1) {
    return {
      date: liveDates[0],
      confidence: "medium",
      source: "onboarding_run.live_at",
      flags,
    }
  }

  if (clientOnboardingDate && rosterRows.length > 0) {
    return {
      date: clientOnboardingDate,
      confidence: "medium",
      source: "clients.onboarding_date+onboarding_run_listing",
      flags,
    }
  }

  return {
    date: listing.created_at.slice(0, 10),
    confidence: "low",
    source: "listings.created_at",
    flags,
  }
}

function resolveLaunchEvidence(rows: OnboardingRunListingSource[]): {
  caseType: CaseType
  launchDate: string | null
  flags: string[]
} {
  if (rows.length === 0) {
    return {
      caseType: "unknown",
      launchDate: null,
      flags: ["missing_launch_evidence"],
    }
  }

  const states = unique(rows.map((row) => row.is_live)).sort()
  if (states.length !== 1) {
    return {
      caseType: "unknown",
      launchDate: null,
      flags: ["conflicting_launch_classification"],
    }
  }

  const caseType: CaseType = states[0]
    ? "inherited"
    : "revfactor_assisted_launch"
  const dates = unique(
    rows
      .map((row) =>
        caseType === "inherited"
          ? monthValue(row.launch_year, row.launch_month)
          : monthValue(row.target_launch_year, row.target_launch_month)
      )
      .filter((value): value is string => value !== null)
  ).sort()

  if (dates.length > 1) {
    return {
      caseType,
      launchDate: null,
      flags: ["conflicting_launch_dates"],
    }
  }
  return {
    caseType,
    launchDate: dates[0] ?? null,
    flags: dates.length === 0 ? ["missing_launch_date"] : [],
  }
}

function priorAttribution(
  period: string,
  managementStart: string | null,
  confidence: StartConfidence
): PriorYearAttribution {
  if (!managementStart || confidence === "none" || confidence === "low")
    return "unknown"
  return monthEnd(priorYearPeriod(period)) < managementStart
    ? "before_revfactor"
    : "revfactor_managed"
}

function safeRate(
  current: number | null,
  baseline: number | null
): number | null {
  if (current === null || baseline === null || baseline <= 0) return null
  return (current / baseline - 1) * 100
}

function buildMonth(
  metric: ReportMetricSource,
  managementStart: string | null,
  confidence: StartConfidence,
  caseType: CaseType
): CaseStudyMonthlyEvidence {
  const flags: string[] = ["market_adr_ly_unavailable_from_source"]
  const attribution = priorAttribution(
    metric.period,
    managementStart,
    confidence
  )
  const currentRequired = [
    metric.rental_revenue,
    metric.rental_adr,
    metric.rental_revpar,
    metric.market_adr,
    metric.market_revpar,
    metric.revpar_index,
    metric.adjusted_occupancy_pct,
    metric.market_occupancy_pct,
    metric.median_booking_window,
    metric.market_median_booking_window,
  ]
  if (currentRequired.some((value) => value === null))
    flags.push("incomplete_current_metrics")
  if (
    metric.market_revpar_ly === null ||
    metric.market_occupancy_ly_pct === null
  ) {
    flags.push("missing_market_ly")
  }
  if (metric.market_revpar_ly !== null && metric.market_revpar_ly <= 0) {
    flags.push("invalid_market_ly_baseline")
  }

  for (const value of [
    metric.rental_revenue,
    metric.rental_adr,
    metric.rental_revpar,
    metric.market_adr,
    metric.market_revpar,
  ]) {
    if (value !== null && value < 0) flags.push("negative_metric")
  }
  for (const value of [
    metric.adjusted_occupancy_pct,
    metric.adjusted_occupancy_ly_pct,
    metric.market_occupancy_pct,
    metric.market_occupancy_ly_pct,
  ]) {
    if (value !== null && (value < 0 || value > 100))
      flags.push("invalid_occupancy")
  }
  if (
    metric.revpar_index !== null &&
    metric.revpar_index > WINS_RULES_V1.revparIndexQaCeiling
  ) {
    flags.push("compset_qa_required")
  }
  if (
    metric.rental_revpar !== null &&
    metric.market_revpar !== null &&
    metric.market_revpar > 0 &&
    metric.revpar_index !== null
  ) {
    const derivedIndex = (metric.rental_revpar / metric.market_revpar) * 100
    if (Math.abs(derivedIndex - metric.revpar_index) > REVPAR_INDEX_TOLERANCE) {
      flags.push("revpar_index_mismatch")
    }
  }

  const comparable =
    attribution === "before_revfactor" &&
    caseType !== "revfactor_assisted_launch"
  const finalLyRequired = [
    metric.rental_revenue_ly,
    metric.rental_adr_ly,
    metric.rental_revpar_ly,
    metric.adjusted_occupancy_ly_pct,
    metric.market_revpar_ly,
    metric.market_occupancy_ly_pct,
  ]
  if (comparable && finalLyRequired.some((value) => value === null)) {
    flags.push("missing_final_ly")
  }
  if (
    comparable &&
    metric.rental_revenue_ly !== null &&
    metric.rental_revenue_ly > 0 &&
    metric.rental_revenue_ly < WINS_RULES_V1.minStlyRevenue
  ) {
    flags.push("small_ly_revenue_base")
  }
  if (
    comparable &&
    metric.rental_revenue_ly !== null &&
    metric.rental_revenue_ly <= 0
  ) {
    flags.push("invalid_ly_revenue_base")
  }

  const smallLyBase =
    comparable &&
    metric.rental_revenue_ly !== null &&
    metric.rental_revenue_ly < WINS_RULES_V1.minStlyRevenue

  let listingRevparYoy =
    comparable && !smallLyBase
      ? safeRate(metric.rental_revpar, metric.rental_revpar_ly)
      : null
  let marketRevparYoy = safeRate(metric.market_revpar, metric.market_revpar_ly)
  if (
    listingRevparYoy !== null &&
    Math.abs(listingRevparYoy / 100) > WINS_RULES_V1.extremeYoyPct
  ) {
    flags.push("extreme_listing_revpar_yoy")
    listingRevparYoy = null
  }

  const invalidCurrentFlags = new Set([
    "incomplete_current_metrics",
    "negative_metric",
    "invalid_occupancy",
    "compset_qa_required",
    "revpar_index_mismatch",
    "missing_market_ly",
    "invalid_market_ly_baseline",
  ])
  if (
    marketRevparYoy !== null &&
    Math.abs(marketRevparYoy / 100) > WINS_RULES_V1.extremeYoyPct
  ) {
    flags.push("extreme_market_revpar_yoy")
    marketRevparYoy = null
  }

  return {
    period: metric.period,
    priorYearPeriod: priorYearPeriod(metric.period),
    priorYearAttribution: attribution,
    rentalRevenue: metric.rental_revenue,
    rentalRevenueLy: comparable ? metric.rental_revenue_ly : null,
    occupancyPct: metric.adjusted_occupancy_pct,
    occupancyLyPct: comparable ? metric.adjusted_occupancy_ly_pct : null,
    adr: metric.rental_adr,
    adrLy: comparable ? metric.rental_adr_ly : null,
    revpar: metric.rental_revpar,
    revparLy: comparable ? metric.rental_revpar_ly : null,
    marketOccupancyPct: metric.market_occupancy_pct,
    marketOccupancyLyPct: metric.market_occupancy_ly_pct,
    marketAdr: metric.market_adr,
    marketAdrLy: null,
    marketRevpar: metric.market_revpar,
    marketRevparLy: metric.market_revpar_ly,
    revparIndex: metric.revpar_index,
    bookingWindow: metric.median_booking_window,
    bookingWindowLy: comparable ? metric.median_booking_window_ly : null,
    marketBookingWindow: metric.market_median_booking_window,
    marketBookingWindowLy: metric.market_median_booking_window_ly,
    listingRevparYoyPct: listingRevparYoy,
    marketRevparYoyPct: marketRevparYoy,
    marketAdjustedRevparLiftPp:
      listingRevparYoy !== null && marketRevparYoy !== null
        ? listingRevparYoy - marketRevparYoy
        : null,
    isValidCurrentEvidence: !flags.some((flag) =>
      invalidCurrentFlags.has(flag)
    ),
    qaFlags: unique(flags).sort(),
  }
}

function summarize(
  label: CaseStudyPeriodSummary["label"],
  months: CaseStudyMonthlyEvidence[],
  available = true,
  unavailableReason: string | null = null
): CaseStudyPeriodSummary {
  const comparable = months.filter(
    (month) => month.marketAdjustedRevparLiftPp !== null
  )
  const lift = comparable.map((month) => month.marketAdjustedRevparLiftPp)
  return {
    label,
    available,
    unavailableReason,
    monthCount: months.length,
    comparableMonthCount: comparable.length,
    revenue: sum(months.map((month) => month.rentalRevenue)),
    revenueLy: sum(comparable.map((month) => month.rentalRevenueLy)),
    averageOccupancyPct: average(months.map((month) => month.occupancyPct)),
    averageAdr: average(months.map((month) => month.adr)),
    averageRevpar: average(months.map((month) => month.revpar)),
    averageMarketRevpar: average(months.map((month) => month.marketRevpar)),
    averageRevparIndex: average(months.map((month) => month.revparIndex)),
    averageMarketAdjustedRevparLiftPp: average(lift),
    shareComparableMonthsOutperformingMarket:
      comparable.length === 0
        ? null
        : comparable.filter(
            (month) => (month.marketAdjustedRevparLiftPp ?? 0) > 0
          ).length / comparable.length,
    marketResilience: months.some(
      (month) =>
        (month.marketRevparYoyPct ?? 0) < 0 &&
        ((month.listingRevparYoyPct ?? 0) > 0 ||
          (month.revparIndex ?? 0) >= 100)
    ),
    marketDeclined: months.some((month) => (month.marketRevparYoyPct ?? 0) < 0),
  }
}

function periodSummaries(
  months: CaseStudyMonthlyEvidence[],
  firstEligibleMonth: string | null
): CaseStudyPeriodSummary[] {
  const firstSummary = (
    label: "first_3" | "first_6" | "first_12",
    count: number
  ) => {
    const selected = months.slice(0, count)
    const expected = firstEligibleMonth
      ? monthsInclusive(
          firstEligibleMonth,
          addMonths(firstEligibleMonth, count - 1)
        )
      : []
    const available =
      selected.length === count &&
      selected.every((month, index) => month.period === expected[index])
    return summarize(
      label,
      available ? selected : [],
      available,
      available
        ? null
        : "coverage_does_not_start_with_consecutive_first_eligible_months"
    )
  }

  return [
    firstSummary("first_3", 3),
    firstSummary("first_6", 6),
    firstSummary("first_12", 12),
    summarize("latest_3", months.slice(-3)),
    summarize("all_supported", months),
  ]
}

function candidateState(input: {
  confidence: StartConfidence
  caseType: CaseType
  supportedMonthCount: number
  comparableMonthCount: number
  flags: string[]
}): CaseStudyState {
  if (input.confidence === "none" || input.confidence === "low") {
    return "Missing start proof"
  }
  if (input.supportedMonthCount < 3) return "Discovered"
  if (input.caseType === "inherited" && input.comparableMonthCount < 3) {
    return "Missing baseline"
  }
  const informational = new Set([
    "market_adr_ly_unavailable_from_source",
    "missing_launch_date",
    "first_3_unavailable",
    "first_6_unavailable",
    "first_12_unavailable",
  ])
  if (input.flags.some((flag) => !informational.has(flag))) return "Needs QA"
  return "Quantitatively supported"
}

function rankCandidates(candidates: CaseStudyCandidate[]) {
  const eligible = candidates
    .filter((candidate) => candidate.state === "Quantitatively supported")
    .sort((left, right) => {
      const leftAll = left.periods.find(
        (period) => period.label === "all_supported"
      )!
      const rightAll = right.periods.find(
        (period) => period.label === "all_supported"
      )!
      const comparisons: Array<[number, number]> = [
        [
          rightAll.averageMarketAdjustedRevparLiftPp ??
            Number.NEGATIVE_INFINITY,
          leftAll.averageMarketAdjustedRevparLiftPp ?? Number.NEGATIVE_INFINITY,
        ],
        [
          rightAll.shareComparableMonthsOutperformingMarket ??
            Number.NEGATIVE_INFINITY,
          leftAll.shareComparableMonthsOutperformingMarket ??
            Number.NEGATIVE_INFINITY,
        ],
        [
          rightAll.averageRevparIndex ?? Number.NEGATIVE_INFINITY,
          leftAll.averageRevparIndex ?? Number.NEGATIVE_INFINITY,
        ],
        [right.supportedManagedMonthCount, left.supportedManagedMonthCount],
      ]
      for (const [first, second] of comparisons) {
        if (first !== second) return first - second
      }
      return left.hubListingId.localeCompare(right.hubListingId)
    })
  eligible.forEach((candidate, index) => {
    candidate.rank = index + 1
  })
}

function buildCandidate(
  listing: HubListingSource,
  inventory: CaseStudySourceInventory,
  sharedFlags: string[]
): CaseStudyCandidate {
  const flags = [...sharedFlags]
  const client =
    inventory.clients.find((row) => row.id === listing.client_id) ?? null
  if (!client) flags.push("missing_client")
  else if (client.status === "inactive") flags.push("inactive_client")

  const priceLabsId = listing.listing_id?.trim() || null
  const duplicateHubMatches = priceLabsId
    ? inventory.listings.filter((row) => row.listing_id?.trim() === priceLabsId)
    : []
  if (!priceLabsId) flags.push("missing_pricelabs_listing_id")
  if (duplicateHubMatches.length > 1) flags.push("ambiguous_listing_mapping")

  const reportListing = priceLabsId
    ? (inventory.reportListings.find((row) => row.listing_id === priceLabsId) ??
      null)
    : null
  if (!reportListing) flags.push("missing_report_listing")
  else {
    if (reportListing.hub_listing_id !== listing.id)
      flags.push("report_listing_id_mismatch")
    if (reportListing.hub_client_id !== listing.client_id)
      flags.push("report_client_id_mismatch")
    if (reportListing.report_run_id !== inventory.reportRun.id) {
      flags.push("stale_report_listing")
    }
  }

  const setupDates = inventory.setupAdjustments
    .filter((adjustment) => adjustment.listing_id === listing.id)
    .map((adjustment) => adjustment.resolved_at?.slice(0, 10) ?? null)
    .filter((value): value is string => value !== null)
  const rosterRows = inventory.onboardingRunListings.filter(
    (row) => row.hub_listing_id === listing.id
  )
  const runsById = new Map(inventory.onboardingRuns.map((run) => [run.id, run]))
  const allowedStartStatuses = new Set(["live", "completed"])
  for (const roster of rosterRows) {
    const run = runsById.get(roster.run_id)
    if (!run) flags.push("missing_onboarding_run")
    else if (listing.client_id && run.client_id !== listing.client_id) {
      flags.push("onboarding_client_mismatch")
    } else if (!allowedStartStatuses.has(run.status)) {
      flags.push("onboarding_run_not_live_or_completed")
    }
  }
  const validRosterRows = rosterRows.filter((roster) => {
    const run = runsById.get(roster.run_id)
    return (
      run !== undefined &&
      listing.client_id !== null &&
      run.client_id === listing.client_id &&
      allowedStartStatuses.has(run.status)
    )
  })
  const start = resolveStartEvidence(
    listing,
    setupDates,
    validRosterRows,
    runsById,
    client?.onboarding_date ?? null
  )
  flags.push(...start.flags)
  const launch = resolveLaunchEvidence(validRosterRows)
  flags.push(...launch.flags)
  if (
    launch.caseType === "revfactor_assisted_launch" &&
    launch.launchDate === null
  ) {
    flags.push("assisted_launch_date_required")
  }

  const firstManaged = start.date ? firstCompleteManagedMonth(start.date) : null
  const firstLaunchAnalysisMonth =
    launch.caseType === "revfactor_assisted_launch" && launch.launchDate
      ? addMonths(`${launch.launchDate}-01`, 1)
      : null
  const firstEligible =
    firstManaged && firstLaunchAnalysisMonth
      ? firstManaged > firstLaunchAnalysisMonth
        ? firstManaged
        : firstLaunchAnalysisMonth
      : (firstManaged ?? firstLaunchAnalysisMonth)
  const lastManaged = lastCompleteMonth(inventory.asOf)
  const eligibleMonths =
    firstEligible && firstEligible <= lastManaged
      ? monthsInclusive(firstEligible, lastManaged)
      : []
  const allReportPeriods = inventory.reportMetrics
    .map((metric) => metric.period)
    .filter((period) => period <= lastManaged)
    .sort()
  const reportCoverageStart = allReportPeriods[0] ?? null
  const reportCoverageEnd = allReportPeriods.at(-1) ?? null
  const supportedWindow = eligibleMonths.filter(
    (period) =>
      reportCoverageStart !== null &&
      reportCoverageEnd !== null &&
      period >= reportCoverageStart &&
      period <= reportCoverageEnd
  )
  const metrics = priceLabsId
    ? inventory.reportMetrics
        .filter(
          (metric) =>
            metric.listing_id === priceLabsId &&
            eligibleMonths.includes(metric.period)
        )
        .sort((left, right) => left.period.localeCompare(right.period))
    : []
  const metricPeriods = new Set(metrics.map((metric) => metric.period))
  if (supportedWindow.some((period) => !metricPeriods.has(period))) {
    flags.push("incomplete_managed_month_coverage")
  }

  const rawMonthly = metrics.map((metric) =>
    buildMonth(metric, start.date, start.confidence, launch.caseType)
  )
  flags.push(...rawMonthly.flatMap((month) => month.qaFlags))
  const monthly = rawMonthly.filter((month) => month.isValidCurrentEvidence)
  const comparableMonthCount = monthly.filter(
    (month) => month.marketAdjustedRevparLiftPp !== null
  ).length
  const periods = periodSummaries(monthly, firstEligible)
  for (const period of periods) {
    if (!period.available && period.label.startsWith("first_")) {
      flags.push(`${period.label}_unavailable`)
    }
  }
  const finalFlags = unique(flags).sort()

  return {
    hubListingId: listing.id,
    priceLabsListingId: priceLabsId,
    clientId: listing.client_id,
    clientName: client?.name ?? null,
    listingName: listing.name,
    caseType: launch.caseType,
    managementStartDate: start.date,
    managementStartConfidence: start.confidence,
    managementStartSource: start.source,
    launchDate: launch.launchDate,
    launchDatePrecision: launch.launchDate ? "month" : "unknown",
    eligibleManagedMonthCount: eligibleMonths.length,
    rawMetricRowCount: rawMonthly.length,
    supportedManagedMonthCount: monthly.length,
    comparableMonthCount,
    state: candidateState({
      confidence: start.confidence,
      caseType: launch.caseType,
      supportedMonthCount: monthly.length,
      comparableMonthCount,
      flags: finalFlags,
    }),
    qaFlags: finalFlags,
    monthly: rawMonthly,
    periods,
    rank: null,
    publicIdentityApproved: false,
  }
}

export function analyzeCaseStudyFoundation(
  inventory: CaseStudySourceInventory
): CaseStudyFoundationResult {
  if (inventory.reportRun.template_id !== inventory.expectedReportTemplateId) {
    throw new Error(
      "Report Builder run does not match the reviewed template ID"
    )
  }
  const sourceFingerprint = sha256(canonicalJson(inventory))
  const sharedFlags: string[] = []
  const freshnessDays = daysBetween(
    inventory.reportRun.completed_at.slice(0, 10),
    inventory.asOf
  )
  if (freshnessDays < 0) sharedFlags.push("report_after_as_of")
  if (freshnessDays > WINS_RULES_V1.maxStalenessDays)
    sharedFlags.push("stale_source")
  if (inventory.reportRun.error_reason)
    sharedFlags.push("report_run_has_errors")
  if (!inventory.reportRun.report_currency) sharedFlags.push("missing_currency")
  else if (inventory.reportRun.report_currency !== "USD") {
    sharedFlags.push("unsupported_currency")
  }

  const activeRevFactor = inventory.listings.filter(
    (listing) => listing.status === "active" && listing.client_id !== null
  )
  const selectedIds = inventory.selection
    ? new Set(inventory.selection.listingIds)
    : null
  const listings = selectedIds
    ? activeRevFactor.filter((listing) => selectedIds.has(listing.id))
    : activeRevFactor

  if (selectedIds) {
    const found = new Set(listings.map((listing) => listing.id))
    const missing = [...selectedIds].filter((id) => !found.has(id))
    if (missing.length > 0) {
      throw new Error(
        `Selection contains missing or non-RevFactor listings: ${missing.join(",")}`
      )
    }
  }

  const candidates = listings
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((listing) => buildCandidate(listing, inventory, sharedFlags))
  rankCandidates(candidates)

  const analyzed = candidates.filter(
    (candidate) => candidate.state === "Quantitatively supported"
  ).length
  const blocked = candidates.length - analyzed

  return {
    workflowVersion: CASE_STUDY_WORKFLOW_VERSION,
    projectRef: EXPECTED_REVFACTOR_PROJECT_REF,
    asOf: inventory.asOf,
    reportRun: inventory.reportRun,
    selection: inventory.selection,
    sourceFingerprint,
    counts: {
      sourceActiveRevFactorListings: activeRevFactor.length,
      selectedListings: candidates.length,
      analyzed,
      blocked,
      skipped: 0,
    },
    candidates,
  }
}
