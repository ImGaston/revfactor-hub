// Read helpers for PriceLabs reservations, backed by the
// pricelabs_reservations_cache materialized view (migration 054) — an hourly
// pg_cron snapshot of pricelabs_reservations_bq, whose BigQuery foreign table
// only postgres can query. The matview has no RLS — callers must gate with
// hasPermission("reservations","view") and this module keeps the projection
// narrow on purpose.
// Cancelled reservations are excluded everywhere by product decision, so the
// booking_status filter lives inside these helpers rather than in callers.

import type { SupabaseClient } from "@supabase/supabase-js"

export type Reservation = {
  row_key: string
  hub_listing_id: string | null
  client_id: string | null
  client_name: string | null
  listing_name: string | null
  guest_name: string | null
  booked_at: string | null
  check_in: string | null
  check_out: string | null
  number_of_days: number | null
  booking_window_days: number | null
  booking_channel: string | null
  rental_revenue: number | null
  total_cost: number | null
  currency: string | null
}

const RESERVATION_SELECT =
  "row_key, hub_listing_id, client_id, client_name, listing_name, guest_name, booked_at, check_in, check_out, number_of_days, booking_window_days, booking_channel, rental_revenue, total_cost, currency"

// Wider projection for the per-client Excel export. guest_name is omitted on
// purpose — the source always redacts it to "Hidden".
export type ReservationExportRow = {
  row_key: string
  listing_name: string | null
  listing_id: string | null
  check_in: string | null
  check_out: string | null
  booked_date: string | null
  number_of_days: number | null
  booking_window_days: number | null
  booking_channel: string | null
  rental_revenue: number | null
  cleaning_fees: number | null
  total_cost: number | null
  currency: string | null
  reservation_id: string | null
  pms: string | null
  channel_confirmation_code: string | null
}

const RESERVATION_EXPORT_SELECT =
  "row_key, listing_name, listing_id, check_in, check_out, booked_date, number_of_days, booking_window_days, booking_channel, rental_revenue, cleaning_fees, total_cost, currency, reservation_id, pms, channel_confirmation_code"

const RESERVATIONS_TABLE = "pricelabs_reservations_cache"

export const RESERVATION_SORT_FIELDS = [
  "booked_at",
  "check_in",
  "check_out",
  "number_of_days",
  "booking_window_days",
  "rental_revenue",
  "total_cost",
] as const

export type ReservationSortField = (typeof RESERVATION_SORT_FIELDS)[number]

// Which date column a from/to range filters on: the day the guest booked
// (booked_date) or the stay's check_in.
export const RESERVATION_DATE_FIELDS = ["booked", "checkin"] as const

export type ReservationDateField = (typeof RESERVATION_DATE_FIELDS)[number]

export async function getRecentReservationsByClient(
  supabase: SupabaseClient,
  clientId: string,
  limit = 10
): Promise<Reservation[]> {
  const { data } = await supabase
    .from(RESERVATIONS_TABLE)
    .select(RESERVATION_SELECT)
    .eq("booking_status", "booked")
    .eq("client_id", clientId)
    .order("booked_at", { ascending: false, nullsFirst: false })
    .limit(limit)
  return (data ?? []) as Reservation[]
}

export async function getRecentReservationsByListing(
  supabase: SupabaseClient,
  hubListingId: string,
  limit = 10
): Promise<Reservation[]> {
  const { data } = await supabase
    .from(RESERVATIONS_TABLE)
    .select(RESERVATION_SELECT)
    .eq("booking_status", "booked")
    .eq("hub_listing_id", hubListingId)
    .order("booked_at", { ascending: false, nullsFirst: false })
    .limit(limit)
  return (data ?? []) as Reservation[]
}

// Fetch every booked reservation for a client, paging past PostgREST's
// per-request row cap. Date-range filtering happens in memory downstream so
// comparison periods (which can overlap) reuse a single fetch.
export async function getAllReservationsByClient(
  supabase: SupabaseClient,
  clientId: string
): Promise<ReservationExportRow[]> {
  const CHUNK = 1000
  const rows: ReservationExportRow[] = []
  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await supabase
      .from(RESERVATIONS_TABLE)
      .select(RESERVATION_EXPORT_SELECT)
      .eq("booking_status", "booked")
      .eq("client_id", clientId)
      .order("check_in", { ascending: true, nullsFirst: false })
      .order("row_key", { ascending: true })
      .range(offset, offset + CHUNK - 1)
    if (error) throw new Error(`Failed to fetch reservations: ${error.message}`)
    rows.push(...((data ?? []) as ReservationExportRow[]))
    if ((data ?? []).length < CHUNK) break
  }
  return rows
}

export type ReservationsPageParams = {
  clientId?: string
  listingId?: string // hub listing UUID (listings.id)
  dateField?: ReservationDateField // which column from/to apply to; default checkin
  from?: string // dateField >= from (YYYY-MM-DD)
  to?: string // dateField <= to (YYYY-MM-DD)
  search?: string
  sort?: ReservationSortField
  dir?: "asc" | "desc"
  page: number // 1-based
  pageSize: number
}

