// PMS reservations (client PMS connections, phase 2) — client+server-safe
// helpers: provider-neutral row shape, Hospitable normalization, sync windows
// and chunking, the Goals tab mapping and coverage text.
//
// Privacy: a normalized row never carries guest names, contacts, messages,
// door codes or confirmation codes. Normalizers build rows from an explicit
// allow-list of fields; nothing is spread from the provider object.

import type { PlanReservation } from "@/lib/pricing-plan"

// ---------------------------------------------------------------------------
// Row shape (provider-neutral; keyed on connection + external reservation id)
// ---------------------------------------------------------------------------

export const PMS_RESERVATION_STATUSES = [
  "accepted",
  "cancelled",
  "request",
  "inquiry",
  "checkpoint",
  "declined",
  "expired",
  "not_accepted",
  "unknown",
] as const

export type PmsReservationStatus = (typeof PMS_RESERVATION_STATUSES)[number]

/** Trimmed money line: amount in minor units and the provider category. Labels are dropped (they can hold ids). */
export type PmsMoneyLine = { amount: number; category: string | null }

export type PmsTrimmedFinancials = {
  currency: string | null
  accommodation: number | null
  revenue: number | null
  discounts: PmsMoneyLine[]
  guest_fees: PmsMoneyLine[]
  host_fees: PmsMoneyLine[]
  adjustments: PmsMoneyLine[]
  taxes: PmsMoneyLine[]
}

/** What an adapter returns for one reservation, before connection/listing scoping. */
export type NormalizedPmsReservation = {
  external_reservation_id: string
  external_property_id: string
  platform: string | null
  status: PmsReservationStatus
  booked_at: string | null
  booked_date: string | null
  check_in: string
  check_out: string | null
  nights: number | null
  guests: number | null
  currency: string | null
  /** Nightly rent after discounts, before channel/host fees (minor units). */
  accommodation_minor: number | null
  /** Sum of discounts as the provider signs them (normally ≤ 0). */
  discounts_minor: number | null
  cleaning_fee_minor: number | null
  /** Channel/host fees charged to the host, signed as returned (normally ≤ 0). */
  host_fees_minor: number | null
  /** Provider "host revenue" (payout basis), not a confirmed owner payout. */
  host_revenue_minor: number | null
  financials: PmsTrimmedFinancials | null
}

/** Columns written to public.pms_reservations (first_seen_at is left to the database). */
export type PmsReservationRow = NormalizedPmsReservation & {
  connection_id: string
  client_id: string
  provider: string
  listing_id: string | null
  source_fetched_at: string
}

export const PMS_RESERVATION_UPSERT_KEY = "connection_id,external_reservation_id"

// ---------------------------------------------------------------------------
// Small parsers
// ---------------------------------------------------------------------------

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

function validDay(day: string): boolean {
  if (!ISO_DAY.test(day)) return false
  const t = Date.parse(day + "T00:00:00Z")
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === day
}

/** Provider-local calendar day of a date or datetime (never shifted to UTC first). */
export function localDay(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  if (ISO_DAY.test(v)) return validDay(v) ? v : null
  if (!ISO_DATETIME.test(v)) return null
  const day = v.slice(0, 10)
  return validDay(day) ? day : null
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATETIME.test(value.trim())) return null
  const t = Date.parse(value.trim())
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

const minor = (value: unknown): number | null => (Number.isSafeInteger(value) ? (value as number) : null)

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  return v && v.length <= max ? v : null
}

function amountOf(item: unknown): number | null {
  if (!item || typeof item !== "object") return null
  return minor((item as { amount?: unknown }).amount)
}

function moneyLines(list: unknown): PmsMoneyLine[] | null {
  if (!Array.isArray(list)) return null
  const lines: PmsMoneyLine[] = []
  for (const item of list.slice(0, 25)) {
    const amount = amountOf(item)
    if (amount == null) continue
    lines.push({ amount, category: shortText((item as { category?: unknown }).category, 60) })
  }
  return lines
}

