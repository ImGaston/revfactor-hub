import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { verifyApiKey } from "@/lib/api-auth.server"
import type { Lead } from "@/lib/types"

export const dynamic = "force-dynamic"

// This route never touches the user session: once the API key is verified it
// reads through the admin client, which bypasses RLS. The column projection
// below is therefore the entire security boundary — same model as the public
// adjustment shell in app/a/[token]/page.tsx. Never widen it to select("*").
//
// `description` in particular must stay out: the scheduler webhook flattens the
// host's name and email, the meet link, and free-text notes into that column.
const LEAD_COLUMNS = [
  "id",
  "created_at",
  "updated_at",
  "stage",
  "is_archived",
  "is_completed",
  "full_name",
  "email",
  "phone",
  "lead_source",
  "service_type",
  "location",
  "scheduled_date",
  "external_ref",
  "converted_at",
  "lost_at",
  "lost_reason",
  "assembly_client_id", // exposed only as the `is_won` boolean, never verbatim
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "msclkid",
  "fbclid",
  "referrer",
  "landing_page",
  "attribution_extra",
].join(", ")

// `select()` takes LEAD_COLUMNS as a runtime string, so supabase-js cannot infer
// the row shape. This type must stay in sync with the projection above.
type LeadRow = Pick<
  Lead,
  | "id"
  | "created_at"
  | "updated_at"
  | "stage"
  | "is_archived"
  | "is_completed"
  | "full_name"
  | "email"
  | "phone"
  | "lead_source"
  | "service_type"
  | "location"
  | "scheduled_date"
  | "converted_at"
  | "lost_at"
  | "lost_reason"
  | "assembly_client_id"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "utm_content"
  | "utm_term"
  | "gclid"
  | "msclkid"
  | "fbclid"
  | "referrer"
  | "landing_page"
  | "attribution_extra"
> & { external_ref: string | null }

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

/** Stages whose first entry becomes a timeline milestone. */
const MILESTONES = {
  meeting: "booked_call_at",
  proposal_sent: "proposal_sent_at",
  proposal_signed: "proposal_signed_at",
  retainer_paid: "retainer_paid_at",
} as const

const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60_000

// Best-effort, per serverless instance: the counter resets on cold start and is
// not shared across instances, so it is a courtesy guard rather than a hard
// global limit. Move to a DB counter or Upstash if a real limit is ever needed.
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(keyId: string): number | null {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(keyId)

  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(keyId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return null
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) {
    return Math.ceil((bucket.resetAt - now) / 1000)
  }
  return null
}

type StageEvent = {
  lead_id: string
  from_stage: string | null
  to_stage: string
  changed_at: string
}

type Cursor = { updatedAt: string; id: string }

function parseCursor(raw: string): Cursor | null {
  const separator = raw.lastIndexOf("|")
  if (separator === -1) return null
  const updatedAt = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  if (!updatedAt || !id || Number.isNaN(Date.parse(updatedAt))) return null
  return { updatedAt, id }
}

function error(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, { status, headers })
}

