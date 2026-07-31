import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

type NullableMetric = number | null

export type AgentStudioPortfolioMonth = {
  period: string
  listingCount: number
  occupancyPct: NullableMetric
  marketOccupancyPct: NullableMetric
  occupancyStlyPct: NullableMetric
  marketOccupancyStlyPct: NullableMetric
  occupancyLyPct: NullableMetric
  marketOccupancyLyPct: NullableMetric
  rentalRevenue: NullableMetric
  rentalRevenueStly: NullableMetric
  rentalRevenueLy: NullableMetric
  medianBookingWindow: NullableMetric
  medianBookingWindowStly: NullableMetric
  medianBookingWindowLy: NullableMetric
}

export type AgentStudioListingMonth = Omit<
  AgentStudioPortfolioMonth,
  "listingCount"
> & {
  listingId: string
  listingName: string
  revpar: NullableMetric
  marketRevpar: NullableMetric
  revparIndex: NullableMetric
  marketPenetrationIndexPct: NullableMetric
}

export type AgentStudioPriceLabsReport = {
  runCompletedAt: string | null
  currency: string | null
  coverageStart: string
  coverageEnd: string
  portfolioMonthly: AgentStudioPortfolioMonth[]
  listingMonthly: AgentStudioListingMonth[]
  listingDetailLimited: boolean
}

type MetricRow = {
  listing_id: string
  period: string
  adjusted_occupancy_pct: unknown
  market_occupancy_pct: unknown
  adjusted_occupancy_stly_pct: unknown
  market_occupancy_stly_pct: unknown
  adjusted_occupancy_ly_pct: unknown
  market_occupancy_ly_pct: unknown
  rental_revenue: unknown
  rental_revenue_stly: unknown
  rental_revenue_ly: unknown
  median_booking_window: unknown
  median_booking_window_stly: unknown
  median_booking_window_ly: unknown
  rental_revpar: unknown
  market_revpar: unknown
  revpar_index: unknown
  market_penetration_index_pct: unknown
}

const METRIC_SELECT = `
  listing_id, period,
  adjusted_occupancy_pct, market_occupancy_pct,
  adjusted_occupancy_stly_pct, market_occupancy_stly_pct,
  adjusted_occupancy_ly_pct, market_occupancy_ly_pct,
  rental_revenue, rental_revenue_stly, rental_revenue_ly,
  median_booking_window, median_booking_window_stly,
  median_booking_window_ly, rental_revpar, market_revpar,
  revpar_index, market_penetration_index_pct
`

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function round(value: number, places = 1): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null)
  if (present.length === 0) return null
  return round(
    present.reduce((total, value) => total + value, 0) / present.length
  )
}

function sum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null)
  if (present.length === 0) return null
  return round(
    present.reduce((total, value) => total + value, 0),
    2
  )
}

