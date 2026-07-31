// Grant-style report model: every aggregate the workbook renders, computed in
// TypeScript from the same reservation populations. ExcelJS-free and pure so it
// can be unit-tested and reused by the route and a future monthly cron.

import type { ReservationExportRow } from "@/lib/reservations"
import {
  BOOKING_WINDOW_SEGMENTS,
  CANONICAL_CHANNELS,
  addMonthsClamped,
  computeKpis,
  computeListingBreakdown,
  computeSegments,
  groupByListing,
  listingNameOf,
  monthKey,
  normalizeChannel,
  pctChange,
  type CanonicalChannel,
  type ListingBreakdownRow,
  type Period,
  type ReportPeriods,
  type ReservationKpis,
  type SegmentStats,
} from "@/lib/reservations-export"

export type ChannelBreakdownRow = {
  channel: CanonicalChannel
  rawChannels: string[]
  listings: number
  rentalRevenue: number
  avgRevenue: number | null
  adr: number | null
  reservations: number
  nights: number
  segments: Record<(typeof BOOKING_WINDOW_SEGMENTS)[number], SegmentStats>
}

export type MonthlyPickupRow = {
  listingName: string
  listingId: string
  byMonth: Record<string, number>
  later: number
  total: number
}

export type MonthlyPickupModel = {
  months: string[] // YYYY-MM, ascending, capped at 12 months past asOf
  hasLater: boolean
  rows: MonthlyPickupRow[]
  totalsByMonth: Record<string, number>
  laterTotal: number
  grandTotal: number
  contributionByMonth: Record<string, number | null> // fraction of grand total
  laterContribution: number | null
}

export type ListingComparisonRow = {
  listingName: string
  listingId: string
  currentRevenue: number
  previousRevenue: number
  revenueChange: number
  revenueChangePct: number | null
  currentReservations: number
  previousReservations: number
  reservationsChange: number
  reservationsChangePct: number | null
  isNew: boolean // present now, absent in previous period
}

export type ChannelChartData = {
  listings: string[] // top listings by revenue (chart categories)
  channels: CanonicalChannel[] // channels present in the current population
  revenue: number[][] // [listing][channel]
  reservations: number[][] // [listing][channel]
}

export type OccupancyHorizon = {
  key: string
  label: string
  period: Period
}

export type OccupancyListingRow = {
  listingName: string
  listingId: string
  occupancyPct: (number | null)[] // fraction 0-1, aligned with horizons
  marketOccupancyPct: (number | null)[]
  rentalRevenue: (number | null)[] // revenue on the books per horizon
}

export type OccupancyReportModel = {
  source: string
  horizons: OccupancyHorizon[]
  rows: OccupancyListingRow[]
}

export type ReportWarning = { code: string; message: string }

export type GrantStyleReportModel = {
  periods: ReportPeriods
  currentKpis: ReservationKpis
  previousKpis: ReservationKpis
  lastYearKpis: ReservationKpis
  listingBreakdown: ListingBreakdownRow[]
  channelBreakdown: ChannelBreakdownRow[]
  monthlyPickup: MonthlyPickupModel
  listingComparisons: ListingComparisonRow[]
  channelChartData: ChannelChartData
  occupancy?: OccupancyReportModel
  warnings: ReportWarning[]
}

export const PICKUP_FUTURE_MONTHS_CAP = 12
export const CHART_TOP_LISTINGS = 10

export function computeChannelBreakdown(
  rows: ReservationExportRow[]
): ChannelBreakdownRow[] {
  const byChannel = new Map<CanonicalChannel, ReservationExportRow[]>()
  const rawByChannel = new Map<CanonicalChannel, Set<string>>()
  for (const row of rows) {
    const channel = normalizeChannel(row.booking_channel)
    const group = byChannel.get(channel)
    if (group) group.push(row)
    else byChannel.set(channel, [row])
    if (row.booking_channel) {
      const raws = rawByChannel.get(channel) ?? new Set<string>()
      raws.add(row.booking_channel)
      rawByChannel.set(channel, raws)
    }
  }

  const result: ChannelBreakdownRow[] = []
  for (const [channel, group] of byChannel) {
    const revenue = group.reduce((acc, r) => acc + (r.rental_revenue ?? 0), 0)
    const nights = group.reduce((acc, r) => acc + (r.number_of_days ?? 0), 0)
    result.push({
      channel,
      rawChannels: [...(rawByChannel.get(channel) ?? [])].sort(),
      listings: groupByListing(group).size,
      rentalRevenue: revenue,
      avgRevenue: group.length > 0 ? revenue / group.length : null,
      adr: nights > 0 ? revenue / nights : null,
      reservations: group.length,
      nights,
      segments: computeSegments(group, revenue),
    })
  }
  return result.sort((a, b) => b.rentalRevenue - a.rentalRevenue)
}

