import "server-only"

// Server boundary for the capture-bot API (app/api/v1/support-*). Every
// function here runs through the service-role admin client after API-key
// auth, so RLS does not apply: the explicit column projections below ARE the
// security boundary. Never select("*"), never return internal notes
// (event bodies), verification details, or anything financial.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  planSupportCapture,
  type CaptureClient,
  type CaptureTicketSnapshot,
} from "@/lib/support-capture"
import { buildSupportDigest, type DigestTicket, type SupportDigest } from "@/lib/support-digest"
import {
  airbnbIdFromLink,
  dueState,
  isDoneNotTold,
  isStaleTriage,
  nextDueAt,
  openCommitments,
  effectiveDueAt,
  publicListingName,
  SUPPORT_ACTIVE_STATUSES,
  supportCaptureSchema,
  type SupportStatus,
  type SupportTicket,
} from "@/lib/support-tickets"

export type ApiResult = { status: number; body: unknown }

type ClientRef = {
  hub_client_id?: string
  assembly_client_id?: string
  assembly_company_id?: string
}

type ClientRow = CaptureClient & {
  name: string
  assembly_client_id: string | null
  assembly_company_id: string | null
}

const CLIENT_COLUMNS =
  "id, name, assembly_client_id, assembly_company_id, churn_risk, support_capture, support_hand_managed"

/** Hub client by Hub id, then Assembly client id, then Assembly company id. */
export async function resolveSupportClient(
  admin: SupabaseClient,
  ref: ClientRef
): Promise<{ client: ClientRow } | { status: 404 | 409; error: string }> {
  const attempts: [string, string | undefined][] = [
    ["id", ref.hub_client_id],
    ["assembly_client_id", ref.assembly_client_id],
    ["assembly_company_id", ref.assembly_company_id],
  ]
  for (const [column, value] of attempts) {
    if (!value) continue
    const { data, error } = await admin.from("clients").select(CLIENT_COLUMNS).eq(column, value).limit(2)
    if (error) throw new Error(`client lookup failed: ${error.message}`)
    if (data && data.length > 1)
      return { status: 409, error: `More than one Hub client matches ${column}; send hub_client_id` }
    if (data && data.length === 1) return { client: data[0] as ClientRow }
  }
  return { status: 404, error: "No Hub client matches this client reference" }
}

const SNAPSHOT_COLUMNS = `
  id, client_id, ticket_number, status, category, request_type, priority, priority_source,
  client_sentiment, money_at_stake, hand_managed, merged_into, last_client_message_at,
  last_team_message_at, client_chase_count, client_nudge_count, answer_check_verdict,
  support_ticket_commitments(
    id, ticket_id, description, due_at, due_source, rescheduled_to, status, made_by_name,
    made_at, source, closed_at, close_note, created_at, external_key
  )
`

async function loadSnapshots(
  admin: SupabaseClient,
  ids: string[]
): Promise<Map<string, CaptureTicketSnapshot>> {
  const snapshots = new Map<string, CaptureTicketSnapshot>()
  let pending = [...new Set(ids)]
  // Follow merge chains a few hops so events land on the ticket that stayed
  for (let hop = 0; pending.length && hop < 5; hop++) {
    const { data, error } = await admin.from("support_tickets").select(SNAPSHOT_COLUMNS).in("id", pending)
    if (error) throw new Error(`ticket lookup failed: ${error.message}`)
    const next: string[] = []
    for (const row of (data ?? []) as unknown as (Omit<CaptureTicketSnapshot, "commitments"> & {
      support_ticket_commitments: CaptureTicketSnapshot["commitments"]
    })[]) {
      snapshots.set(row.id, { ...row, commitments: row.support_ticket_commitments ?? [] })
      if (row.merged_into && !snapshots.has(row.merged_into)) next.push(row.merged_into)
    }
    pending = next
  }
  return snapshots
}

// ---------------------------------------------------------------------------
// POST /api/v1/support-captures
// ---------------------------------------------------------------------------

type RpcTicketResult = {
  external_key: string
  ticket_id: string
  ticket_number: number
  status: SupportStatus
  created: boolean
}
type RpcResult = {
  skipped: boolean
  capture_id: string | null
  tickets?: RpcTicketResult[]
  events?: { external_key: string; applied: boolean }[]
}

