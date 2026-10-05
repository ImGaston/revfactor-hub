import "server-only"

// Hub-side reads for /support. Runs with the signed-in user's Supabase
// session, so row-level security (support:view) applies. The capture-bot API
// uses lib/support-tickets.server.ts (admin client) instead.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  SUPPORT_CLIENT_CLOSED_CAP,
  SUPPORT_RECENT_CLOSED_DAYS,
  SUPPORT_RECENT_CLOSED_LIMIT,
  buildSupportClientOptions,
  countOpenTicketsByClient,
  type SupportClientOption,
  type SupportQueueFilters,
} from "@/lib/support-queue"
import type { SupportTicket, SupportTicketEvent } from "@/lib/support-tickets"
import { SUPPORT_ACTIVE_STATUSES, SUPPORT_CLOSED_STATUSES } from "@/lib/support-tickets"

const DAY_MS = 86_400_000

// clients_basic (not clients): support users may not hold clients:view.
// Profiles, events, and adjustments have several paths to these tables, so
// every embed is FK-hinted.
const TICKET_COLUMNS = `
  id, ticket_number, client_id, property_scope, property_validated_at, category, request_type,
  summary, client_message, requested_by_name, requested_at, time_window, source, source_message_id,
  external_key, needs_attachment_review, status, priority, priority_source, client_sentiment,
  money_at_stake, hand_managed, assignee_id, possible_duplicate_of, merged_into,
  first_response_at, last_client_message_at, last_team_message_at, sla_anchor_at,
  client_chase_count, client_nudge_count, answer_summary, answered_at,
  answer_check_verdict, answer_check_asked, answer_check_replied, answer_check_gap, answer_check_at,
  client_told_live_at, client_acknowledged_at, verification, resolved_at, dismiss_reason, dismiss_note,
  backfilled, backfill_batch, ai_classification, created_at, updated_at,
  suggested_reply_generated_at:suggested_reply->>generated_at,
  clients:clients_basic(id, name),
  assignee:profiles!support_tickets_assignee_id_fkey(full_name, email),
  support_ticket_listings(listing_id, listings(id, name)),
  support_ticket_commitments(
    id, ticket_id, description, due_at, due_source, rescheduled_to, status, made_by_name,
    made_at, source, closed_at, close_note, created_at
  ),
  adjustments!adjustments_support_ticket_id_fkey(id, type, status, target_value, controlled_at, listings(name))
`

export type SupportQueueData = {
  tickets: SupportTicket[]
  closedCommitments: {
    status: "kept"
    due_at: string
    rescheduled_to: string | null
    closed_at: string | null
    backfilled: boolean
  }[]
  sentBack30d: number
  clientRejected30d: number
  /**
   * Which closed tickets were loaded: the last 30 days across every client
   * (`recent`), every closed ticket of the picked client (`client`, capped),
   * or none because the picked client's closed tickets are toggled off.
   */
  closedScope: "recent" | "client" | "hidden"
  /** Total closed tickets for the picked client; set only for `client`. */
  closedTotal: number | null
  /** Client picker: active clients plus any with open tickets, by name. */
  clientOptions: SupportClientOption[]
}

const NO_FILTER: SupportQueueFilters = { clientId: null, showClosed: false }

/**
 * The /support queue. With `filters.clientId` every query (tickets, promise
 * and sent-back stats) is scoped to that client, so the header follows the
 * pick; the client picker's open counts always span every client.
 */
