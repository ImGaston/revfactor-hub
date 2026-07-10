import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hasAttribution, parseAttribution } from "@/lib/lead-attribution"

export const dynamic = "force-dynamic"

// Attribution fields are all optional and may arrive top-level or nested under
// `attribution` — existing landing-page callers are unaffected. `email` remains
// the only required field. See docs/webhook-pipeline-integration.md.
type NewLeadPayload = {
  email: string
  full_name?: string | null
  project_name?: string | null
  phone?: string | null
  lead_source?: string | null
  scheduled_date?: string | null
  timezone?: string | null
  location?: string | null
  description?: string | null
  external_ref?: string | null
  attribution?: Record<string, unknown> | null
  [key: string]: unknown
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "WEBHOOK_SECRET not configured" },
      { status: 500 },
    )
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: NewLeadPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { error: "A valid email is required" },
      { status: 400 },
    )
  }

  if (body.scheduled_date && Number.isNaN(Date.parse(body.scheduled_date))) {
    return NextResponse.json(
      { error: "scheduled_date must be a valid ISO 8601 date" },
      { status: 400 },
    )
  }

  const fullName = body.full_name?.trim() || null
  const projectName = body.project_name?.trim() || fullName || email

  const attribution = parseAttribution(body)

  const supabase = createAdminClient()

  // Idempotency: email-capture forms double-submit easily, so an active
  // (non-archived, non-completed) lead with the same email is reused.
  const { data: existing } = await supabase
    .from("leads")
    .select("id, utm_source")
    .ilike("email", email)
    .eq("is_archived", false)
    .eq("is_completed", false)
    .limit(1)
    .maybeSingle()

  if (existing) {
    // First touch wins, but only if there was a first touch: a double-submit
    // whose first request carried no UTMs would otherwise lose attribution.
    if (!existing.utm_source && hasAttribution(attribution)) {
      await supabase.from("leads").update(attribution).eq("id", existing.id)
    }
    return NextResponse.json(
      { success: true, lead_id: existing.id, deduped: true },
      { status: 200 },
    )
  }

  const stage = "inquiry"

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
      project_name: projectName,
      full_name: fullName,
      email,
      phone: body.phone?.trim() || null,
      lead_source: body.lead_source?.trim() || "landing_page",
      scheduled_date: body.scheduled_date || null,
      timezone: body.timezone?.trim() || null,
      location: body.location?.trim() || null,
      description: body.description?.trim() || null,
      stage,
      sort_order: sortOrder,
      service_type: null,
      created_by: null,
      external_ref: body.external_ref?.trim() || null,
      ...attribution,
    })
    .select("id")
    .single()

  if (error) {
    console.error("[webhook/new-lead] insert failed:", error.message)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  console.log("[webhook/new-lead] lead created:", lead.id)
  return NextResponse.json({ success: true, lead_id: lead.id }, { status: 201 })
}
