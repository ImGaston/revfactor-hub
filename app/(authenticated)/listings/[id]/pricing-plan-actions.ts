"use server"

import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import type { PlanReservation } from "@/lib/pricing-plan"

/**
 * Reservations for the Pricing plan tab, loaded when the tab opens (not with
 * the page). Last ~13 months of stays plus everything on the books; no guest
 * names or confirmation codes.
 */
export async function getPricingPlanDataAction(
  listingId: string
): Promise<{ ok: true; today: string; reservations: PlanReservation[] } | { ok: false; error: string }> {
  if (!(await hasPermission("reservations", "view"))) {
    return { ok: false, error: "You don't have permission to view reservations." }
  }
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("pricelabs_reservations_cache")
    .select("booked_date, check_in, check_out, number_of_days, booking_status, booking_channel, rental_revenue, booking_window_days")
    .eq("hub_listing_id", listingId)
    .gte("check_in", since)
    .order("check_in", { ascending: true })
    .limit(3000)
  if (error) return { ok: false, error: error.message }
  const reservations = (data ?? []).map((r) => ({
    booked_date: (r.booked_date as string | null) ?? null,
    check_in: r.check_in as string,
    check_out: (r.check_out as string | null) ?? null,
    number_of_days: r.number_of_days == null ? null : Number(r.number_of_days),
    booking_status: (r.booking_status as string | null) ?? null,
    booking_channel: (r.booking_channel as string | null) ?? null,
    rental_revenue: r.rental_revenue == null ? null : Number(r.rental_revenue),
    booking_window_days: r.booking_window_days == null ? null : Number(r.booking_window_days),
  }))
  return { ok: true, today, reservations }
}
