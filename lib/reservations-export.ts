// Pure computation helpers for the per-client reservations report:
// periods, medians, booking-window buckets, KPI aggregation, channel
// normalization and filenames. No ExcelJS here — the Grant-style model lives in
// lib/reservations-report-model.ts and rendering in lib/reservations-workbook.server.ts.

import type { ReservationExportRow } from "@/lib/reservations"

export type ExportDateField = "check_in" | "booked_date"

export type Period = { from: string; to: string }

export type ReportPeriods = {
  current: Period
  previousMonthAligned: Period
  lastYear: Period
  occupancyCurrentMonth: Period
  next60Days: Period
  next90Days: Period
  asOf: string
}

// booked_date carries 1970-01-01 as a missing-value sentinel upstream
export const EPOCH_SENTINEL = "1970-01-01"

export const BOOKING_WINDOW_SEGMENTS = [
  "0-14",
  "15-45",
  "46-60",
  "61-120",
  "120+",
] as const

export type BookingWindowSegment = (typeof BOOKING_WINDOW_SEGMENTS)[number]

export type SegmentStats = {
  count: number
  revenue: number
  revenuePct: number | null
}

export type ReservationKpis = {
  listings: number
  reservations: number
  nights: number
  rentalRevenue: number
  avgRevenuePerReservation: number | null
  adr: number | null
  bookingWindowMedian: number | null
  losMedian: number | null
  currencies: string[]
  negativeBookingWindows: number
}

export type ListingBreakdownRow = {
  listingName: string
  listingId: string
  rentalRevenue: number
  avgRevenue: number | null
  adr: number | null
  reservations: number
  nights: number
  segments: Record<BookingWindowSegment, SegmentStats>
}

// --- date string math (YYYY-MM-DD, no Date-object timezone traps) ---

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number)
  return { y, m, d }
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, "0")
}

function toIsoParts(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`
}

export function daysInMonth(year: number, month: number): number {
  // month is 1-based; day 0 of the next month = last day of this month
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return toIsoParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

// Shift by whole months keeping the day of month, clamped to the target
// month's length (2026-03-31 -1mo → 2026-02-28, 2024-03-31 -1mo → 2024-02-29).
export function addMonthsClamped(iso: string, months: number): string {
  const { y, m, d } = parts(iso)
  const total = y * 12 + (m - 1) + months
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  return toIsoParts(ty, tm, Math.min(d, daysInMonth(ty, tm)))
}

// Subtract one year clamping Feb 29 → Feb 28.
export function minusOneYearClamped(iso: string): string {
  const { y, m, d } = parts(iso)
  return toIsoParts(y - 1, m, Math.min(d, daysInMonth(y - 1, m)))
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7) // YYYY-MM
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

export function formatPeriodLabel(period: Period): string {
  const f = parts(period.from)
  const t = parts(period.to)
  const fmt = (p: { y: number; m: number; d: number }) => `${MONTH_NAMES[p.m - 1]} ${p.d}`
  if (f.y === t.y) return `${fmt(f)} – ${fmt(t)} '${String(f.y).slice(2)}`
  return `${fmt(f)} '${String(f.y).slice(2)} – ${fmt(t)} '${String(t.y).slice(2)}`
}

// The Grant-style report periods: previous period is the previous month
// aligned by day of month (Jul 1-28 → Jun 1-28), NOT the immediately
// preceding block of equal length.
export function deriveReportPeriods(
  from: string,
  to: string,
  asOf: string
): ReportPeriods {
  const { y, m } = parts(asOf)
  return {
    current: { from, to },
    previousMonthAligned: {
      from: addMonthsClamped(from, -1),
      to: addMonthsClamped(to, -1),
    },
    lastYear: { from: minusOneYearClamped(from), to: minusOneYearClamped(to) },
    occupancyCurrentMonth: {
      from: toIsoParts(y, m, 1),
      to: toIsoParts(y, m, daysInMonth(y, m)),
    },
    next60Days: { from: asOf, to: addDays(asOf, 59) },
    next90Days: { from: asOf, to: addDays(asOf, 89) },
    asOf,
  }
}

export function filterByPeriod(
  rows: ReservationExportRow[],
  field: ExportDateField,
  period: Period
): ReservationExportRow[] {
  return rows.filter((r) => {
    const value = r[field]
    if (!value || value === EPOCH_SENTINEL) return false
    return value >= period.from && value <= period.to
  })
}

// --- channel normalization ---

export const CANONICAL_CHANNELS = [
  "Airbnb",
  "Vrbo/Homeaway",
  "Booking.com",
  "Booking Engine/Direct Website",
  "Direct/Manual",
  "Marriott",
  "Partner",
  "Google",
  "Other",
] as const

export type CanonicalChannel = (typeof CANONICAL_CHANNELS)[number]

