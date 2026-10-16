"use server"

import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import type { PlanReservation } from "@/lib/pricing-plan"
import { pmsProviderLabel } from "@/lib/pms-connections"
import { pmsRowsToPlanReservations, type PmsHistoryRow } from "@/lib/pms-reservations"

export type PlanHistorySource = {
  kind: "pms" | "pricelabs"
  /** "Hospitable", "PriceLabs", … */
  label: string
  /** Latest fetch from the PMS (PMS source only). */
  syncedAt: string | null
}

type PlanDataResult =
  | { ok: true; today: string; reservations: PlanReservation[]; source: PlanHistorySource }
  | { ok: false; error: string }

const PMS_COLUMNS =
  "external_reservation_id, provider, platform, status, booked_date, check_in, check_out, nights, currency, accommodation_minor, source_fetched_at"

/**
 * Reservations for the Pricing plan / Goals tabs, loaded when the tab opens
 * (not with the page). Last ~13 months of stays plus everything on the books;
 * no guest names or confirmation codes.
 *
 * Source: the client's connected PMS (pms_reservations, rows exist only for a
 * staff-confirmed property mapping) when it has synced rows for this listing;
 * otherwise the PriceLabs reservations cache.
 */
export async function getPricingPlanDataAction(listingId: string): Promise<PlanDataResult> {
  if (!(await hasPermission("reservations", "view"))) {
    return { ok: false, error: "You don't have permission to view reservations." }
  }
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10)
  const supabase = await createClient()

  // pms_reservations.listing_id is set only while the mapping is confirmed
  // (trigger on client_pms_properties), so a listing match is the mapping check.
  const pms = await supabase
    .from("pms_reservations")
    .select(PMS_COLUMNS)
    .eq("listing_id", listingId)
    .in("status", ["accepted", "cancelled"])
    .gte("check_in", since)
    .order("check_in", { ascending: true })
    .limit(5000)
  // A missing table (migration not applied) or a read error falls back to PriceLabs.
  if (!pms.error && (pms.data ?? []).length > 0) {
    const rows = (pms.data ?? []) as PmsHistoryRow[]
    const syncedAt = rows.reduce<string | null>((a, r) => (!a || r.source_fetched_at > a ? r.source_fetched_at : a), null)
    return {
      ok: true,
      today,
      reservations: pmsRowsToPlanReservations(rows),
      source: { kind: "pms", label: pmsProviderLabel(rows[0].provider), syncedAt },
    }
  }

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
  return { ok: true, today, reservations, source: { kind: "pricelabs", label: "PriceLabs", syncedAt: null } }
}