// Rental revenue of the reservations booked in the selected period, grouped by
// listing × check-in month. Months more than PICKUP_FUTURE_MONTHS_CAP past
// asOf collapse into "Later".
export function computeMonthlyPickup(
  rows: ReservationExportRow[],
  asOf: string
): MonthlyPickupModel {
  const capMonth = monthKey(addMonthsClamped(asOf, PICKUP_FUTURE_MONTHS_CAP))
  const monthSet = new Set<string>()
  let hasLater = false

  type Acc = { byMonth: Map<string, number>; later: number; total: number; name: string }
  const byListing = new Map<string, Acc>()
  for (const [key, group] of groupByListing(rows)) {
    const acc: Acc = { byMonth: new Map(), later: 0, total: 0, name: listingNameOf(group[0]) }
    for (const r of group) {
      const revenue = r.rental_revenue ?? 0
      if (!r.check_in) continue
      const month = monthKey(r.check_in)
      if (month > capMonth) {
        acc.later += revenue
        hasLater = true
      } else {
        acc.byMonth.set(month, (acc.byMonth.get(month) ?? 0) + revenue)
        monthSet.add(month)
      }
      acc.total += revenue
    }
    byListing.set(key, acc)
  }

  const months = [...monthSet].sort()
  const totalsByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]))
  let laterTotal = 0
  let grandTotal = 0
  const pickupRows: MonthlyPickupRow[] = []
  for (const [key, acc] of byListing) {
    const byMonth: Record<string, number> = {}
    for (const m of months) {
      const v = acc.byMonth.get(m) ?? 0
      byMonth[m] = v
      totalsByMonth[m] += v
    }
    laterTotal += acc.later
    grandTotal += acc.total
    pickupRows.push({
      listingName: acc.name,
      listingId: key,
      byMonth,
      later: acc.later,
      total: acc.total,
    })
  }
  pickupRows.sort((a, b) => a.listingName.localeCompare(b.listingName))

  return {
    months,
    hasLater,
    rows: pickupRows,
    totalsByMonth,
    laterTotal,
    grandTotal,
    contributionByMonth: Object.fromEntries(
      months.map((m) => [m, grandTotal > 0 ? totalsByMonth[m] / grandTotal : null])
    ),
    laterContribution: grandTotal > 0 ? laterTotal / grandTotal : null,
  }
}

// Full outer join of listings between the current and previous populations.
export function computeListingComparisons(
  current: ReservationExportRow[],
  previous: ReservationExportRow[]
): ListingComparisonRow[] {
  const currentBreakdown = computeListingBreakdown(current)
  const previousBreakdown = computeListingBreakdown(previous)
  const previousById = new Map(previousBreakdown.map((l) => [l.listingId, l]))
  const seen = new Set<string>()
  const rows: ListingComparisonRow[] = []

  for (const cur of currentBreakdown) {
    const prev = previousById.get(cur.listingId)
    seen.add(cur.listingId)
    rows.push({
      listingName: cur.listingName,
      listingId: cur.listingId,
      currentRevenue: cur.rentalRevenue,
      previousRevenue: prev?.rentalRevenue ?? 0,
      revenueChange: cur.rentalRevenue - (prev?.rentalRevenue ?? 0),
      revenueChangePct: pctChange(cur.rentalRevenue, prev?.rentalRevenue ?? 0),
      currentReservations: cur.reservations,
      previousReservations: prev?.reservations ?? 0,
      reservationsChange: cur.reservations - (prev?.reservations ?? 0),
      reservationsChangePct: pctChange(cur.reservations, prev?.reservations ?? 0),
      isNew: !prev,
    })
  }
  for (const prev of previousBreakdown) {
    if (seen.has(prev.listingId)) continue
    rows.push({
      listingName: prev.listingName,
      listingId: prev.listingId,
      currentRevenue: 0,
      previousRevenue: prev.rentalRevenue,
      revenueChange: -prev.rentalRevenue,
      revenueChangePct: pctChange(0, prev.rentalRevenue),
      currentReservations: 0,
      previousReservations: prev.reservations,
      reservationsChange: -prev.reservations,
      reservationsChangePct: pctChange(0, prev.reservations),
      isNew: false,
    })
  }
  // Current-period revenue descending, listings absent now sink to the bottom
  return rows.sort((a, b) => b.currentRevenue - a.currentRevenue)
}