const sum = (lines: PmsMoneyLine[] | null): number | null =>
  lines == null ? null : lines.reduce((a, l) => a + l.amount, 0)

export function dayDiffIso(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000)
}

export function normalizeReservationStatus(value: unknown): PmsReservationStatus {
  if (typeof value !== "string") return "unknown"
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (v === "canceled") return "cancelled"
  if (v === "pending") return "request"
  return (PMS_RESERVATION_STATUSES as readonly string[]).includes(v) ? (v as PmsReservationStatus) : "unknown"
}

export function normalizePlatform(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim().toLowerCase().replace(/\s+/g, "_")
  return /^[a-z0-9_.-]{1,40}$/.test(v) ? v : null
}

// ---------------------------------------------------------------------------
// Hospitable → normalized row
// ---------------------------------------------------------------------------

type RawHospitableSide = Record<string, unknown> | null | undefined

/**
 * Map one Hospitable `GET /v2/reservations?include=financials,properties` row.
 * Returns null when the row can't be scoped or dated (caller fails closed).
 *
 * Money: integer minor units. Rent = host accommodation + signed host
 * discounts (verified to equal PriceLabs rental_revenue and Hospitable guest
 * accommodation in the Oct 2026 Spencer pilot); guest accommodation is the
 * fallback. Only ids, dates, counts, status, channel and amounts are read.
 */
export function normalizeHospitableReservation(
  row: unknown,
  requestedPropertyIds: readonly string[]
): NormalizedPmsReservation | null {
  if (!row || typeof row !== "object") return null
  const raw = row as Record<string, unknown>
  const id = shortText(raw.id, 100)
  if (!id) return null

  // Property scope: the included properties[] must name exactly one requested
  // property; without the include, only a single-property request is unambiguous.
  let propertyId: string | null = null
  if (Array.isArray(raw.properties)) {
    const ids = (raw.properties as { id?: unknown }[])
      .map((p) => (typeof p?.id === "string" ? p.id : null))
      .filter((p): p is string => Boolean(p))
    if (ids.length !== 1 || !requestedPropertyIds.includes(ids[0])) return null
    propertyId = ids[0]
  } else if (typeof raw.property_id === "string" && requestedPropertyIds.includes(raw.property_id)) {
    propertyId = raw.property_id
  } else if (requestedPropertyIds.length === 1) {
    propertyId = requestedPropertyIds[0]
  }
  if (!propertyId) return null

  const checkIn = localDay(raw.arrival_date) ?? localDay(raw.check_in)
  if (!checkIn) return null
  const checkOut = localDay(raw.departure_date) ?? localDay(raw.check_out)
  const nightsRaw = minor(raw.nights)
  const nights =
    nightsRaw != null && nightsRaw >= 0 && nightsRaw <= 1000
      ? nightsRaw
      : checkOut && dayDiffIso(checkIn, checkOut) >= 0 && dayDiffIso(checkIn, checkOut) <= 1000
        ? dayDiffIso(checkIn, checkOut)
        : null

  const statusSource =
    (raw.reservation_status as { current?: { category?: unknown } } | undefined)?.current?.category ?? raw.status

  const guestsRaw = raw.guests as Record<string, unknown> | undefined
  let guests: number | null = null
  if (guestsRaw && typeof guestsRaw === "object") {
    const total = minor(guestsRaw.total)
    const adults = minor(guestsRaw.adult_count)
    const children = minor(guestsRaw.child_count)
    guests = total ?? (adults != null ? adults + (children ?? 0) : null)
    if (guests != null && (guests < 0 || guests > 100)) guests = null
  }

  const fin = raw.financials && typeof raw.financials === "object" ? (raw.financials as Record<string, unknown>) : null
  const host: RawHospitableSide = fin?.host && typeof fin.host === "object" ? (fin.host as Record<string, unknown>) : null
  const guest: RawHospitableSide = fin?.guest && typeof fin.guest === "object" ? (fin.guest as Record<string, unknown>) : null
  const currencyRaw = fin?.currency
  const currency = typeof currencyRaw === "string" && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : null

  const discounts = moneyLines(host?.discounts) ?? moneyLines(guest?.discounts)
  const guestFees = moneyLines(host?.guest_fees) ?? moneyLines(guest?.guest_fees)
  const hostFees = moneyLines(host?.host_fees)
  const hostAccommodation = amountOf(host?.accommodation)
  const accommodation =
    hostAccommodation != null ? hostAccommodation + (sum(discounts) ?? 0) : amountOf(guest?.accommodation)
  const cleaningLines = Array.isArray(host?.guest_fees ?? guest?.guest_fees)
    ? ((host?.guest_fees ?? guest?.guest_fees) as { amount?: unknown; category?: unknown; label?: unknown }[]).filter(
        (f) => /clean/i.test(String(f?.category ?? "")) || /clean/i.test(String(f?.label ?? ""))
      )
    : null
  const cleaning = cleaningLines ? sum(moneyLines(cleaningLines)) : null

  const financials: PmsTrimmedFinancials | null = fin
    ? {
        currency,
        accommodation: hostAccommodation ?? amountOf(guest?.accommodation),
        revenue: amountOf(host?.revenue),
        discounts: discounts ?? [],
        guest_fees: guestFees ?? [],
        host_fees: hostFees ?? [],
        adjustments: moneyLines(host?.adjustments) ?? [],
        taxes: moneyLines(host?.taxes) ?? [],
      }
    : null

  return {
    external_reservation_id: id,
    external_property_id: propertyId,
    platform: normalizePlatform(raw.platform),
    status: normalizeReservationStatus(statusSource),
    booked_at: timestamp(raw.booking_date),
    booked_date: localDay(raw.booking_date),
    check_in: checkIn,
    check_out: checkOut,
    nights,
    guests,
    currency,
    accommodation_minor: accommodation,
    discounts_minor: sum(discounts),
    cleaning_fee_minor: cleaning,
    host_fees_minor: sum(hostFees),
    host_revenue_minor: amountOf(host?.revenue),
    financials,
  }
}

