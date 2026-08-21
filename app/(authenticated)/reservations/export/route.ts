// GET /reservations/export — CSV of every reservation matching the browser's
// current filters (same searchParams contract as the /reservations page).
// Session-authenticated: pricelabs_reservations_cache is a matview with no
// RLS, so the reservations:view permission check here is the only data gate.

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import {
  ExportTooLargeError,
  getAllReservationsFiltered,
  RESERVATION_DATE_FIELDS,
  RESERVATION_SORT_FIELDS,
  type ReservationDateField,
  type ReservationSortField,
} from "@/lib/reservations"
import { reservationsToCsv } from "@/lib/reservations-csv"
import {
  isDateRangePresetKey,
  resolveDateRangePreset,
} from "@/lib/date-range-presets"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  if (!(await hasPermission("reservations", "view"))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  const sp = new URL(request.url).searchParams
  const get = (key: string) => sp.get(key) ?? undefined
  const clientId = UUID_RE.test(get("client") ?? "") ? get("client") : undefined
  const listingId = UUID_RE.test(get("listing") ?? "") ? get("listing") : undefined
  // Same contract as the page: a relative preset wins over absolute dates.
  const range = isDateRangePresetKey(get("range")) ? get("range") : undefined
  let from = DATE_RE.test(get("from") ?? "") ? get("from") : undefined
  let to = DATE_RE.test(get("to") ?? "") ? get("to") : undefined
  if (range && isDateRangePresetKey(range)) {
    const resolved = resolveDateRangePreset(range)
    from = resolved.from
    to = resolved.to
  }
  const dateField: ReservationDateField = RESERVATION_DATE_FIELDS.includes(
    get("df") as ReservationDateField
  )
    ? (get("df") as ReservationDateField)
    : "checkin"
  const search = get("q")?.trim() || undefined
  const sort = RESERVATION_SORT_FIELDS.includes(get("sort") as ReservationSortField)
    ? (get("sort") as ReservationSortField)
    : "booked_at"
  const dir = get("dir") === "asc" ? ("asc" as const) : ("desc" as const)

  const supabase = await createClient()
  let csv: string
  try {
    const rows = await getAllReservationsFiltered(supabase, {
      clientId,
      listingId,
      dateField,
      from,
      to,
      search,
      sort,
      dir,
    })
    csv = reservationsToCsv(rows)
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 })
    }
    console.error("Reservations CSV export failed:", error)
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }

  const today = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reservations-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  })
}
