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

export type ReservationsPageParams = {
  clientId?: string
  listingId?: string // hub listing UUID (listings.id)
  from?: string // check_in >= from (YYYY-MM-DD)
  to?: string // check_in <= to (YYYY-MM-DD)
  search?: string
  sort?: ReservationSortField
  dir?: "asc" | "desc"
  page: number // 1-based
  pageSize: number
}

export async function getReservationsPage(
  supabase: SupabaseClient,
  params: ReservationsPageParams
): Promise<{ rows: Reservation[]; count: number }> {
  const sort: ReservationSortField = RESERVATION_SORT_FIELDS.includes(
    params.sort as ReservationSortField
  )
    ? (params.sort as ReservationSortField)
    : "booked_at"
  const ascending = params.dir === "asc"

  let query = supabase
    .from(RESERVATIONS_TABLE)
    .select(RESERVATION_SELECT, { count: "exact" })
    .eq("booking_status", "booked")

  if (params.clientId) query = query.eq("client_id", params.clientId)
  if (params.listingId) query = query.eq("hub_listing_id", params.listingId)
  if (params.from) query = query.gte("check_in", params.from)
  if (params.to) query = query.lte("check_in", params.to)

  // PostgREST's or= syntax breaks on , ( ) " — strip them before interpolating
  const q = (params.search ?? "").replace(/[,()"%]/g, "").trim()
  if (q) {
    query = query.or(
      `guest_name.ilike.%${q}%,listing_name.ilike.%${q}%,channel_confirmation_code.ilike.%${q}%`
    )
  }

  const fromIdx = (params.page - 1) * params.pageSize
  const { data, count } = await query
    .order(sort, { ascending, nullsFirst: false })
    // stable tiebreaker so pagination doesn't skip/duplicate rows
    .order("row_key", { ascending: true })
    .range(fromIdx, fromIdx + params.pageSize - 1)

  return { rows: (data ?? []) as Reservation[], count: count ?? 0 }
}
