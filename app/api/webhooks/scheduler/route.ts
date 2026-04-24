import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type SchedulerBookingPayload = {
  bookingId: string
  visitorName: string
  visitorEmail: string
  visitorPhone?: string | null
  visitorAirbnbLink?: string | null
  visitorNotes?: string | null
  date: string
  startTime: string
  endTime: string
  timezone?: string | null
  hostName?: string | null
  hostEmail?: string | null
  meetLink?: string | null
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const secret = process.env.SCHEDULER_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "SCHEDULER_WEBHOOK_SECRET not configured" },
      { status: 500 },
    )
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: SchedulerBookingPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.visitorName || !body.visitorEmail || !body.date || !body.startTime) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()

  // Idempotency: skip if a lead already exists for this booking
  if (body.bookingId) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("external_ref", `scheduler:${body.bookingId}`)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ success: true, leadId: existing.id, deduped: true })
    }
  }

  const scheduledDate = new Date(`${body.date}T${body.startTime}:00`).toISOString()

  const descriptionParts: string[] = []
  if (body.visitorAirbnbLink) descriptionParts.push(`Airbnb: ${body.visitorAirbnbLink}`)
  if (body.visitorNotes) descriptionParts.push(`Notes: ${body.visitorNotes}`)
  if (body.meetLink) descriptionParts.push(`Meet: ${body.meetLink}`)
  if (body.hostName) descriptionParts.push(`Host: ${body.hostName}`)
  const description = descriptionParts.join("\n") || null

  const stage = "meeting"

  const { data: maxOrder } = await supabase
    .from("leads")
    .select("sort_order")
    .eq("stage", stage)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()

  const sortOrder = (maxOrder?.sort_order ?? -1) + 1

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      project_name: body.visitorName,
      full_name: body.visitorName,
      email: body.visitorEmail,
      phone: body.visitorPhone || null,
      lead_source: "scheduler",
      scheduled_date: scheduledDate,
      timezone: body.timezone || null,
      description,
      stage,
      sort_order: sortOrder,
      external_ref: body.bookingId ? `scheduler:${body.bookingId}` : null,
    })
    .select("id")
    .single()

  if (error) {
    console.error("[webhook/scheduler] insert failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, leadId: lead.id })
}
