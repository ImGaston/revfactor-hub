// Monthly Pacing data layer.
//
// Sibling of lib/pacing.ts (daily pacing), but built on the PriceLabs Report
// Builder monthly grid (`report_metrics`, grain = listing × month) instead of
// the daily reservations table. Each column is one calendar month; the bar
// height is the month's adjusted occupancy %, decomposed by *booking recency*:
//
//   pickup_7d     = occupancy_pickup_7d        (booked in last 7 days)
//   pickup_8_14d  = occupancy_pickup_8_14d     (booked 8–14 days ago)
//   pickup_15_30d = occupancy_pickup_15_30d    (booked 15–30 days ago)
//   older         = adjusted_occupancy_pct − (the three pickups)  (30+ days ago)
//
// All four are percentage points, so the stack sums to the month's occupancy —
// the monthly analogue of the daily chart's recency buckets. The portfolio
// value for a month is the simple average across the selected listings (no
// available-nights column to weight by; documented caveat).

import type { SupabaseClient } from "@supabase/supabase-js"
import { getLatestCompletedRun } from "@/lib/report-builder/queries"

export type MonthlyPacingBucket =
  | "pickup_7d"
  | "pickup_8_14d"
  | "pickup_15_30d"
  | "older"

export type MonthlyPacingPoint = {
  period: string // YYYY-MM-01
  pickup_7d: number
  pickup_8_14d: number
  pickup_15_30d: number
  older: number
  occupancy_pct: number // = sum of the four buckets, 0..100
  listing_count: number
}

export type MonthlyPacingHighlights = {
  total_listings: number
  avg_occupancy_pct: number
  avg_pickup_7d: number
  avg_pickup_8_14d: number
  avg_pickup_15_30d: number
}

export type MonthlyPacingData = {
  months: MonthlyPacingPoint[]
  highlights: MonthlyPacingHighlights
}

/** Listing-level attributes used for the chart filters. */
export type MonthlyPacingListing = {
  id: string // report_listings.listing_id
  name: string
  client_id: string | null
  client_name: string
  city: string
}

/** One (listing × month) metric row, the raw input to the aggregator. */
export type MonthlyPacingMetric = {
  listing_id: string
  period: string
  occupancy_pct: number | null
  pickup_7d: number | null
  pickup_8_14d: number | null
  pickup_15_30d: number | null
}

export type MonthlyPacingSource = {
  listings: MonthlyPacingListing[]
  metrics: MonthlyPacingMetric[]
  runCompletedAt: string | null
}

const METRIC_SELECT =
  "listing_id, period, adjusted_occupancy_pct, occupancy_pickup_7d, occupancy_pickup_8_14d, occupancy_pickup_15_30d"

// PostgREST caps every response at `db-max-rows` (1000 on this project), so a
// single request can't pull a full run (listings × ~12 months ≈ 2.8k rows).
// Ordering by period asc and taking the first 1000 silently drops the latest
// months — exactly where pickup lives. We page through with .range() instead.
const PAGE_SIZE = 1000

