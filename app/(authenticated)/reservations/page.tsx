import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import {
  getReservationsPage,
  getReservationsStats,
  statsDefaultFrom,
  RESERVATION_DATE_FIELDS,
  RESERVATION_SORT_FIELDS,
  type ReservationDateField,
  type ReservationSortField,
} from "@/lib/reservations"
import {
  isDateRangePresetKey,
  resolveDateRangePreset,
} from "@/lib/date-range-presets"
import type { ReservationView } from "@/lib/reservation-views"
import { ReservationsView } from "./reservations-view"

const PAGE_SIZE = 50
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const canView = await hasPermission("reservations", "view")
  if (!canView) redirect("/")

  const sp = await searchParams
  const clientId = UUID_RE.test(sp.client ?? "") ? sp.client : undefined
  const listingId = UUID_RE.test(sp.listing ?? "") ? sp.listing : undefined
  // A relative range preset (?range=last30) wins over absolute from/to and
  // resolves at request time, so saved views carrying one never go stale.
  const range = isDateRangePresetKey(sp.range) ? sp.range : undefined
  let from = DATE_RE.test(sp.from ?? "") ? sp.from : undefined
  let to = DATE_RE.test(sp.to ?? "") ? sp.to : undefined
  if (range) {
    const resolved = resolveDateRangePreset(range)
    from = resolved.from
    to = resolved.to
  }
  const dateField: ReservationDateField = RESERVATION_DATE_FIELDS.includes(
    sp.df as ReservationDateField
  )
    ? (sp.df as ReservationDateField)
    : "checkin"
  const search = sp.q?.trim() || undefined
  const sort = RESERVATION_SORT_FIELDS.includes(sp.sort as ReservationSortField)
    ? (sp.sort as ReservationSortField)
    : "booked_at"
  const dir = sp.dir === "asc" ? "asc" : "desc"
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)

  // Header stats follow the active filters; with no date range chosen they
  // default to the last 30 days by booked date (the table still shows all).
  const hasRange = Boolean(from || to)
  const statsFrom = hasRange ? from : statsDefaultFrom()
  const statsScope: "range" | "last30" = hasRange ? "range" : "last30"

  const supabase = await createClient()
  const [{ rows, count }, stats, clientsRes, listingsRes, viewsRes, userRes] =
    await Promise.all([
      getReservationsPage(supabase, {
        clientId,
        listingId,
        dateField,
        from,
        to,
        search,
        sort,
        dir,
        page,
        pageSize: PAGE_SIZE,
      }),
      getReservationsStats(supabase, {
        clientId,
        listingId,
        dateField: hasRange ? dateField : "booked",
        from: statsFrom,
        to: hasRange ? to : undefined,
        search,
      }),
      supabase.from("clients_basic").select("id, name").order("name"),
      supabase.from("listings").select("id, name, client_id").order("name"),
      supabase
        .from("reservation_views")
        .select("id, name, params, created_by")
        .order("created_at", { ascending: true }),
      supabase.auth.getUser(),
    ])

  return (
    <ReservationsView
      rows={rows}
      count={count}
      page={page}
      pageSize={PAGE_SIZE}
      stats={stats}
      statsScope={statsScope}
      filters={{
        clientId,
        listingId,
        dateField,
        range,
        // With a preset active the absolute dates are derived, not state —
        // the picker re-resolves them for display.
        from: range ? undefined : from,
        to: range ? undefined : to,
        q: search,
        sort,
        dir,
      }}
      clients={(clientsRes.data ?? []) as { id: string; name: string }[]}
      listings={
        (listingsRes.data ?? []) as {
          id: string
          name: string
          client_id: string
        }[]
      }
      views={(viewsRes.data ?? []) as ReservationView[]}
      currentUserId={userRes.data.user?.id ?? null}
    />
  )
}
