// Reusable Grant-style report service: fetch + model + workbook. The manual
// export route and any future monthly cron must both call this module.

import type { SupabaseClient } from "@supabase/supabase-js"
import { getAllReservationsByClient } from "@/lib/reservations"
import {
  addMonthsClamped,
  buildExportFilename,
  deriveReportPeriods,
  filterByPeriod,
  monthLabel,
  monthKey,
  type ExportDateField,
} from "@/lib/reservations-export"
import {
  buildGrantStyleReportModel,
  type GrantStyleReportModel,
  type OccupancyReportModel,
} from "@/lib/reservations-report-model"
import {
  CHANNEL_COLORS,
  renderStackedBarChartPng,
  type RenderedChart,
} from "@/lib/reservations-chart.server"
import { buildGrantStyleWorkbook } from "@/lib/reservations-workbook.server"

export const MAX_EXPORT_RESERVATIONS = 50_000

export class ReportTooLargeError extends Error {
  constructor(count: number) {
    super(
      `This client has more than ${MAX_EXPORT_RESERVATIONS.toLocaleString()} reservations (${count.toLocaleString()}); the export is capped to keep report generation reliable`
    )
    this.name = "ReportTooLargeError"
  }
}

// Occupancy provider backed by the PriceLabs Report Builder ingest
// (report_metrics, monthly granularity). There is no daily
// booked-nights/available-nights source in the hub, so horizons are the three
// calendar months starting at the as-of month — never derived from
// reservations. Returns null when the client has no metrics rows, which the
// workbook surfaces as a discreet "not available" note.
async function fetchOccupancyFromReportMetrics(
  supabase: SupabaseClient,
  clientId: string,
  asOf: string
): Promise<OccupancyReportModel | null> {
  const { data: run } = await supabase
    .from("report_runs")
    .select("id, completed_at")
    .eq("status", "completed")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (!run) return null

  const { data: listings } = await supabase
    .from("report_listings")
    .select("listing_id, listing_name")
    .eq("hub_client_id", clientId)
  if (!listings || listings.length === 0) return null

  const monthStarts = [0, 1, 2].map((offset) =>
    addMonthsClamped(`${monthKey(asOf)}-01`, offset)
  )
  const { data: metrics, error } = await supabase
    .from("report_metrics")
    .select("listing_id, period, adjusted_occupancy_pct, market_occupancy_pct, rental_revenue")
    .eq("report_run_id", run.id)
    .in("period", monthStarts)
    .in("listing_id", listings.map((l) => l.listing_id))
  if (error || !metrics || metrics.length === 0) return null

  const byListing = new Map<
    string,
    Map<string, { occ: number | null; market: number | null; revenue: number | null }>
  >()
  for (const m of metrics) {
    const period = String(m.period).slice(0, 10)
    const per = byListing.get(m.listing_id) ?? new Map()
    per.set(period, {
      occ: m.adjusted_occupancy_pct != null ? Number(m.adjusted_occupancy_pct) / 100 : null,
      market: m.market_occupancy_pct != null ? Number(m.market_occupancy_pct) / 100 : null,
      revenue: m.rental_revenue != null ? Number(m.rental_revenue) : null,
    })
    byListing.set(m.listing_id, per)
  }

  const horizonLabels = ["Current Month", "Next Month", "In 2 Months"]
  const horizons = monthStarts.map((start, i) => {
    const [y, mo] = start.split("-").map(Number)
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate()
    return {
      key: monthKey(start),
      label: `${horizonLabels[i]} (${monthLabel(monthKey(start))})`,
      period: { from: start, to: `${monthKey(start)}-${String(lastDay).padStart(2, "0")}` },
    }
  })

  const rows = listings
    .filter((l) => byListing.has(l.listing_id))
    .map((l) => {
      const per = byListing.get(l.listing_id)!
      return {
        listingName: l.listing_name ?? l.listing_id,
        listingId: l.listing_id,
        occupancyPct: monthStarts.map((s) => per.get(s)?.occ ?? null),
        marketOccupancyPct: monthStarts.map((s) => per.get(s)?.market ?? null),
        rentalRevenue: monthStarts.map((s) => per.get(s)?.revenue ?? null),
      }
    })
    .sort((a, b) => a.listingName.localeCompare(b.listingName))
  if (rows.length === 0) return null

  return {
    source: "PriceLabs Report Builder (report_metrics, monthly)",
    horizons,
    rows,
  }
}

export type GenerateReportOptions = {
  clientId: string
  clientName: string
  from: string
  to: string
  asOf: string
  dateField: ExportDateField
}

export type GeneratedReport = {
  buffer: Buffer
  filename: string
  model: GrantStyleReportModel
}

export async function generateClientReservationsReport(
  supabase: SupabaseClient,
  opts: GenerateReportOptions
): Promise<GeneratedReport> {
  const allRows = await getAllReservationsByClient(supabase, opts.clientId)
  if (allRows.length > MAX_EXPORT_RESERVATIONS) {
    throw new ReportTooLargeError(allRows.length)
  }

  const periods = deriveReportPeriods(opts.from, opts.to, opts.asOf)
  const currentReservations = filterByPeriod(allRows, opts.dateField, periods.current)
  const previousReservations = filterByPeriod(
    allRows,
    opts.dateField,
    periods.previousMonthAligned
  )
  const lastYearReservations = filterByPeriod(allRows, opts.dateField, periods.lastYear)

  const occupancy = await fetchOccupancyFromReportMetrics(
    supabase,
    opts.clientId,
    opts.asOf
  )

  const model = buildGrantStyleReportModel({
    currentReservations,
    previousReservations,
    lastYearReservations,
    occupancy,
    periods,
  })

  const chartData = model.channelChartData
  const currencySymbol = model.currentKpis.currencies.length > 1 ? "" : "$"
  // Chart rasterization needs sharp's native binding, which can be missing in
  // some runtimes — degrade to a chartless report instead of failing the export.
  let charts: { revenue: RenderedChart; reservations: RenderedChart } | null =
    null
  if (chartData.listings.length > 0) {
    try {
      charts = {
        revenue: await renderStackedBarChartPng({
          title: "Rental Revenue by Listing and Channel",
          categories: chartData.listings,
          series: chartData.channels.map((channel, i) => ({
            name: channel,
            color: CHANNEL_COLORS[channel],
            values: chartData.revenue.map((row) => row[i]),
          })),
          valueKind: "money",
          currencySymbol,
        }),
        reservations: await renderStackedBarChartPng({
          title: "Reservations by Listing and Channel",
          categories: chartData.listings,
          series: chartData.channels.map((channel, i) => ({
            name: channel,
            color: CHANNEL_COLORS[channel],
            values: chartData.reservations.map((row) => row[i]),
          })),
          valueKind: "count",
          currencySymbol,
        }),
      }
    } catch (error) {
      console.error("Chart rendering unavailable, exporting without charts:", error)
      model.warnings.push({
        code: "charts_unavailable",
        message: "Charts could not be rendered in this environment; the report was generated without them",
      })
    }
  }

  const buffer = await buildGrantStyleWorkbook({
    clientName: opts.clientName,
    dateField: opts.dateField,
    model,
    currentRows: currentReservations,
    previousRows: previousReservations,
    lastYearRows: lastYearReservations,
    charts,
  })

  return {
    buffer,
    filename: buildExportFilename(opts.clientName, opts.from, opts.to),
    model,
  }
}
