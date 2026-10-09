import { z } from "zod"

import { validateSupportNote } from "@/lib/support-status"
import {
  SUPPORT_DISMISS_REASON_VALUES,
  type SupportDismissReason,
  type SupportStatus,
} from "@/lib/support-tickets"

const API_STATUSES = [
  "open",
  "in_progress",
  "awaiting_client",
  "answered",
  "resolved",
  "closed",
  "dismissed",
] as const

export const supportTicketUpdateSchema = z
  .object({
    note: z.string().optional(),
    status: z.enum(API_STATUSES).optional(),
    dismiss_reason: z.enum(SUPPORT_DISMISS_REASON_VALUES).optional(),
    answer_summary: z.string().optional(),
    actor_label: z.string().trim().min(1).max(80).optional(),
    idempotency_key: z.string().min(3).max(120).regex(/^[A-Za-z0-9:_.-]+$/).optional(),
  })
  .strict()

export type SupportApiWriteTicket = {
  status: SupportStatus
  merged_into: string | null
  hand_managed: boolean
}

type Issue = { path: string; message: string }
type PreparedUpdate = {
  note: string
  status: Exclude<SupportStatus, "new"> | null
  dismissReason: SupportDismissReason | null
  answerSummary: string | null
  actorLabel: string
  idempotencyKey: string | null
}

export type PrepareSupportTicketUpdateResult =
  | { ok: true; value: PreparedUpdate }
  | { ok: false; status: number; error: string; issues?: Issue[] }

export function prepareSupportTicketUpdate(
  raw: unknown,
  ticket: SupportApiWriteTicket
): PrepareSupportTicketUpdateResult {
  const parsed = supportTicketUpdateSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Invalid ticket update payload",
      issues: parsed.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    }
  }

  const input = parsed.data
  if (input.note === undefined && input.status === undefined)
    return { ok: false, status: 400, error: "Add a note or choose a status" }
  if (input.status !== undefined && input.note === undefined)
    return { ok: false, status: 400, error: "Add a note for the status change" }

  const status = input.status === "closed" ? "resolved" : (input.status ?? null)
  if (input.dismiss_reason !== undefined && status !== "dismissed")
    return { ok: false, status: 400, error: "dismiss_reason is only allowed with dismissed status" }
  if (status === "dismissed" && input.dismiss_reason === undefined)
    return { ok: false, status: 400, error: "Pick a reason for dismissing" }
  if (input.answer_summary !== undefined && status !== "answered")
    return { ok: false, status: 400, error: "answer_summary is only allowed with answered status" }

  if (ticket.merged_into)
    return {
      ok: false,
      status: 409,
      error: "This ticket was merged; change the ticket it was merged into",
    }
  if (status && ticket.status === status)
    return { ok: false, status: 409, error: "The ticket is already in that status; add a note instead" }
  if (status && ticket.hand_managed)
    return {
      ok: false,
      status: 409,
      error: "This ticket is hand-managed; only a person can change its status",
    }

  let note = ""
  if (input.note !== undefined) {
    const checked = validateSupportNote(input.note)
    if ("error" in checked) return { ok: false, status: 400, error: checked.error }
    note = checked.note
  }

  let answerSummary: string | null = null
  if (input.answer_summary !== undefined) {
    const checked = validateSupportNote(input.answer_summary)
    if ("error" in checked) return { ok: false, status: 400, error: checked.error }
    answerSummary = checked.note
  }

  const actor = input.actor_label ?? "Support API bot"
  return {
    ok: true,
    value: {
      note,
      status,
      dismissReason: input.dismiss_reason ?? null,
      answerSummary,
      actorLabel: `Bot: ${actor}`.slice(0, 120),
      idempotencyKey: input.idempotency_key ?? null,
    },
  }
}
