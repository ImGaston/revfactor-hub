// Client-safe helpers for working /support one client at a time: the
// "By client" groups (`?view=client`) and the context panel on
// `?client=<id>`. Every rule here reuses the queue's own (bucketSupportTickets,
// commitmentTiming, isDoneNotTold) so the groups, the panel, and the header
// stats never disagree.

import { ownerLabel } from "@/lib/support-display"
import {
  SUPPORT_ACTIVE_STATUSES,
  bucketSupportTickets,
  commitmentTiming,
  effectiveDueAt,
  isDoneNotTold,
  openCommitments,
  promiseLikelyKept,
  type SupportTicket,
  type SupportTicketCommitment,
} from "@/lib/support-tickets"
import type { AdjustmentOrigin, AdjustmentStatus, AdjustmentType, AdjustmentUrgency } from "@/lib/types"

const isOpen = (t: SupportTicket) => SUPPORT_ACTIVE_STATUSES.includes(t.status)

// ---------------------------------------------------------------------------
// "By client" groups
// ---------------------------------------------------------------------------

export type SupportClientGroup = {
  clientId: string
  clientName: string
  /** Open tickets in queue order: triage, overdue, verify, on us, on client */
  tickets: SupportTicket[]
  open: number
  /** Same rule as the Overdue section and stat */
  overdue: number
  triage: number
  awaitingClient: number
  overduePromises: number
  oldestAskAt: string | null
  /** Owner labels by name, then "Unassigned" when any ticket has no owner */
  owners: string[]
}

/** Open promises on a ticket whose working due date has passed. */
export function overduePromiseCount(ticket: Pick<SupportTicket, "support_ticket_commitments">, now: Date): number {
  return openCommitments(ticket.support_ticket_commitments).filter(
    (c) => commitmentTiming(c, now) === "overdue"
  ).length
}

function groupFor(clientId: string, tickets: SupportTicket[], now: Date): SupportClientGroup {
  const queue = bucketSupportTickets(tickets, now)
  const ordered = [...queue.triage, ...queue.overdue, ...queue.verify, ...queue.onUs, ...queue.onClient]
  const owners = [...new Set(tickets.filter((t) => t.assignee_id).map((t) => ownerLabel(t.assignee)))].sort(
    (a, b) => a.localeCompare(b)
  )
  if (tickets.some((t) => !t.assignee_id)) owners.push("Unassigned")
  const oldestAskAt = tickets.reduce<string | null>(
    (oldest, t) => (oldest === null || t.requested_at < oldest ? t.requested_at : oldest),
    null
  )
  return {
    clientId,
    clientName: tickets.find((t) => t.clients?.name)?.clients?.name ?? "Unknown client",
    tickets: ordered,
    open: tickets.length,
    overdue: queue.overdue.length,
    triage: queue.triage.length,
    awaitingClient: tickets.filter((t) => t.status === "awaiting_client").length,
    overduePromises: tickets.reduce((sum, t) => sum + overduePromiseCount(t, now), 0),
    oldestAskAt,
    owners,
  }
}

/** Most open tickets first, then most overdue, then the oldest ask, then by name. */
export function compareClientGroups(a: SupportClientGroup, b: SupportClientGroup): number {
  return (
    b.open - a.open ||
    b.overdue - a.overdue ||
    (a.oldestAskAt ?? "").localeCompare(b.oldestAskAt ?? "") ||
    a.clientName.localeCompare(b.clientName, undefined, { sensitivity: "base" }) ||
    a.clientId.localeCompare(b.clientId)
  )
}

/**
 * One group per client with at least one open ticket. Closed tickets are
 * left out; pass tickets already narrowed by the owner filter.
 */
export function groupTicketsByClient(tickets: SupportTicket[], now: Date): SupportClientGroup[] {
  const byClient = new Map<string, SupportTicket[]>()
  for (const t of tickets) {
    if (!isOpen(t)) continue
    const list = byClient.get(t.client_id)
    if (list) list.push(t)
    else byClient.set(t.client_id, [t])
  }
  return [...byClient.entries()].map(([id, list]) => groupFor(id, list, now)).sort(compareClientGroups)
}

// ---------------------------------------------------------------------------
// Client context panel (`?client=<id>`)
// ---------------------------------------------------------------------------

/**
 * We owe the client a reply: the same check that starts the reply clock in
 * `nextDueAt`. The latest client message (the ask itself when none is
 * recorded, except check-ins, which start with our outreach) has no team
 * message after it. Nothing is owed while we wait on the client.
 */