/** Page through report_metrics for one run, defeating the server row cap. */
async function fetchAllMetrics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  runId: string
): Promise<{ data: MetricRow[]; error: unknown }> {
  const out: MetricRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("report_metrics")
      .select(METRIC_SELECT)
      .eq("report_run_id", runId)
      // Stable total order (period, listing_id) so pages don't skip/repeat rows.
      .order("period", { ascending: true })
      .order("listing_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) return { data: [], error }
    const rows = (data as MetricRow[] | null) ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return { data: out, error: null }
}

type ListingRow = {
  listing_id: string
  listing_name: string | null
  city: string | null
  group_name: string | null
  hub_client_id: string | null
  clients: { name: string } | { name: string }[] | null
}

type MetricRow = {
  listing_id: string
  period: string
  adjusted_occupancy_pct: number | null
  occupancy_pickup_7d: number | null
  occupancy_pickup_8_14d: number | null
  occupancy_pickup_15_30d: number | null
}

/**
 * Fetch the monthly pacing source from the latest completed Report Builder run.
 * Returns empty arrays (not null) when there is no completed run yet so the
 * chart can render its own empty state.
 */
export async function getMonthlyPacingSource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>
): Promise<MonthlyPacingSource> {
  const run = await getLatestCompletedRun(supabase)
  if (!run) return { listings: [], metrics: [], runCompletedAt: null }

  const [listingsRes, metricsRes] = await Promise.all([
    // report_listings is one row per listing (well under the 1000 cap).
    supabase
      .from("report_listings")
      .select("listing_id, listing_name, city, group_name, hub_client_id, clients(name)"),
    fetchAllMetrics(supabase, run.id),
  ])

  // Never let a missing pickup column (migration 036), RLS gap, or join error
  // take down the dashboard — degrade to the empty state instead.
  if (listingsRes.error || metricsRes.error) {
    return { listings: [], metrics: [], runCompletedAt: run.completed_at }
  }

  const listings: MonthlyPacingListing[] = (
    (listingsRes.data as ListingRow[] | null) ?? []
  ).map((l) => {
    const client = Array.isArray(l.clients) ? l.clients[0] : l.clients
    return {
      id: l.listing_id,
      name: l.listing_name ?? l.listing_id,
      client_id: l.hub_client_id,
      client_name: client?.name ?? l.group_name ?? "Unassigned",
      city: l.city ?? "—",
    }
  })

  const metrics: MonthlyPacingMetric[] = (
    (metricsRes.data as MetricRow[] | null) ?? []
  ).map((m) => ({
    listing_id: m.listing_id,
    period: m.period,
    occupancy_pct: m.adjusted_occupancy_pct,
    pickup_7d: m.occupancy_pickup_7d,
    pickup_8_14d: m.occupancy_pickup_8_14d,
    pickup_15_30d: m.occupancy_pickup_15_30d,
  }))

  return { listings, metrics, runCompletedAt: run.completed_at }
}

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp0 = (n: number) => (n > 0 ? n : 0)

/**
 * Aggregate the source into one point per month, averaging across the selected
 * listings. Buckets are clamped at 0 (net-negative pickup from cancellations is
 * folded into `older`) so the stack stays clean and sums to the occupancy.
 */
export function aggregateMonthlyPacing(
  source: MonthlyPacingSource,
  listingIds: string[] | null
): MonthlyPacingData {
  const allow =
    listingIds && listingIds.length > 0 ? new Set(listingIds) : null
  const activeListingCount = allow
    ? source.listings.filter((l) => allow.has(l.id)).length
    : source.listings.length

  type Acc = {
    occ: number
    p7: number
    p814: number
    p1530: number
    count: number
  }
  const byPeriod = new Map<string, Acc>()

  for (const m of source.metrics) {
    if (allow && !allow.has(m.listing_id)) continue
    if (m.occupancy_pct === null) continue // no data for this listing-month
    const acc = byPeriod.get(m.period) ?? {
      occ: 0,
      p7: 0,
      p814: 0,
      p1530: 0,
      count: 0,
    }
    acc.occ += m.occupancy_pct
    acc.p7 += m.pickup_7d ?? 0
    acc.p814 += m.pickup_8_14d ?? 0
    acc.p1530 += m.pickup_15_30d ?? 0
    acc.count += 1
    byPeriod.set(m.period, acc)
  }

  const months: MonthlyPacingPoint[] = Array.from(byPeriod.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, acc]) => {
      const occ = acc.occ / acc.count
      const pickup_7d = clamp0(acc.p7 / acc.count)
      const pickup_8_14d = clamp0(acc.p814 / acc.count)
      const pickup_15_30d = clamp0(acc.p1530 / acc.count)
      const older = clamp0(occ - pickup_7d - pickup_8_14d - pickup_15_30d)
      const occupancy_pct = older + pickup_7d + pickup_8_14d + pickup_15_30d
      return {
        period,
        pickup_7d: round1(pickup_7d),
        pickup_8_14d: round1(pickup_8_14d),
        pickup_15_30d: round1(pickup_15_30d),
        older: round1(older),
        occupancy_pct: round1(occupancy_pct),
        listing_count: acc.count,
      }
    })

  const n = months.length || 1
  const highlights: MonthlyPacingHighlights = {
    total_listings: activeListingCount,
    avg_occupancy_pct: round1(
      months.reduce((s, m) => s + m.occupancy_pct, 0) / n
    ),
    avg_pickup_7d: round1(months.reduce((s, m) => s + m.pickup_7d, 0) / n),
    avg_pickup_8_14d: round1(
      months.reduce((s, m) => s + m.pickup_8_14d, 0) / n
    ),
    avg_pickup_15_30d: round1(
      months.reduce((s, m) => s + m.pickup_15_30d, 0) / n
    ),
  }

  return { months, highlights }
}