// ---------------------------------------------------------------------------
// Sync windows and chunks
// ---------------------------------------------------------------------------

/** Backfill starts here (check-in date). */
export const PMS_BACKFILL_START = "2024-01-01"
/** Both modes reach this many months past today (check-in date). */
export const PMS_FORWARD_MONTHS = 18
/** Incremental mode re-pulls check-ins from this many days ago. */
export const PMS_INCREMENTAL_LOOKBACK_DAYS = 30
/** Hospitable may limit date ranges: query at most this many months per request window. */
export const PMS_CHUNK_MONTHS = 3

export type PmsSyncMode = "backfill" | "incremental"
export type DateWindow = { start: string; end: string }

export function addDaysIso(day: string, k: number): string {
  const d = new Date(day + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + k)
  return d.toISOString().slice(0, 10)
}

/** Same day k months later, clamped to the month's last day. */
export function addMonthsIso(day: string, k: number): string {
  const [y, m, dd] = day.split("-").map(Number)
  const last = new Date(Date.UTC(y, m - 1 + k + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + k, Math.min(dd, last))).toISOString().slice(0, 10)
}

export function syncWindow(mode: PmsSyncMode, today: string): DateWindow {
  const end = addMonthsIso(today, PMS_FORWARD_MONTHS)
  return mode === "backfill"
    ? { start: PMS_BACKFILL_START, end }
    : { start: addDaysIso(today, -PMS_INCREMENTAL_LOOKBACK_DAYS), end }
}

/**
 * Split an inclusive window into contiguous, non-overlapping inclusive chunks
 * of at most `months` months each. Empty when start > end.
 */
export function planChunks(window: DateWindow, months = PMS_CHUNK_MONTHS): DateWindow[] {
  if (!validDay(window.start) || !validDay(window.end) || window.start > window.end) return []
  const chunks: DateWindow[] = []
  let start = window.start
  while (start <= window.end && chunks.length < 200) {
    const next = addMonthsIso(start, months)
    const end = addDaysIso(next, -1) < window.end ? addDaysIso(next, -1) : window.end
    chunks.push({ start, end })
    start = addDaysIso(end, 1)
  }
  return chunks
}