export function awaitingOurReply(
  ticket: Pick<
    SupportTicket,
    "status" | "request_type" | "requested_at" | "last_client_message_at" | "last_team_message_at"
  >
): boolean {
  if (!SUPPORT_ACTIVE_STATUSES.includes(ticket.status) || ticket.status === "awaiting_client") return false
  const lastClient =
    ticket.last_client_message_at ?? (ticket.request_type === "check_in" ? null : ticket.requested_at)
  if (!lastClient) return false
  if (!ticket.last_team_message_at) return true
  return Date.parse(lastClient) > Date.parse(ticket.last_team_message_at)
}

/** Property confirmed: the same check the resolve checklist uses. */
export function isPropertyValidated(ticket: Pick<SupportTicket, "property_scope" | "property_validated_at">): boolean {
  return ticket.property_scope !== "unknown" && !!ticket.property_validated_at
}

export type SupportGapKey = "noReply" | "overduePromises" | "triage" | "toVerify" | "doneNotTold"

export type SupportClientGap = {
  key: SupportGapKey
  label: string
  hint: string
  /** Promises for `overduePromises`, tickets for the rest */
  count: number
  /** Tickets to open, oldest ask first */
  tickets: SupportTicket[]
}

/**
 * What still stands between this client and "all closed". Needs triage, to
 * verify, and done-not-told follow the header stats exactly
 * (bucketSupportTickets and isDoneNotTold over the open tickets).
 */
export function clientGaps(tickets: SupportTicket[], now: Date): SupportClientGap[] {
  const open = tickets.filter(isOpen).sort((a, b) => a.requested_at.localeCompare(b.requested_at))
  const queue = bucketSupportTickets(open, now)
  const inAskOrder = (subset: SupportTicket[]) => open.filter((t) => subset.includes(t))
  const withOverduePromises = open.filter((t) => overduePromiseCount(t, now) > 0)
  const noReply = open.filter(awaitingOurReply)
  const doneNotTold = open.filter((t) => isDoneNotTold(t))
  return [
    {
      key: "noReply",
      label: "No reply yet",
      hint: "the client's last message has no team reply after it",
      count: noReply.length,
      tickets: noReply,
    },
    {
      key: "overduePromises",
      label: "Overdue promises",
      hint: "open promises past their due date",
      count: withOverduePromises.reduce((sum, t) => sum + overduePromiseCount(t, now), 0),
      tickets: withOverduePromises,
    },
    {
      key: "triage",
      label: "Needs triage",
      hint: "confirm the category and property",
      count: queue.triage.length,
      tickets: inAskOrder(queue.triage),
    },
    {
      key: "toVerify",
      label: "Answered, awaiting verify",
      hint: "check the answer before it counts as done",
      count: queue.verify.length,
      tickets: inAskOrder(queue.verify),
    },
    {
      key: "doneNotTold",
      label: "Change live, client not told",
      hint: "tell the client it's live",
      count: doneNotTold.length,
      tickets: doneNotTold,
    },
  ]
}

// Shapes the server loader (lib/support-client-context.server.ts) returns
export type SupportContextListing = { id: string; name: string; status: string }

export type SupportContextAdjustment = {
  id: string
  type: AdjustmentType
  status: AdjustmentStatus
  origin: AdjustmentOrigin
  urgency: AdjustmentUrgency
  date_from: string | null
  date_to: string | null
  created_at: string
  resolved_at: string | null
  controlled_at: string | null
  support_ticket_id: string | null
  listings: { name: string } | null
}

export type SupportContextMessage = { at: string; ticketId: string; ticketNumber: number } | null

export type SupportClientContext = {
  /** null: the viewer can't read listings, or the read failed */
  listings: SupportContextListing[] | null
  /** null: no `adjustments:view`, or the read failed — the section hides */
  adjustments: { inFlight: SupportContextAdjustment[]; recentlyControlled: SupportContextAdjustment[] } | null
  lastClientMessage: SupportContextMessage
  lastTeamMessage: SupportContextMessage
}

export type SupportClientPromise = {
  commitment: SupportTicketCommitment
  ticket: SupportTicket
  dueAt: string
  overdue: boolean
  /** A linked Adjustment was controlled after the promise: probably kept */
  likelyKept: boolean
}

/** Every open promise across the client's open tickets, soonest due first. */
export function clientOpenPromises(tickets: SupportTicket[], now: Date): SupportClientPromise[] {
  return tickets
    .filter(isOpen)
    .flatMap((ticket) =>
      openCommitments(ticket.support_ticket_commitments).map((commitment) => ({
        commitment,
        ticket,
        dueAt: effectiveDueAt(commitment),
        overdue: commitmentTiming(commitment, now) === "overdue",
        likelyKept: promiseLikelyKept(commitment, ticket.adjustments),
      }))
    )
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.ticket.ticket_number - b.ticket.ticket_number)
}