export async function GET(request: NextRequest) {
  const auth = await verifyApiKey(request, "leads:read")
  if (!auth.ok) return error(auth.error, auth.status)

  const retryAfter = isRateLimited(auth.context.keyId)
  if (retryAfter !== null) {
    return error("Rate limit exceeded", 429, { "Retry-After": String(retryAfter) })
  }

  const params = request.nextUrl.searchParams

  const updatedSince = params.get("updated_since")
  if (updatedSince && Number.isNaN(Date.parse(updatedSince))) {
    return error("updated_since must be a valid ISO 8601 timestamp", 400)
  }

  const rawLimit = params.get("limit")
  if (rawLimit && !/^\d+$/.test(rawLimit)) {
    return error("limit must be a positive integer", 400)
  }
  const limit = Math.min(Number(rawLimit) || DEFAULT_LIMIT, MAX_LIMIT)

  const rawCursor = params.get("cursor")
  const cursor = rawCursor ? parseCursor(rawCursor) : null
  if (rawCursor && !cursor) {
    return error("cursor is malformed", 400)
  }

  const includeEvents = params.get("include") === "events"

  const supabase = createAdminClient()

  // Keyset pagination, not offset: stable when leads are updated mid-walk.
  // Fetch limit+1 to learn whether another page exists without a count query.
  let query = supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1)

  if (updatedSince) query = query.gt("updated_at", updatedSince)
  if (cursor) {
    query = query.or(
      `updated_at.gt."${cursor.updatedAt}",and(updated_at.eq."${cursor.updatedAt}",id.gt.${cursor.id})`,
    )
  }

  const { data: rows, error: leadsError } = await query.returns<LeadRow[]>()
  if (leadsError) {
    console.error("[api/v1/leads] lead query failed:", leadsError.message)
    return error("Internal server error", 500)
  }

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const { data: events, error: eventsError } = await supabase
    .from("lead_stage_events")
    .select("lead_id, from_stage, to_stage, changed_at")
    .in(
      "lead_id",
      page.map((lead) => lead.id),
    )
    .order("changed_at", { ascending: true })

  if (eventsError) {
    console.error("[api/v1/leads] stage event query failed:", eventsError.message)
    return error("Internal server error", 500)
  }

  const eventsByLead = new Map<string, StageEvent[]>()
  for (const event of events as StageEvent[]) {
    const bucket = eventsByLead.get(event.lead_id)
    if (bucket) bucket.push(event)
    else eventsByLead.set(event.lead_id, [event])
  }

  const data = page.map((lead) => {
    const leadEvents = eventsByLead.get(lead.id) ?? []

    // Events arrive ascending, so the first hit per stage wins. A lead can move
    // backwards and re-enter a stage; the milestone is the first time it did.
    const timeline: Record<string, string | null> = {
      created_at: lead.created_at,
      booked_call_at: null,
      proposal_sent_at: null,
      proposal_signed_at: null,
      retainer_paid_at: null,
      converted_at: lead.converted_at,
      lost_at: lead.lost_at,
    }
    for (const event of leadEvents) {
      const milestone = MILESTONES[event.to_stage as keyof typeof MILESTONES]
      if (milestone && timeline[milestone] === null) timeline[milestone] = event.changed_at
    }

    // won takes precedence over lost, so the impossible "won and lost" reads won.
    const isWon = lead.assembly_client_id !== null
    const outcome = isWon ? "won" : lead.lost_at !== null ? "lost" : "open"

    return {
      id: lead.id,
      created_at: lead.created_at,
      updated_at: lead.updated_at,
      stage: lead.stage,
      outcome,
      is_won: isWon,
      lost_reason: lead.lost_reason,
      is_archived: lead.is_archived,
      is_completed: lead.is_completed,
      full_name: lead.full_name,
      email: lead.email,
      phone: lead.phone,
      lead_source: lead.lead_source,
      service_type: lead.service_type,
      location: lead.location,
      scheduled_date: lead.scheduled_date,
      external_ref: lead.external_ref,
      attribution: {
        utm_source: lead.utm_source,
        utm_medium: lead.utm_medium,
        utm_campaign: lead.utm_campaign,
        utm_content: lead.utm_content,
        utm_term: lead.utm_term,
        gclid: lead.gclid,
        msclkid: lead.msclkid,
        fbclid: lead.fbclid,
        referrer: lead.referrer,
        landing_page: lead.landing_page,
        extra: lead.attribution_extra,
      },
      timeline,
      ...(includeEvents && {
        events: leadEvents.map(({ from_stage, to_stage, changed_at }) => ({
          from_stage,
          to_stage,
          changed_at,
        })),
      }),
    }
  })

  const last = page.at(-1)
  return NextResponse.json({
    data,
    next_cursor: hasMore && last ? `${last.updated_at}|${last.id}` : null,
    has_more: hasMore,
  })
}
