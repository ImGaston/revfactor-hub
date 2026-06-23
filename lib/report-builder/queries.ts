// Read helpers for the Report Builder data, consumed by the listing detail
// page. The dashboard always reads the latest *completed* run.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { ListingReport, ReportMetric } from "@/lib/types"

const METRIC_SELECT =
  "period, period_label, rental_revenue, rental_revenue_stly, rental_revenue_ly, rental_revenue_stly_yoy_pct, rental_adr, rental_adr_stly, rental_adr_ly, rental_adr_stly_yoy_pct, market_adr, market_adr_stly_yoy_pct, rental_revpar, market_revpar, revpar_index, adjusted_occupancy_pct, adjusted_occupancy_ly_pct, market_occupancy_pct, median_booking_window, median_booking_window_ly, market_median_booking_window, potential_revenue_open_inventory"

export async function getLatestCompletedRun(
  supabase: SupabaseClient
): Promise<{ id: string; completed_at: string | null } | null> {
  const { data } = await supabase
    .from("report_runs")
    .select("id, completed_at")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? { id: data.id as string, completed_at: data.completed_at as string | null } : null
}

/**
 * Fetch the latest-run monthly report for one PriceLabs listing id. Returns
 * null when there's no completed run, no matching listing, or no metrics.
 */
export async function getListingReport(
  supabase: SupabaseClient,
  priceLabsListingId: string | null
): Promise<ListingReport | null> {
  if (!priceLabsListingId) return null

  const run = await getLatestCompletedRun(supabase)
  if (!run) return null

  const [attrsRes, metricsRes] = await Promise.all([
    supabase
      .from("report_listings")
      .select("*")
      .eq("listing_id", priceLabsListingId)
      .maybeSingle(),
    supabase
      .from("report_metrics")
      .select(METRIC_SELECT)
      .eq("listing_id", priceLabsListingId)
      .eq("report_run_id", run.id)
      .order("period", { ascending: true }),
  ])

  if (!attrsRes.data) return null
  const metrics = (metricsRes.data ?? []) as ReportMetric[]
  if (metrics.length === 0) return null

  return {
    attributes: attrsRes.data as ListingReport["attributes"],
    metrics,
    runCompletedAt: run.completed_at,
  }
}
