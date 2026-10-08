// Support tickets — the rules behind the ticket page's close-out buttons
// (confirm property, accept triage, promises, told live, verify, send back).
// Client-safe and pure: the server actions call the same validators the
// buttons use, and the database guard stays the final backstop.

import {
  detectCredential,
  overrideReasonRequired,
  SUPPORT_CLOSED_STATUSES,
  verificationChecksFor,
  type SupportRequestType,
  type SupportTicket,
} from "@/lib/support-tickets"

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
