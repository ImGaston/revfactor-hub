// Support tickets — display helpers shared by the queue and the ticket
// detail. Client-safe and pure. Dates render in America/New_York (the team's
// working time zone, same as the promise rules) so server and client output
// always match.

import type { SupportTicket, SupportTicketEvent } from "@/lib/support-tickets"

const TIME_ZONE = "America/New_York"

export const SUPPORT_EVENT_LABEL: Record<string, string> = {
  created: "Ticket created",
  triaged: "Triaged",
  edited: "Edited",
  assigned: "Owner changed",
  handoff: "Handed off",
  status_changed: "Status changed",
  note: "Note",
  client_message: "Client message",
  client_acknowledged: "Client acknowledged",
  client_rejected: "Client said it's not right",
  client_told_live: "Client told it's live",
  team_reply: "Team reply",
  team_asked_client: "Team asked the client",
  internal_note_from_chat: "Internal note",
  answer_recorded: "Answer recorded",
  answer_checked: "Answer checked",
  answer_saved: "Answer saved",
  suggestion_unlocked: "Answered first, suggestion unlocked",
  answer_finalized: "Final answer saved",
  commitment_made: "Promise made",
  commitment_kept: "Promise kept",
  commitment_cancelled: "Promise cancelled",
  commitment_rescheduled: "Promise rescheduled",
  adjustment_linked: "Adjustment linked",
  property_validated: "Property validated",
  possible_duplicate: "Possible duplicate",
  merged: "Merged",
  verified: "Verified and resolved",
  verification_failed: "Sent back at verification",
  reopened: "Reopened",
  dismissed: "Dismissed",
}

export function supportEventLabel(type: string): string {
  return SUPPORT_EVENT_LABEL[type] ?? type.replace(/_/g, " ")
}

/** Who an event came from: the Hub user, else the chat name the bot saw. */
export function supportEventActor(
  event: Pick<SupportTicketEvent, "actor" | "actor_label">
): string {
  return event.actor?.full_name || event.actor?.email || event.actor_label || "System"
}

/** Which side of the conversation an event is from, for the timeline dot. */
export function supportEventSide(type: string): "client" | "team" | "system" {
  if (type.startsWith("client_")) return "client"
  if (
    type.startsWith("team_") ||
    type.startsWith("commitment_") ||
    type === "handoff" ||
    type === "answer_saved" ||
    type === "suggestion_unlocked" ||
    type === "answer_finalized"
  )
    return "team"
  return "system"
}

/** Public listing label: the part before the internal "| state | owner" suffix. */
function publicName(name: string): string {
  return (name.split(/[|•]/)[0] ?? name).trim()
}

export function ticketPropertyLabel(
  ticket: Pick<SupportTicket, "property_scope" | "support_ticket_listings">
): string {
  if (ticket.property_scope === "portfolio") return "Whole portfolio"
  if (ticket.property_scope === "account") return "Not property-specific"
  const names = (ticket.support_ticket_listings ?? [])
    .map((l) => (l.listings?.name ? publicName(l.listings.name) : null))
    .filter((n): n is string => !!n)
  if (names.length) return names.join(", ")
  return "Property not validated"
}

export function ownerLabel(assignee: SupportTicket["assignee"]): string {
  if (!assignee) return "Unassigned"
  return assignee.full_name?.split(/\s+/)[0] || assignee.email
}

/** "Sep 29, 3:04 PM" in New York time. */
export function formatSupportDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/** "3h ago", "2d ago", "just now". */
export function timeAgo(iso: string | null | undefined, now: Date): string {
  if (!iso) return "—"
  const diff = now.getTime() - new Date(iso).getTime()
  if (diff < 60_000) return "just now"
  const hours = diff / 3_600_000
  if (hours < 1) return `${Math.round(diff / 60_000)}m ago`
  if (hours < 48) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}