export async function loadSupportQueue(
  supabase: SupabaseClient,
  now: Date,
  filters: SupportQueueFilters = NO_FILTER
): Promise<SupportQueueData> {
  const since = new Date(now.getTime() - SUPPORT_RECENT_CLOSED_DAYS * DAY_MS).toISOString()
  const { clientId } = filters
  const closedScope: SupportQueueData["closedScope"] = !clientId
    ? "recent"
    : filters.showClosed
      ? "client"
      : "hidden"

  let activeQuery = supabase
    .from("support_tickets")
    .select(TICKET_COLUMNS)
    .in("status", SUPPORT_ACTIVE_STATUSES)
  if (clientId) activeQuery = activeQuery.eq("client_id", clientId)

  // Closed tickets have no due date, so "newest" is the last change: the
  // close itself unless someone touched the ticket afterwards. Merged
  // duplicates are dismissed, so they land here too.
  const closedQuery = !clientId
    ? supabase
        .from("support_tickets")
        .select(TICKET_COLUMNS)
        .in("status", SUPPORT_CLOSED_STATUSES)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(SUPPORT_RECENT_CLOSED_LIMIT)
    : filters.showClosed
      ? supabase
          .from("support_tickets")
          .select(TICKET_COLUMNS, { count: "exact" })
          .eq("client_id", clientId)
          .in("status", SUPPORT_CLOSED_STATUSES)
          .order("updated_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(SUPPORT_CLIENT_CLOSED_CAP)
      : Promise.resolve({ data: [] as unknown[], error: null, count: null })

  // Stats scope: the parent ticket's client, through an inner embed
  let commitmentsQuery = supabase
    .from("support_ticket_commitments")
    .select(
      clientId
        ? "status, due_at, rescheduled_to, closed_at, support_tickets!inner(backfilled, client_id)"
        : "status, due_at, rescheduled_to, closed_at, support_tickets!inner(backfilled)"
    )
    .eq("status", "kept")
    .gte("closed_at", since)
  if (clientId) commitmentsQuery = commitmentsQuery.eq("support_tickets.client_id", clientId)

  const eventCount = (eventType: string) => {
    let query = supabase
      .from("support_ticket_events")
      .select(clientId ? "id, support_tickets!inner(client_id)" : "id", { count: "exact", head: true })
      .eq("event_type", eventType)
      .gte("occurred_at", since)
    if (clientId) query = query.eq("support_tickets.client_id", clientId)
    return query
  }

  const [active, closed, commitments, sentBack, rejected, openRows, clients] = await Promise.all([
    activeQuery.order("requested_at", { ascending: true }).limit(500),
    closedQuery,
    commitmentsQuery,
    eventCount("verification_failed"),
    eventCount("client_rejected"),
    // Picker counts: one narrow column across every client. Fine well below
    // PostgREST's max-rows (1000 open tickets); past that, count in an RPC.
    supabase.from("support_tickets").select("client_id").in("status", SUPPORT_ACTIVE_STATUSES),
    supabase.from("clients_basic").select("id, name, status").order("name"),
  ])
  for (const result of [active, closed, commitments, sentBack, rejected, openRows, clients]) {
    if (result.error) throw new Error(`support queue load failed: ${result.error.message}`)
  }

  type CommitmentRow = {
    due_at: string
    rescheduled_to: string | null
    closed_at: string | null
    support_tickets: { backfilled: boolean } | { backfilled: boolean }[] | null
  }

  const openCounts = countOpenTicketsByClient((openRows.data ?? []) as { client_id: string }[])

  return {
    tickets: [...(active.data ?? []), ...(closed.data ?? [])] as unknown as SupportTicket[],
    closedCommitments: ((commitments.data ?? []) as unknown as CommitmentRow[]).map((c) => {
      const parent = Array.isArray(c.support_tickets) ? c.support_tickets[0] : c.support_tickets
      return {
        status: "kept" as const,
        due_at: c.due_at,
        rescheduled_to: c.rescheduled_to,
        closed_at: c.closed_at,
        backfilled: parent?.backfilled ?? false,
      }
    }),
    sentBack30d: sentBack.count ?? 0,
    clientRejected30d: rejected.count ?? 0,
    closedScope,
    closedTotal: closedScope === "client" ? (closed.count ?? closed.data?.length ?? 0) : null,
    clientOptions: buildSupportClientOptions(
      (clients.data ?? []) as { id: string; name: string; status: string }[],
      openCounts,
      clientId
    ),
  }
}

export type SupportTicketDetailData = {
  ticket: SupportTicket
  events: (SupportTicketEvent & { from_ticket_number: number | null })[]
  mergedFrom: { id: string; ticket_number: number }[]
  possibleDuplicate: { id: string; ticket_number: number; summary: string; status: string } | null
  mergedInto: { id: string; ticket_number: number } | null
}

export async function loadSupportTicket(
  supabase: SupabaseClient,
  id: string
): Promise<SupportTicketDetailData | null> {
  const { data: ticketRow, error } = await supabase
    .from("support_tickets")
    .select(`${TICKET_COLUMNS}, suggested_reply`)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(`support ticket load failed: ${error.message}`)
  if (!ticketRow) return null
  const ticket = ticketRow as unknown as SupportTicket

  // A merged ticket's timeline stays on the source (append-only); read it too
  const { data: merged, error: mergedError } = await supabase
    .from("support_tickets")
    .select("id, ticket_number")
    .eq("merged_into", id)
  if (mergedError) throw new Error(`merged ticket load failed: ${mergedError.message}`)
  const mergedFrom = (merged ?? []) as { id: string; ticket_number: number }[]
  const numberById = new Map(mergedFrom.map((m) => [m.id, m.ticket_number]))

  const relatedIds = [ticket.possible_duplicate_of, ticket.merged_into].filter(
    (x): x is string => !!x
  )
  const [events, related] = await Promise.all([
    supabase
      .from("support_ticket_events")
      .select(
        "id, ticket_id, event_type, actor_id, actor_label, body, payload, occurred_at, actor:profiles!support_ticket_events_actor_id_fkey(full_name, email)"
      )
      .in("ticket_id", [id, ...mergedFrom.map((m) => m.id)])
      .order("occurred_at", { ascending: false })
      .limit(300),
    relatedIds.length
      ? supabase.from("support_tickets").select("id, ticket_number, summary, status").in("id", relatedIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (events.error) throw new Error(`support events load failed: ${events.error.message}`)
  if (related.error) throw new Error(`related ticket load failed: ${related.error.message}`)

  const relatedRows = (related.data ?? []) as {
    id: string
    ticket_number: number
    summary: string
    status: string
  }[]
  const find = (rowId: string | null) => relatedRows.find((r) => r.id === rowId) ?? null

  return {
    ticket,
    events: ((events.data ?? []) as unknown as SupportTicketEvent[]).map((e) => ({
      ...e,
      from_ticket_number: e.ticket_id === id ? null : (numberById.get(e.ticket_id) ?? null),
    })),
    mergedFrom,
    possibleDuplicate: find(ticket.possible_duplicate_of),
    mergedInto: find(ticket.merged_into),
  }
}