// ---------------------------------------------------------------------------
// Goals tab: pms_reservations → PlanReservation
// ---------------------------------------------------------------------------

export type PmsHistoryRow = {
  external_reservation_id: string
  provider: string
  platform: string | null
  status: string
  booked_date: string | null
  check_in: string
  check_out: string | null
  nights: number | null
  currency: string | null
  accommodation_minor: number | null
  source_fetched_at: string
}

/** Provider platform → the PriceLabs-style channel code buildHistory/planChannelKey understand. */
export function pmsPlatformChannel(platform: string | null): string {
  switch ((platform ?? "").toLowerCase()) {
    case "airbnb":
    case "airbnb_official":
      return "airbnb"
    case "homeaway":
    case "vrbo":
      return "vrbo"
    case "booking":
    case "bookingcom":
    case "booking.com":
    case "booking_com":
      return "bcom"
    case "direct":
    case "website":
    case "direct_booking":
      return "direct"
    case "manual":
    case "owner":
      return "manual"
    default:
      return "others"
  }
}

/** Minor units → major units using the currency's standard decimals (2 when unknown). */
export function minorToMajor(amount: number, currency: string | null): number {
  let digits = 2
  if (currency) {
    try {
      digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
    } catch {
      digits = 2
    }
  }
  return amount / 10 ** digits
}

/**
 * Same shape the PriceLabs loader produces. Accepted → "booked", cancelled →
 * "cancelled" (buildHistory counts it as a cancellation, never as revenue);
 * requests, inquiries and other non-bookings are dropped. Revenue is booked
 * nightly rent (accommodation after discounts, before channel fees). A
 * reservation synced through more than one connection (e.g. a renewed token)
 * is kept once, from the most recent fetch.
 */
export function pmsRowsToPlanReservations(rows: PmsHistoryRow[]): PlanReservation[] {
  const latest = new Map<string, PmsHistoryRow>()
  for (const r of rows) {
    const key = `${r.provider}:${r.external_reservation_id}`
    const seen = latest.get(key)
    if (!seen || r.source_fetched_at > seen.source_fetched_at) latest.set(key, r)
  }
  const out: PlanReservation[] = []
  for (const r of latest.values()) {
    const status = r.status === "accepted" ? "booked" : r.status === "cancelled" ? "cancelled" : null
    if (!status || !validDay(r.check_in)) continue
    const nights =
      r.nights ?? (r.check_out && validDay(r.check_out) ? Math.max(0, dayDiffIso(r.check_in, r.check_out)) : null)
    const window = r.booked_date && validDay(r.booked_date) ? dayDiffIso(r.booked_date, r.check_in) : null
    out.push({
      booked_date: r.booked_date && validDay(r.booked_date) ? r.booked_date : null,
      check_in: r.check_in,
      check_out: r.check_out,
      number_of_days: nights,
      booking_status: status,
      booking_channel: pmsPlatformChannel(r.platform),
      rental_revenue: r.accommodation_minor == null ? null : minorToMajor(Number(r.accommodation_minor), r.currency),
      booking_window_days: window,
    })
  }
  return out.sort((a, b) => (a.check_in < b.check_in ? -1 : a.check_in > b.check_in ? 1 : 0))
}

// ---------------------------------------------------------------------------
// Coverage text ("Jan 2024 – Apr 2028 · 412 stays")
// ---------------------------------------------------------------------------

function monthLabel(day: string): string {
  return new Date(day + "T00:00:00Z").toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
}

export function formatPmsCoverage(start: string | null, end: string | null, stays: number | null): string | null {
  if (!start || !end || !validDay(start) || !validDay(end)) return null
  const count = stays ?? 0
  return `${monthLabel(start)} – ${monthLabel(end)} · ${count.toLocaleString("en-US")} ${count === 1 ? "stay" : "stays"}`
}
