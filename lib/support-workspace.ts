// Support workspace — the sidebar's queue views and search. Client-safe and
// pure; the views reuse the queue's own bucketing so the sidebar, the stats,
// and the By client groups never disagree.

import type { SupportRecentFilter } from "@/lib/support-queue"
import { bucketSupportTickets, type SupportTicket } from "@/lib/support-tickets"

// ---------------------------------------------------------------------------
// Queue views (the workspace sidebar)
// ---------------------------------------------------------------------------

export const SUPPORT_STATUS_VIEWS = [
  { key: "triage", label: "Needs triage", tone: "warning" },
  { key: "overdue", label: "Overdue", tone: "danger" },
  { key: "verify", label: "To verify" },
  { key: "onUs", label: "On us" },
  { key: "onClient", label: "On the client" },
  { key: "mine", label: "Mine" },
  { key: "checkIns", label: "Check-ins" },
  { key: "closed", label: "Closed (30 days)" },
] as const

export type SupportStatusView = (typeof SUPPORT_STATUS_VIEWS)[number]["key"]

export function isStatusView(value: string | null | undefined): value is SupportStatusView {
  return SUPPORT_STATUS_VIEWS.some((v) => v.key === value)
}

/** Tickets per view, in the queue's own order (urgency, then due). */
export function statusViews(
  tickets: SupportTicket[],
  currentUserId: string | null,
  now: Date = new Date()
): Record<SupportStatusView, SupportTicket[]> {
  const q = bucketSupportTickets(tickets, now)
  const active = [...q.overdue, ...q.triage, ...q.onUs, ...q.verify, ...q.onClient]
  return {
    triage: q.triage,
    overdue: q.overdue,
    verify: q.verify,
    onUs: q.onUs,
    onClient: q.onClient,
    mine: currentUserId ? active.filter((t) => t.assignee_id === currentUserId) : [],
    checkIns: active.filter((t) => t.request_type === "check_in"),
    closed: q.closed,
  }
}

/** First view with tickets, so the sidebar opens on work rather than an empty list. */
export function defaultStatusView(views: Record<SupportStatusView, SupportTicket[]>): SupportStatusView {
  for (const key of ["overdue", "triage", "verify", "onUs", "onClient"] as const) {
    if (views[key].length) return key
  }
  return "onUs"
}

/** Search across ref, summary, client, owner, and property names. */
export function matchesTicketSearch(ticket: SupportTicket, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "")
  if (!q) return true
  const haystack = [
    String(ticket.ticket_number),
    ticket.summary,
    ticket.clients?.name,
    ticket.assignee?.full_name,
    ticket.assignee?.email,
    ...(ticket.support_ticket_listings ?? []).map((l) => l.listings?.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return haystack.includes(q)
}

// ---------------------------------------------------------------------------
// Last 24 hours (`?recent=`)
// ---------------------------------------------------------------------------

export const SUPPORT_RECENT_HOURS = 24

/**
 * `opened`: the client asked in the last 24 hours (`requested_at`, not when
 * the Hub imported it, so bulk-loaded backlog stays out). `active`: that, or
 * the client wrote again in the last 24 hours.
 */
export function isRecentTicket(
  ticket: Pick<SupportTicket, "requested_at" | "last_client_message_at">,
  mode: SupportRecentFilter,
  now: Date = new Date()
): boolean {
  const cutoff = now.getTime() - SUPPORT_RECENT_HOURS * 3_600_000
  const after = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() >= cutoff
  return after(ticket.requested_at) || (mode === "active" && after(ticket.last_client_message_at))
}