function monthStart(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`
}

function addUtcMonths(value: Date, months: number): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1)
  )
}

function parseMonth(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }
  return value
}

function metric(value: MetricRow, key: keyof MetricRow): number | null {
  return numberOrNull(value[key])
}

function listingMonth(
  row: MetricRow,
  listingName: string
): AgentStudioListingMonth | null {
  const period = parseMonth(row.period)
  if (!period) return null
  return {
    listingId: row.listing_id,
    listingName,
    period,
    occupancyPct: metric(row, "adjusted_occupancy_pct"),
    marketOccupancyPct: metric(row, "market_occupancy_pct"),
    occupancyStlyPct: metric(row, "adjusted_occupancy_stly_pct"),
    marketOccupancyStlyPct: metric(row, "market_occupancy_stly_pct"),
    occupancyLyPct: metric(row, "adjusted_occupancy_ly_pct"),
    marketOccupancyLyPct: metric(row, "market_occupancy_ly_pct"),
    rentalRevenue: metric(row, "rental_revenue"),
    rentalRevenueStly: metric(row, "rental_revenue_stly"),
    rentalRevenueLy: metric(row, "rental_revenue_ly"),
    medianBookingWindow: metric(row, "median_booking_window"),
    medianBookingWindowStly: metric(row, "median_booking_window_stly"),
    medianBookingWindowLy: metric(row, "median_booking_window_ly"),
    revpar: metric(row, "rental_revpar"),
    marketRevpar: metric(row, "market_revpar"),
    revparIndex: metric(row, "revpar_index"),
    marketPenetrationIndexPct: metric(
      row,
      "market_penetration_index_pct"
    ),
  }
}

function portfolioMonths(
  rows: AgentStudioListingMonth[]
): AgentStudioPortfolioMonth[] {
  const grouped = new Map<string, AgentStudioListingMonth[]>()
  for (const row of rows) {
    const current = grouped.get(row.period) ?? []
    current.push(row)
    grouped.set(row.period, current)
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, months]) => ({
      period,
      listingCount: new Set(months.map((month) => month.listingId)).size,
      occupancyPct: average(months.map((month) => month.occupancyPct)),
      marketOccupancyPct: average(
        months.map((month) => month.marketOccupancyPct)
      ),
      occupancyStlyPct: average(
        months.map((month) => month.occupancyStlyPct)
      ),
      marketOccupancyStlyPct: average(
        months.map((month) => month.marketOccupancyStlyPct)
      ),
      occupancyLyPct: average(months.map((month) => month.occupancyLyPct)),
      marketOccupancyLyPct: average(
        months.map((month) => month.marketOccupancyLyPct)
      ),
      rentalRevenue: sum(months.map((month) => month.rentalRevenue)),
      rentalRevenueStly: sum(
        months.map((month) => month.rentalRevenueStly)
      ),
      rentalRevenueLy: sum(months.map((month) => month.rentalRevenueLy)),
      medianBookingWindow: average(
        months.map((month) => month.medianBookingWindow)
      ),
      medianBookingWindowStly: average(
        months.map((month) => month.medianBookingWindowStly)
      ),
      medianBookingWindowLy: average(
        months.map((month) => month.medianBookingWindowLy)
      ),
    }))
}

export async function loadAgentStudioPriceLabsReport(
  supabase: SupabaseClient,
  clientId: string,
  listings: Array<{ listingId: string | null; name: string }>,
  now = new Date()
): Promise<AgentStudioPriceLabsReport | null> {
  const { data: run, error: runError } = await supabase
    .from("report_runs")
    .select("id, completed_at, report_currency")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (runError || !run) return null

  const { data: mappedListings, error: mappedListingsError } = await supabase
    .from("report_listings")
    .select("listing_id, listing_name")
    .eq("hub_client_id", clientId)

  const listingNames = new Map<string, string>()
  for (const listing of listings) {
    if (listing.listingId) listingNames.set(listing.listingId, listing.name)
  }
  if (!mappedListingsError) {
    for (const listing of mappedListings ?? []) {
      if (typeof listing.listing_id === "string") {
        listingNames.set(
          listing.listing_id,
          listingNames.get(listing.listing_id) ??
            stringOrNull(listing.listing_name) ??
            listing.listing_id
        )
      }
    }
  }

  const listingIds = Array.from(listingNames.keys()).slice(0, 50)
  if (listingIds.length === 0) return null

  const { data: metrics, error: metricsError } = await supabase
    .from("report_metrics")
    .select(METRIC_SELECT)
    .eq("report_run_id", run.id)
    .in("listing_id", listingIds)
    .order("period", { ascending: true })
    .order("listing_id", { ascending: true })
  if (metricsError || !metrics?.length) return null

  const allListingMonths = (metrics as MetricRow[]).flatMap((row) => {
    const month = listingMonth(
      row,
      listingNames.get(row.listing_id) ?? row.listing_id
    )
    return month ? [month] : []
  })
  if (allListingMonths.length === 0) return null

  const coverageStart = allListingMonths[0].period
  const coverageEnd = allListingMonths[allListingMonths.length - 1].period
  const detailStart = monthStart(now)
  const detailEnd = monthStart(addUtcMonths(now, 3))
  const detailLimited = listingIds.length > 10
  const detailedListingIds = new Set(listingIds.slice(0, 10))
  const futureListingMonths = allListingMonths.filter(
    (month) =>
      month.period >= detailStart &&
      month.period <= detailEnd &&
      detailedListingIds.has(month.listingId)
  )

  return {
    runCompletedAt: stringOrNull(run.completed_at),
    currency: stringOrNull(run.report_currency),
    coverageStart,
    coverageEnd,
    portfolioMonthly: portfolioMonths(allListingMonths),
    listingMonthly: futureListingMonths,
    listingDetailLimited: detailLimited,
  }
}

export function parseFrozenPriceLabsReport(
  value: unknown
): AgentStudioPriceLabsReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const report = value as Record<string, unknown>
  const coverageStart = parseMonth(report.coverageStart)
  const coverageEnd = parseMonth(report.coverageEnd)
  if (!coverageStart || !coverageEnd) return null

  const portfolioMonthly = Array.isArray(report.portfolioMonthly)
    ? (report.portfolioMonthly as AgentStudioPortfolioMonth[])
    : []
  const listingMonthly = Array.isArray(report.listingMonthly)
    ? (report.listingMonthly as AgentStudioListingMonth[])
    : []

  return {
    runCompletedAt: stringOrNull(report.runCompletedAt),
    currency: stringOrNull(report.currency),
    coverageStart,
    coverageEnd,
    portfolioMonthly,
    listingMonthly,
    listingDetailLimited: Boolean(report.listingDetailLimited),
  }
}
