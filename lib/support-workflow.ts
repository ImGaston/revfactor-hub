// Support workspace — queue views and the rules behind the ticket actions.
// Client-safe and pure: the server actions call the same validators the UI
// uses to enable buttons, and the database guard is the final backstop.

import {
  bucketSupportTickets,
  detectCredential,
  overrideReasonRequired,
  SUPPORT_CLOSED_STATUSES,
  verificationChecksFor,
  type SupportRequestType,
  type SupportTicket,
} from "@/lib/support-tickets"

// ---------------------------------------------------------------------------
// Queue views (the workspace sidebar)
// ---------------------------------------------------------------------------

export const SUPPORT_QUEUE_VIEWS = [
  { key: "triage", label: "Needs triage", tone: "warning" },
  { key: "overdue", label: "Overdue", tone: "danger" },
  { key: "verify", label: "To verify" },
  { key: "onUs", label: "On us" },
  { key: "onClient", label: "On the client" },
  { key: "mine", label: "Mine" },
  { key: "checkIns", label: "Check-ins" },
  { key: "closed", label: "Closed (30 days)" },
] as const

export type SupportQueueView = (typeof SUPPORT_QUEUE_VIEWS)[number]["key"]

export function isQueueView(value: string | null | undefined): value is SupportQueueView {
  return SUPPORT_QUEUE_VIEWS.some((v) => v.key === value)
}

/** Tickets per view, in the queue's own order (urgency, then due). */
export function queueViews(
  tickets: SupportTicket[],
  currentUserId: string | null,
  now: Date = new Date()
): Record<SupportQueueView, SupportTicket[]> {
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
export function defaultQueueView(views: Record<SupportQueueView, SupportTicket[]>): SupportQueueView {
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
// Action rules
// ---------------------------------------------------------------------------

type Fail = { error: string }

export function isClosed(ticket: Pick<SupportTicket, "status" | "merged_into">): boolean {
  return !!ticket.merged_into || SUPPORT_CLOSED_STATUSES.includes(ticket.status)
}

/** Why a triage ticket can't move to the queue yet (empty = it can). */
export function triageBlockers(
  ticket: Pick<SupportTicket, "status" | "property_scope" | "property_validated_at">
): string[] {
  if (ticket.status !== "new") return []
  return ticket.property_scope === "unknown" || !ticket.property_validated_at ? ["Pick the property first"] : []
}

export const SUPPORT_ANSWER_MAX = 4000

/** The answer recorded for verification: trimmed, bounded, never a credential. */
export function validateAnswer(raw: string): { value: string } | Fail {
  const value = raw.trim()
  if (value.length < 3) return { error: "Write the answer the client got (3+ characters)" }
  if (value.length > SUPPORT_ANSWER_MAX) return { error: `Keep the answer under ${SUPPORT_ANSWER_MAX} characters` }
  const credential = detectCredential(value)
  if (credential) return { error: `Remove the ${credential} before saving` }
  return { value }
}

/** A note on a send-back, a cancelled promise, or a dismissal. */
export function validateNote(raw: string | null | undefined, label: string, required: boolean): { value: string | null } | Fail {
  const value = (raw ?? "").trim()
  if (!value) return required ? { error: `Add ${label}` } : { value: null }
  if (value.length > 1000) return { error: `Keep ${label} under 1,000 characters` }
  const credential = detectCredential(value)
  if (credential) return { error: `Remove the ${credential} from ${label}` }
  return { value }
}

export type VerificationSnapshot = {
  checks: string[]
  override_reason?: string
  verified_at: string
}

/**
 * The verifier ticks every check for the request type; a flagged answer
 * (fail or uncertain) also needs a written reason. The database re-checks the
 * gate (answer, property, promises, Adjustments, told-live, client reply).
 */
export function validateVerification(
  ticket: { request_type: SupportRequestType; answer_check_verdict: SupportTicket["answer_check_verdict"] },
  checked: string[],
  overrideReason: string | null | undefined,
  now: Date = new Date()
): { verification: VerificationSnapshot } | Fail {
  const required = verificationChecksFor(ticket.request_type).map((c) => c.key as string)
  const missing = required.filter((key) => !checked.includes(key))
  if (missing.length) return { error: "Tick every check before resolving" }
  const reason = (overrideReason ?? "").trim()
  if (overrideReasonRequired(ticket) && reason.length < 5)
    return { error: "The answer check flagged this reply. Explain why it's still correct" }
  return {
    verification: {
      checks: required,
      ...(reason ? { override_reason: reason } : {}),
      verified_at: now.toISOString(),
    },
  }
}

/** The database guard's messages are written for people; pass them through, hide the rest. */
export function friendlyDbError(message: string | undefined): string {
  if (!message) return "Something went wrong. Try again."
  if (/row-level security|permission denied|not allowed/i.test(message))
    return "You don't have permission to do that"
  const known = [
    "Validate which property",
    "Record the answer",
    "explain why it is still correct",
    "Close or cancel every open promise",
    "Every linked Adjustment",
    "Tell the client the change is live",
    "Reach out, then log the client",
    "requires a verifier",
    "merged ticket cannot be reopened",
    "cannot be merged into itself",
    "Only tickets of the same client",
    "is already closed",
    "is dismissed; merge into an active ticket",
    "Remove this ticket's properties",
    "does not belong",
  ]
  return known.some((k) => message.includes(k)) ? message.replace(/ before resolving$/, "") : "Something went wrong. Try again."
}
