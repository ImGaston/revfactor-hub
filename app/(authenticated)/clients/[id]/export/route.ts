// GET /clients/[id]/export — Grant-style per-client reservations report.
// Session-authenticated: pricelabs_reservations_cache is a matview with no RLS,
// so the reservations:view permission check here is the only data gate.
// Auth + HTTP validation + binary response only; the report itself comes from
// lib/reservations-report.service.ts (shared with any future cron).

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import type { ExportDateField } from "@/lib/reservations-export"
import {
  generateClientReservationsReport,
  ReportTooLargeError,
} from "@/lib/reservations-report.service"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_FIELDS: ExportDateField[] = ["booked_date", "check_in"]

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const url = new URL(request.url)
  const dateField = (url.searchParams.get("dateField") ?? "booked_date") as ExportDateField
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")
  const asOf =
    url.searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10)

  if (!DATE_FIELDS.includes(dateField)) {
    return NextResponse.json({ error: "Invalid dateField" }, { status: 400 })
  }
  if (!from || !to) {
    return NextResponse.json(
      { error: "Both from and to are required" },
      { status: 400 }
    )
  }
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || !DATE_RE.test(asOf)) {
    return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 })
  }
  if (from > to) {
    return NextResponse.json({ error: "from must be before to" }, { status: 400 })
  }

  if (!(await hasPermission("reservations", "view"))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", id)
    .single()
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  try {
    const report = await generateClientReservationsReport(supabase, {
      clientId: id,
      clientName: client.name,
      from,
      to,
      asOf,
      dateField,
    })
    return new NextResponse(new Uint8Array(report.buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${report.filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    if (error instanceof ReportTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 })
    }
    throw error
  }
}