export async function runSupportCapture(
  admin: SupabaseClient,
  rawBody: unknown,
  now: Date = new Date()
): Promise<ApiResult> {
  const parsed = supportCaptureSchema.safeParse(rawBody)
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "Invalid capture payload",
        issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    }
  }
  const capture = parsed.data

  const resolved = await resolveSupportClient(admin, capture.client)
  if ("error" in resolved) return { status: resolved.status, body: { error: resolved.error } }
  const client = resolved.client

  const needsListings = capture.tickets.some((t) => t.property.scope === "listings")
  const duplicateIds = capture.tickets.flatMap((t) => (t.possible_duplicate_of ? [t.possible_duplicate_of] : []))
  const needsProfiles = capture.events.some((e) => e.type === "handoff")

  const [ledger, listings, messageTickets, snapshots, activeIds, rules, profiles, openAsks] = await Promise.all([
    admin
      .from("support_capture_messages")
      .select("id")
      .eq("source", capture.source)
      .eq("source_message_id", capture.source_message_id)
      .maybeSingle(),
    needsListings
      ? admin.from("listings").select("id, name, listing_id, airbnb_link, aliases, status").eq("client_id", client.id)
      : Promise.resolve({ data: [], error: null }),
    capture.reprocess
      ? admin
          .from("support_tickets")
          .select("id, ask_fingerprint, request_type")
          .eq("client_id", client.id)
          .eq("source", capture.source)
          .eq("source_message_id", capture.source_message_id)
      : Promise.resolve({ data: [], error: null }),
    loadSnapshots(admin, capture.events.map((e) => e.ticket_id)),
    duplicateIds.length
      ? admin
          .from("support_tickets")
          .select("id")
          .eq("client_id", client.id)
          .in("status", SUPPORT_ACTIVE_STATUSES)
          .in("id", duplicateIds)
      : Promise.resolve({ data: [], error: null }),
    admin.from("support_routing_rules").select("category, request_type, assignee_id, rank"),
    needsProfiles
      ? admin.from("profiles").select("id, full_name, email")
      : Promise.resolve({ data: [], error: null }),
    capture.tickets.length
      ? admin
          .from("support_tickets")
          .select("id, ask_fingerprint, external_key")
          .eq("client_id", client.id)
          .in("status", SUPPORT_ACTIVE_STATUSES)
          .not("ask_fingerprint", "is", null)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const result of [ledger, listings, messageTickets, activeIds, rules, profiles, openAsks]) {
    if (result.error) throw new Error(`capture context failed: ${result.error.message}`)
  }

  const planned = planSupportCapture({
    capture,
    client,
    listings: (listings.data ?? []) as never,
    alreadyProcessed: !!ledger.data,
    messageTickets: (messageTickets.data ?? []) as never,
    tickets: snapshots,
    activeTicketIds: new Set(((activeIds.data ?? []) as { id: string }[]).map((r) => r.id)),
    activeFingerprints: new Map(
      ((openAsks.data ?? []) as { id: string; ask_fingerprint: string; external_key: string | null }[]).map(
        (r) => [r.ask_fingerprint, { id: r.id, external_key: r.external_key }]
      )
    ),
    routingRules: (rules.data ?? []) as never,
    profiles: (profiles.data ?? []) as never,
    now,
  })

  if (planned.kind === "skipped") {
    return { status: 200, body: { message: { outcome: "skipped_processed", capture_id: ledger.data?.id ?? null } } }
  }

  const { plan } = planned
  let rpc: RpcResult = { skipped: false, capture_id: null, tickets: [], events: [] }
  if (plan.ledger || plan.tickets.length || plan.events.length) {
    const { data, error } = await admin.rpc("apply_support_capture", { p_plan: plan })
    if (error) throw new Error(`apply_support_capture failed: ${error.message}`)
    rpc = data as RpcResult
    if (rpc.skipped) {
      return { status: 200, body: { message: { outcome: "skipped_processed", capture_id: rpc.capture_id } } }
    }
  }

  const ticketsByKey = new Map((rpc.tickets ?? []).map((t) => [t.external_key, t]))
  const eventsByKey = new Map((rpc.events ?? []).map((e) => [e.external_key, e.applied]))

  return {
    status: 200,
    body: {
      message: {
        outcome: planned.outcome,
        capture_id: rpc.capture_id,
        ...(planned.outcome === "incomplete"
          ? { note: "Some items failed and the message was not marked processed. Fix them and resend the same payload." }
          : {}),
      },
      tickets: planned.tickets.map((r) => {
        if (r.outcome === "error") return { index: r.index, outcome: "error", error: r.error }
        const applied = r.external_key ? ticketsByKey.get(r.external_key) : undefined
        return {
          index: r.index,
          outcome: applied?.created && r.same_as_index === undefined ? "created" : "existing",
          ticket_id: applied?.ticket_id ?? null,
          ticket_number: applied?.ticket_number ?? null,
          status: applied?.status ?? r.status,
          triage_reasons: r.triage_reasons ?? [],
          property_validated: r.property_validated ?? false,
          unresolved_listings: r.unresolved_listings ?? [],
          possible_duplicate_of: r.possible_duplicate_of ?? null,
          ...(r.same_as_index !== undefined ? { same_as_index: r.same_as_index } : {}),
          ...(r.warnings ? { warnings: r.warnings } : {}),
        }
      }),
      events: planned.events.map((r) => {
        if (r.outcome === "error") return { index: r.index, outcome: "error", error: r.error }
        if (r.outcome === "skipped")
          return { index: r.index, outcome: "skipped", reason: r.reason, ticket_id: r.ticket_id }
        return {
          index: r.index,
          outcome: r.external_key && eventsByKey.get(r.external_key) ? "applied" : "duplicate",
          ticket_id: r.ticket_id,
          ...(r.redirected_from ? { redirected_from: r.redirected_from } : {}),
        }
      }),
    },
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/support-listings
// ---------------------------------------------------------------------------

/**
 * A client's listings so the bot can resolve nicknames to exact Hub listing
 * IDs (the Hub still validates membership). Public names only: the internal
 * suffix carries state and owner names.
 */
export async function listSupportClientListings(
  admin: SupabaseClient,
  ref: ClientRef
): Promise<ApiResult> {
  const resolved = await resolveSupportClient(admin, ref)
  if ("error" in resolved) return { status: resolved.status, body: { error: resolved.error } }
  const client = resolved.client

  const { data, error } = await admin
    .from("listings")
    .select("id, name, listing_id, airbnb_link, aliases, status")
    .eq("client_id", client.id)
    .order("name")
  if (error) throw new Error(`listing lookup failed: ${error.message}`)

  type Row = { id: string; name: string; listing_id: string | null; airbnb_link: string | null; aliases: string[] | null; status: string | null }
  return {
    status: 200,
    body: {
      client: {
        hub_client_id: client.id,
        name: client.name,
        capture_enabled: client.support_capture,
        hand_managed: client.support_hand_managed,
      },
      listings: ((data ?? []) as Row[]).map((l) => ({
        hub_listing_id: l.id,
        name: publicListingName(l.name),
        aliases: l.aliases ?? [],
        status: l.status,
        pricelabs_listing_id: l.listing_id,
        airbnb_id: airbnbIdFromLink(l.airbnb_link),
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/support-tickets
// ---------------------------------------------------------------------------

// Explicit projection — this is the boundary. No event bodies, notes,
// verification snapshot, dismiss notes, or client billing fields.
const LIST_COLUMNS = `
  id, ticket_number, external_key, status, category, request_type, summary, time_window,
  priority, client_sentiment, money_at_stake, hand_managed, possible_duplicate_of, merged_into,
  property_scope, property_validated_at, requested_at, last_client_message_at,
  last_team_message_at, sla_anchor_at, answered_at, client_told_live_at, backfilled,
  assignee_id, created_at, updated_at,
  clients!support_tickets_client_id_fkey(id, name, assembly_client_id, assembly_company_id, churn_risk),
  assignee:profiles!support_tickets_assignee_id_fkey(full_name, email),
  support_ticket_listings(listing_id, listings(id, name)),
  support_ticket_commitments(id, description, due_at, due_source, rescheduled_to, status, made_at, closed_at),
  adjustments!adjustments_support_ticket_id_fkey(id, type, status, controlled_at)
`

type ListRow = DigestTicket & {
  clients: {
    id: string
    name: string
    assembly_client_id: string | null
    assembly_company_id: string | null
    churn_risk: string | null
  } | null
}

export type ListParams = {
  statuses: SupportStatus[]
  client?: ClientRef
  updatedSince?: string
  limit: number
  cursor?: { updatedAt: string; id: string }
}

function toApiTicket(t: ListRow, now: Date) {
  const due = nextDueAt(t)
  return {
    id: t.id,
    ticket_number: t.ticket_number,
    external_key: t.external_key,
    status: t.status,
    category: t.category,
    request_type: t.request_type,
    summary: t.summary,
    time_window: t.time_window,
    priority: t.priority,
    client_sentiment: t.client_sentiment,
    hand_managed: t.hand_managed,
    possible_duplicate_of: t.possible_duplicate_of,
    merged_into: t.merged_into,
    client: t.clients
      ? {
          hub_client_id: t.clients.id,
          name: t.clients.name,
          assembly_client_id: t.clients.assembly_client_id,
          assembly_company_id: t.clients.assembly_company_id,
        }
      : null,
    property: {
      scope: t.property_scope,
      validated: !!t.property_validated_at,
      listings: (t.support_ticket_listings ?? []).map((l) => ({
        hub_listing_id: l.listing_id,
        name: l.listings?.name ?? null,
      })),
    },
    open_commitments: openCommitments(t.support_ticket_commitments).map((c) => ({
      id: c.id,
      description: c.description,
      due_at: c.due_at,
      working_due_at: effectiveDueAt(c),
      due_source: c.due_source,
    })),
    assignee: t.assignee ? { name: t.assignee.full_name, email: t.assignee.email } : null,
    requested_at: t.requested_at,
    last_client_message_at: t.last_client_message_at,
    last_team_message_at: t.last_team_message_at,
    answered_at: t.answered_at,
    client_told_live_at: t.client_told_live_at,
    next_due_at: due?.toISOString() ?? null,
    due_state: dueState(due, now),
    flags: {
      done_not_told: isDoneNotTold(t),
      stale_triage: isStaleTriage(t, now),
      possible_duplicate: !!t.possible_duplicate_of,
      backfilled: t.backfilled,
    },
    updated_at: t.updated_at,
  }
}

export async function listSupportTicketsForApi(
  admin: SupabaseClient,
  params: ListParams,
  now: Date = new Date()
): Promise<ApiResult> {
  let clientId: string | undefined
  if (params.client) {
    const resolved = await resolveSupportClient(admin, params.client)
    if ("error" in resolved) return { status: resolved.status, body: { error: resolved.error } }
    clientId = resolved.client.id
  }

  let query = admin
    .from("support_tickets")
    .select(LIST_COLUMNS)
    .in("status", params.statuses)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(params.limit + 1)
  if (clientId) query = query.eq("client_id", clientId)
  if (params.updatedSince) query = query.gt("updated_at", params.updatedSince)
  if (params.cursor) {
    query = query.or(
      `updated_at.gt."${params.cursor.updatedAt}",and(updated_at.eq."${params.cursor.updatedAt}",id.gt.${params.cursor.id})`
    )
  }

  const { data, error } = await query
  if (error) throw new Error(`support ticket list failed: ${error.message}`)
  const rows = (data ?? []) as unknown as ListRow[]
  const hasMore = rows.length > params.limit
  const page = hasMore ? rows.slice(0, params.limit) : rows
  const last = page[page.length - 1]

  return {
    status: 200,
    body: {
      data: page.map((t) => toApiTicket(t, now)),
      meta: {
        count: page.length,
        next_cursor: hasMore && last ? `${last.updated_at}|${last.id}` : null,
        generated_at: now.toISOString(),
      },
    },
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/support-tickets/digest
// ---------------------------------------------------------------------------

export async function buildSupportDigestForApi(
  admin: SupabaseClient,
  now: Date = new Date()
): Promise<SupportDigest> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const [tickets, commitments, events, backlog] = await Promise.all([
    admin.from("support_tickets").select(LIST_COLUMNS).in("status", SUPPORT_ACTIVE_STATUSES).limit(2000),
    admin
      .from("support_ticket_commitments")
      .select("status, due_at, rescheduled_to, closed_at, support_tickets!inner(backfilled)")
      .eq("status", "kept")
      .gte("closed_at", since),
    admin
      .from("support_ticket_events")
      .select("event_type, occurred_at")
      .in("event_type", ["verification_failed", "client_rejected"])
      .gte("occurred_at", since),
    admin
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .eq("backfilled", true)
      .eq("status", "resolved"),
  ])
  for (const result of [tickets, commitments, events, backlog]) {
    if (result.error) throw new Error(`support digest failed: ${result.error.message}`)
  }

  type CommitmentRow = {
    status: "kept"
    due_at: string
    rescheduled_to: string | null
    closed_at: string | null
    support_tickets: { backfilled: boolean } | { backfilled: boolean }[] | null
  }

  return buildSupportDigest({
    tickets: (tickets.data ?? []) as unknown as (SupportTicket & DigestTicket)[],
    closedCommitments: ((commitments.data ?? []) as unknown as CommitmentRow[]).map((c) => {
      const parent = Array.isArray(c.support_tickets) ? c.support_tickets[0] : c.support_tickets
      return {
        status: c.status,
        due_at: c.due_at,
        rescheduled_to: c.rescheduled_to,
        closed_at: c.closed_at,
        backfilled: parent?.backfilled ?? false,
      }
    }),
    events: (events.data ?? []) as { event_type: string; occurred_at: string }[],
    backlogCleared: backlog.count ?? 0,
    now,
  })
}