// Order matters: "direct website"/"bookingengine" must match before the
// generic "direct"/"manual" bucket.
const CHANNEL_MATCHERS: { channel: CanonicalChannel; test: RegExp }[] = [
  { channel: "Airbnb", test: /airbnb/ },
  { channel: "Vrbo/Homeaway", test: /vrbo|homeaway|home away/ },
  { channel: "Booking.com", test: /bcom|booking\.com|bookingcom/ },
  {
    channel: "Booking Engine/Direct Website",
    test: /booking ?engine|direct ?website|website/,
  },
  { channel: "Marriott", test: /marriott/ },
  { channel: "Partner", test: /partner/ },
  { channel: "Google", test: /google/ },
  { channel: "Direct/Manual", test: /direct|manual/ },
]

export function normalizeChannel(raw: string | null): CanonicalChannel {
  const value = (raw ?? "").trim().toLowerCase()
  if (!value) return "Other"
  for (const { channel, test } of CHANNEL_MATCHERS) {
    if (test.test(value)) return channel
  }
  return "Other"
}

// --- aggregation ---

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function bucketBookingWindow(days: number): BookingWindowSegment {
  // negative windows (post-check-in alterations) are clamped into 0-14
  if (days <= 14) return "0-14"
  if (days <= 45) return "15-45"
  if (days <= 60) return "46-60"
  if (days <= 120) return "61-120"
  return "120+"
}

export function listingKeyOf(r: ReservationExportRow): string {
  // Distinct listings by listing_id with a controlled fallback to listing_name
  return r.listing_id ?? r.listing_name ?? "(unknown)"
}

export function listingNameOf(r: ReservationExportRow): string {
  return r.listing_name ?? r.listing_id ?? "(unknown)"
}

export function computeKpis(rows: ReservationExportRow[]): ReservationKpis {
  const listings = new Set(rows.map(listingKeyOf))
  const nights = rows.reduce((acc, r) => acc + (r.number_of_days ?? 0), 0)
  const rentalRevenue = rows.reduce((acc, r) => acc + (r.rental_revenue ?? 0), 0)
  const bookingWindows = rows
    .filter((r) => r.booking_window_days != null)
    .map((r) => Math.max(0, r.booking_window_days as number))
  const losValues = rows
    .filter((r) => r.number_of_days != null)
    .map((r) => r.number_of_days as number)
  return {
    listings: listings.size,
    reservations: rows.length,
    nights,
    rentalRevenue,
    avgRevenuePerReservation: rows.length > 0 ? rentalRevenue / rows.length : null,
    adr: nights > 0 ? rentalRevenue / nights : null,
    bookingWindowMedian: median(bookingWindows),
    losMedian: median(losValues),
    currencies: [...new Set(rows.map((r) => r.currency).filter(Boolean))] as string[],
    negativeBookingWindows: rows.filter(
      (r) => r.booking_window_days != null && (r.booking_window_days as number) < 0
    ).length,
  }
}

export function computeSegments(
  rows: ReservationExportRow[],
  groupRevenue: number
): Record<BookingWindowSegment, SegmentStats> {
  const acc = Object.fromEntries(
    BOOKING_WINDOW_SEGMENTS.map((s) => [s, { count: 0, revenue: 0 }])
  ) as Record<BookingWindowSegment, { count: number; revenue: number }>
  for (const r of rows) {
    if (r.booking_window_days == null) continue
    const segment = bucketBookingWindow(Math.max(0, r.booking_window_days))
    acc[segment].count += 1
    acc[segment].revenue += r.rental_revenue ?? 0
  }
  return Object.fromEntries(
    BOOKING_WINDOW_SEGMENTS.map((s) => [
      s,
      {
        count: acc[s].count,
        revenue: acc[s].revenue,
        revenuePct: groupRevenue > 0 ? acc[s].revenue / groupRevenue : null,
      },
    ])
  ) as Record<BookingWindowSegment, SegmentStats>
}

export function groupByListing(
  rows: ReservationExportRow[]
): Map<string, ReservationExportRow[]> {
  const byListing = new Map<string, ReservationExportRow[]>()
  for (const row of rows) {
    const key = listingKeyOf(row)
    const group = byListing.get(key)
    if (group) group.push(row)
    else byListing.set(key, [row])
  }
  return byListing
}

export function computeListingBreakdown(
  rows: ReservationExportRow[]
): ListingBreakdownRow[] {
  const result: ListingBreakdownRow[] = []
  for (const [key, group] of groupByListing(rows)) {
    const revenue = group.reduce((acc, r) => acc + (r.rental_revenue ?? 0), 0)
    const nights = group.reduce((acc, r) => acc + (r.number_of_days ?? 0), 0)
    result.push({
      listingName: listingNameOf(group[0]),
      listingId: key,
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

// Fractional change: (current - previous) / |previous|; null when the base is
// zero or unknown so a new listing renders as an empty cell, never #VALUE!.
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null
  return (current - previous) / Math.abs(previous)
}

// --- filename ---

export function sanitizeFilenamePart(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
}

export function buildExportFilename(
  clientName: string,
  from?: string | null,
  to?: string | null
): string {
  const client = sanitizeFilenamePart(clientName) || "Client"
  const period = from && to ? `${from}_${to}` : "All"
  return `Reservations_${client}_${period}.xlsx`
}