export function computeChannelChartData(
  rows: ReservationExportRow[]
): ChannelChartData {
  const breakdown = computeListingBreakdown(rows).slice(0, CHART_TOP_LISTINGS)
  const channelsPresent = new Set(rows.map((r) => normalizeChannel(r.booking_channel)))
  const channels = CANONICAL_CHANNELS.filter((c) => channelsPresent.has(c))
  const byListing = groupByListing(rows)

  const revenue: number[][] = []
  const reservations: number[][] = []
  for (const listing of breakdown) {
    const group = byListing.get(listing.listingId) ?? []
    const revRow = channels.map(() => 0)
    const resRow = channels.map(() => 0)
    for (const r of group) {
      const idx = channels.indexOf(normalizeChannel(r.booking_channel))
      if (idx === -1) continue
      revRow[idx] += r.rental_revenue ?? 0
      resRow[idx] += 1
    }
    revenue.push(revRow)
    reservations.push(resRow)
  }
  return {
    listings: breakdown.map((l) => l.listingName),
    channels,
    revenue,
    reservations,
  }
}

const RECONCILE_EPSILON = 0.01

export function buildGrantStyleReportModel({
  currentReservations,
  previousReservations,
  lastYearReservations,
  occupancy,
  periods,
}: {
  currentReservations: ReservationExportRow[]
  previousReservations: ReservationExportRow[]
  lastYearReservations: ReservationExportRow[]
  occupancy?: OccupancyReportModel | null
  periods: ReportPeriods
}): GrantStyleReportModel {
  const currentKpis = computeKpis(currentReservations)
  const previousKpis = computeKpis(previousReservations)
  const lastYearKpis = computeKpis(lastYearReservations)
  const listingBreakdown = computeListingBreakdown(currentReservations)
  const channelBreakdown = computeChannelBreakdown(currentReservations)
  const monthlyPickup = computeMonthlyPickup(currentReservations, periods.asOf)
  const listingComparisons = computeListingComparisons(
    currentReservations,
    previousReservations
  )
  const channelChartData = computeChannelChartData(currentReservations)

  const warnings: ReportWarning[] = []
  if (currentKpis.currencies.length > 1) {
    warnings.push({
      code: "mixed_currencies",
      message: `Mixed currencies (${currentKpis.currencies.join(", ")}) — monetary totals mix currencies and are shown without a currency symbol`,
    })
  }
  if (currentKpis.negativeBookingWindows > 0) {
    warnings.push({
      code: "negative_booking_windows",
      message: `${currentKpis.negativeBookingWindows} reservation(s) had negative booking windows (post-check-in alterations); they are counted in the 0-14 segment`,
    })
  }
  if (!occupancy) {
    warnings.push({
      code: "occupancy_unavailable",
      message: "Occupancy data is not available for this report",
    })
  }

  // Reconciliation: every block must aggregate the same population.
  const checks: [string, number, number][] = [
    [
      "listing_revenue",
      listingBreakdown.reduce((a, l) => a + l.rentalRevenue, 0),
      currentKpis.rentalRevenue,
    ],
    [
      "channel_revenue",
      channelBreakdown.reduce((a, c) => a + c.rentalRevenue, 0),
      currentKpis.rentalRevenue,
    ],
    [
      "listing_reservations",
      listingBreakdown.reduce((a, l) => a + l.reservations, 0),
      currentKpis.reservations,
    ],
    [
      "channel_reservations",
      channelBreakdown.reduce((a, c) => a + c.reservations, 0),
      currentKpis.reservations,
    ],
    [
      "comparison_current_revenue",
      listingComparisons.reduce((a, l) => a + l.currentRevenue, 0),
      currentKpis.rentalRevenue,
    ],
    [
      "comparison_previous_revenue",
      listingComparisons.reduce((a, l) => a + l.previousRevenue, 0),
      previousKpis.rentalRevenue,
    ],
  ]
  for (const [code, actual, expected] of checks) {
    if (Math.abs(actual - expected) > RECONCILE_EPSILON) {
      warnings.push({
        code: `reconciliation_${code}`,
        message: `Internal reconciliation mismatch (${code}): ${actual} vs ${expected}`,
      })
    }
  }

  return {
    periods,
    currentKpis,
    previousKpis,
    lastYearKpis,
    listingBreakdown,
    channelBreakdown,
    monthlyPickup,
    listingComparisons,
    channelChartData,
    occupancy: occupancy ?? undefined,
    warnings,
  }
}
