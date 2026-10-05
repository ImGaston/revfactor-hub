import "server-only"

// Hub-side reads for /support. Runs with the signed-in user's Supabase
// session, so row-level security (support:view) applies. The capture-bot API
// uses lib/support-tickets.server.ts (admin client) instead.

import type { SupabaseClient } from "@supabase/supabase-js"

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
}

export async function loadSupportQueue(
  supabase: SupabaseClient,
  now: Date
): Promise<SupportQueueData> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString()

  const [active, recentlyClosed, commitments, sentBack, rejected] = await Promise.all([
    supabase
      .from("support_tickets")
      .select(TICKET_COLUMNS)
      .in("status", SUPPORT_ACTIVE_STATUSES)
      .order("requested_at", { ascending: true })
      .limit(500),
    supabase
      .from("support_tickets")
      .select(TICKET_COLUMNS)
      .in("status", SUPPORT_CLOSED_STATUSES)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("support_ticket_commitments")
      .select("status, due_at, rescheduled_to, closed_at, support_tickets!inner(backfilled)")
      .eq("status", "kept")
      .gte("closed_at", since),
    supabase
      .from("support_ticket_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "verification_failed")
      .gte("occurred_at", since),
    supabase
      .from("support_ticket_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "client_rejected")
      .gte("occurred_at", since),
  ])
  for (const result of [active, recentlyClosed, commitments, sentBack, rejected]) {
    if (result.error) throw new Error(`support queue load failed: ${result.error.message}`)
  }

  type CommitmentRow = {
    due_at: string
    rescheduled_to: string | null
    closed_at: string | null
    support_tickets: { backfilled: boolean } | { backfilled: boolean }[] | null
  }

  return {
    tickets: [...(active.data ?? []), ...(recentlyClosed.data ?? [])] as unknown as SupportTicket[],
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
  // Never the draft text: the suggested answer stays on the server until the
  // team saves its own answer (lib/support-answers.server.ts owns that lock)
  const { data: ticketRow, error } = await supabase
    .from("support_tickets")
    .select(TICKET_COLUMNS)
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
