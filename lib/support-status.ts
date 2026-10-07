// Support tickets — super-admin status changes and notes (migration
// 20261007150000). Client-safe and pure: the server action and the form share
// these rules, and set_support_ticket_status() re-checks them in the database.

import {
  SUPPORT_DISMISS_REASON_VALUES,
  detectCredential,
  type SupportDismissReason,
  type SupportStatus,
} from "@/lib/support-tickets"

/** Statuses a super admin can set directly (never "new" or "answered"). */
export const SUPPORT_OVERRIDE_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "awaiting_client", label: "Waiting on client" },
  { value: "resolved", label: "Resolved outside the Hub" },
  { value: "dismissed", label: "Dismissed" },
] as const satisfies readonly { value: SupportStatus; label: string }[]

export type SupportOverrideStatus = (typeof SUPPORT_OVERRIDE_STATUSES)[number]["value"]

export const SUPPORT_NOTE_MIN = 3
export const SUPPORT_NOTE_MAX = 1000

export function validateSupportNote(raw: string): { note: string } | { error: string } {
  const note = raw.trim()
  if (note.length < SUPPORT_NOTE_MIN) return { error: "Write a short note (3+ characters)" }
  if (note.length > SUPPORT_NOTE_MAX) return { error: "Keep the note under 1,000 characters" }
  const credential = detectCredential(note)
  if (credential) return { error: `Remove the ${credential} from the note` }
  return { note }
}

export function validateStatusChange(input: {
  current: SupportStatus
  merged: boolean
  status: string
  note: string
  dismissReason?: string | null
}):
  | { status: SupportOverrideStatus; note: string; dismissReason: SupportDismissReason | null }
  | { error: string } {
  if (input.merged) return { error: "This ticket was merged. Change the ticket it was merged into" }
  const option = SUPPORT_OVERRIDE_STATUSES.find((s) => s.value === input.status)
  if (!option) return { error: "Pick a status" }
  if (option.value === input.current) return { error: "It's already in that status. Add a note instead" }
  let dismissReason: SupportDismissReason | null = null
  if (option.value === "dismissed") {
    if (!(SUPPORT_DISMISS_REASON_VALUES as readonly string[]).includes(input.dismissReason ?? ""))
      return { error: "Pick a reason for dismissing" }
    dismissReason = input.dismissReason as SupportDismissReason
  }
  const note = validateSupportNote(input.note)
  if ("error" in note) return note
  return { status: option.value, note: note.note, dismissReason }
}

/** Messages raised by set_support_ticket_status() and the guard read fine as-is. */
export function friendlyStatusError(message: string | undefined): string {
  const known = [
    "Only a super admin",
    "Add a note",
    "Pick ",
    "already in that status",
    "was merged",
    "merged ticket cannot be reopened",
    "Ticket not found",
  ]
  if (message && known.some((k) => message.includes(k))) return message
  return "Couldn't change the status. Try again."
}
