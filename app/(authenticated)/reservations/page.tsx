import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import {
  getReservationsPage,
  RESERVATION_SORT_FIELDS,
  type ReservationSortField,
} from "@/lib/reservations"
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
  const from = DATE_RE.test(sp.from ?? "") ? sp.from : undefined
  const to = DATE_RE.test(sp.to ?? "") ? sp.to : undefined
  const search = sp.q?.trim() || undefined
  const sort = RESERVATION_SORT_FIELDS.includes(sp.sort as ReservationSortField)
    ? (sp.sort as ReservationSortField)
    : "booked_at"
  const dir = sp.dir === "asc" ? "asc" : "desc"
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)

  const supabase = await createClient()
  const [{ rows, count }, clientsRes, listingsRes] = await Promise.all([
    getReservationsPage(supabase, {
      clientId,
      listingId,
      from,
      to,
      search,
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    }),
    supabase.from("clients_basic").select("id, name").order("name"),
    supabase.from("listings").select("id, name, client_id").order("name"),
  ])

  return (
    <ReservationsView
      rows={rows}
      count={count}
      page={page}
      pageSize={PAGE_SIZE}
      filters={{ clientId, listingId, from, to, q: search, sort, dir }}
      clients={(clientsRes.data ?? []) as { id: string; name: string }[]}
      listings={
        (listingsRes.data ?? []) as {
          id: string
          name: string
          client_id: string
        }[]
      }
    />
  )
}