// Shared filter chain for the /reservations browser and its CSV export —
// keep both reading the same population. PostgREST builders mutate in place
// and return `this`, so this applies filters by side effect; the loose
// structural param type avoids TS2589 from the builder's deep generics.
function applyReservationFilters(
  query: {
    eq: (column: string, value: string) => unknown
    gte: (column: string, value: string) => unknown
    lte: (column: string, value: string) => unknown
    or: (filters: string) => unknown
  },
  params: Omit<ReservationsPageParams, "page" | "pageSize">
): void {
  query.eq("booking_status", "booked")
  if (params.clientId) query.eq("client_id", params.clientId)
  if (params.listingId) query.eq("hub_listing_id", params.listingId)
  const dateColumn = params.dateField === "booked" ? "booked_date" : "check_in"
  if (params.from) query.gte(dateColumn, params.from)
  if (params.to) query.lte(dateColumn, params.to)

  // PostgREST's or= syntax breaks on , ( ) " — strip them before interpolating
  const q = (params.search ?? "").replace(/[,()"%]/g, "").trim()
  if (q) {
    query.or(
      `guest_name.ilike.%${q}%,listing_name.ilike.%${q}%,channel_confirmation_code.ilike.%${q}%`
    )
  }
}

function resolveSort(params: { sort?: ReservationSortField; dir?: "asc" | "desc" }) {
  const sort: ReservationSortField = RESERVATION_SORT_FIELDS.includes(
    params.sort as ReservationSortField
  )
    ? (params.sort as ReservationSortField)
    : "booked_at"
  return { sort, ascending: params.dir === "asc" }
}

export async function getReservationsPage(
  supabase: SupabaseClient,
  params: ReservationsPageParams
): Promise<{ rows: Reservation[]; count: number }> {
  const { sort, ascending } = resolveSort(params)

  const query = supabase
    .from(RESERVATIONS_TABLE)
    .select(RESERVATION_SELECT, { count: "exact" })
  applyReservationFilters(query, params)

  const fromIdx = (params.page - 1) * params.pageSize
  const { data, count } = await query
    .order(sort, { ascending, nullsFirst: false })
    // stable tiebreaker so pagination doesn't skip/duplicate rows
    .order("row_key", { ascending: true })
    .range(fromIdx, fromIdx + params.pageSize - 1)

  return { rows: (data ?? []) as Reservation[], count: count ?? 0 }
}

export class ExportTooLargeError extends Error {
  constructor(cap: number) {
    super(`Export exceeds the ${cap.toLocaleString("en-US")}-row cap`)
    this.name = "ExportTooLargeError"
  }
}

const EXPORT_ROW_CAP = 50_000

// Every reservation matching the browser's filters, in the browser's sort
// order, paged past PostgREST's per-request row cap. Feeds the CSV export.
export async function getAllReservationsFiltered(
  supabase: SupabaseClient,
  params: Omit<ReservationsPageParams, "page" | "pageSize">
): Promise<Reservation[]> {
  const { sort, ascending } = resolveSort(params)
  const CHUNK = 1000
  const rows: Reservation[] = []
  for (let offset = 0; ; offset += CHUNK) {
    if (rows.length > EXPORT_ROW_CAP) throw new ExportTooLargeError(EXPORT_ROW_CAP)
    const query = supabase.from(RESERVATIONS_TABLE).select(RESERVATION_SELECT)
    applyReservationFilters(query, params)
    const { data, error } = await query
      .order(sort, { ascending, nullsFirst: false })
      .order("row_key", { ascending: true })
      .range(offset, offset + CHUNK - 1)
    if (error) throw new Error(`Failed to fetch reservations: ${error.message}`)
    rows.push(...((data ?? []) as Reservation[]))
    if ((data ?? []).length < CHUNK) break
  }
  return rows
}

// Default stats window start for /reservations when no explicit range is
// set: 30 days back, as a YYYY-MM-DD date (UTC).
export function statsDefaultFrom(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 30)
  return d.toISOString().slice(0, 10)
}

export type ReservationStatsParams = {
  clientId?: string
  listingId?: string
  dateField: ReservationDateField
  from?: string // YYYY-MM-DD
  to?: string // YYYY-MM-DD
  search?: string
}

export type ReservationStats = {
  reservationCount: number
  totalNights: number
  avgBookingWindowDays: number | null
  rentalRevenueUsd: number
  adrUsd: number | null // nights-weighted: sum(revenue) / sum(nights)
  nonUsdCount: number // reservations excluded from the USD money figures
}

// Header aggregates for /reservations, computed DB-side by the
// reservation_page_stats function (migration 077) — same filters as
// getReservationsPage, one round trip instead of paging 28k rows.
export async function getReservationsStats(
  supabase: SupabaseClient,
  params: ReservationStatsParams
): Promise<ReservationStats> {
  // Match getReservationsPage's search sanitization so header and table
  // always describe the same population.
  const q = (params.search ?? "").replace(/[,()"%]/g, "").trim()
  const { data, error } = await supabase
    .rpc("reservation_page_stats", {
      p_client_id: params.clientId ?? null,
      p_listing_id: params.listingId ?? null,
      p_date_field: params.dateField,
      p_from: params.from ?? null,
      p_to: params.to ?? null,
      p_search: q || null,
    })
    .single()
  if (error) throw new Error(`Failed to fetch reservation stats: ${error.message}`)
  const row = data as {
    reservation_count: number
    total_nights: number
    avg_booking_window_days: number | null
    rental_revenue_usd: number
    adr_usd: number | null
    non_usd_count: number
  }
  return {
    reservationCount: Number(row.reservation_count ?? 0),
    totalNights: Number(row.total_nights ?? 0),
    avgBookingWindowDays:
      row.avg_booking_window_days == null
        ? null
        : Number(row.avg_booking_window_days),
    rentalRevenueUsd: Number(row.rental_revenue_usd ?? 0),
    adrUsd: row.adr_usd == null ? null : Number(row.adr_usd),
    nonUsdCount: Number(row.non_usd_count ?? 0),
  }
}
