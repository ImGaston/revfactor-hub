"use server"

// Support ticket actions. Every write runs with the signed-in user's session,
// so row-level security (support:edit / support:control) and the database
// guards (resolve gate, property ownership, promise history) still apply.
// Each change also lands on the ticket's timeline with the user as actor.

import { revalidatePath } from "next/cache"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { z } from "zod"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import {
  supportDismissSchema,
  type SupportPropertyScope,
  type SupportRequestType,
  type SupportStatus,
} from "@/lib/support-tickets"
import {
  friendlyDbError,
  isClosed,
  triageBlockers,
  validateAnswer,
  validateNote,
  validateVerification,
} from "@/lib/support-workflow"

type Result = { success: true; ticketId?: string } | { error: string }

const uuid = z.uuid()
// Roles that never work client support (see the permission seed in the migration)
const EXTERNAL_ROLES = new Set(["contractor", "marketing", "hostpricing"])

type TicketRow = {
  id: string
  client_id: string
  status: SupportStatus
  request_type: SupportRequestType
  property_scope: SupportPropertyScope
  property_validated_at: string | null
  answer_check_verdict: "pass" | "fail" | "uncertain" | null
  merged_into: string | null
  possible_duplicate_of: string | null
  client_told_live_at: string | null
}

async function session(
  action: "edit" | "control"
): Promise<{ supabase: SupabaseClient; user: User } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("support", action))) return { error: "You don't have permission to do that" }
  return { supabase, user }
}

async function loadTicket(supabase: SupabaseClient, ticketId: string): Promise<TicketRow | null> {
  const { data } = await supabase
    .from("support_tickets")
    .select(
      "id, client_id, status, request_type, property_scope, property_validated_at, answer_check_verdict, merged_into, possible_duplicate_of, client_told_live_at"
    )
    .eq("id", ticketId)
    .maybeSingle()
  return (data as TicketRow | null) ?? null
}

async function logEvent(
  supabase: SupabaseClient,
  user: User,
  ticketId: string,
  eventType: string,
  body: string | null = null,
  payload: Record<string, unknown> = {}
) {
  const { error } = await supabase
    .from("support_ticket_events")
    .insert({ ticket_id: ticketId, event_type: eventType, actor_id: user.id, body, payload })
  if (error) console.error(`[support] ${eventType} event failed for ${ticketId}:`, error.message)
}

function done(ticketId?: string): Result {
  revalidatePath("/support", "layout")
  return { success: true, ...(ticketId ? { ticketId } : {}) }
}

/** Shared preamble: valid id, allowed user, ticket exists and is still open. */
async function openTicket(
  ticketId: string,
  action: "edit" | "control"
): Promise<{ supabase: SupabaseClient; user: User; ticket: TicketRow } | { error: string }> {
  if (!uuid.safeParse(ticketId).success) return { error: "Ticket not found" }
  const s = await session(action)
  if ("error" in s) return s
  const ticket = await loadTicket(s.supabase, ticketId)
  if (!ticket) return { error: "Ticket not found" }
  if (isClosed(ticket)) return { error: "This ticket is closed. Reopen it first" }
  return { ...s, ticket }
}

export async function assignSupportTicket(ticketId: string, assigneeId: string | null): Promise<Result> {
  const ctx = await openTicket(ticketId, "edit")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx

  let assigneeName: string | null = null
  if (assigneeId) {
    if (!uuid.safeParse(assigneeId).success) return { error: "Pick a team member" }
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("id", assigneeId)
      .maybeSingle()
    if (!profile || EXTERNAL_ROLES.has(profile.role)) return { error: "Pick a team member" }
    assigneeName = profile.full_name || profile.email
  }

  const { error } = await supabase.from("support_tickets").update({ assignee_id: assigneeId }).eq("id", ticket.id)
  if (error) return { error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "assigned", null, { assignee_id: assigneeId, assignee_name: assigneeName })
  return done()
}

const propertySchema = z
  .object({
    scope: z.enum(["listings", "portfolio", "account"]),
    listingIds: z.array(z.uuid()).max(25),
  })
  .refine((p) => p.scope !== "listings" || p.listingIds.length > 0, "Pick at least one property")

export async function setSupportTicketProperty(
  ticketId: string,
  scope: string,
  listingIds: string[]
): Promise<Result> {
  const parsed = propertySchema.safeParse({ scope, listingIds })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick the property" }
  const ctx = await openTicket(ticketId, "edit")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  const ids = parsed.data.scope === "listings" ? [...new Set(parsed.data.listingIds)] : []

  if (ids.length) {
    const { data: owned } = await supabase.from("listings").select("id").eq("client_id", ticket.client_id).in("id", ids)
    if ((owned ?? []).length !== ids.length) return { error: "Pick properties that belong to this client" }
    const { error: insertError } = await supabase
      .from("support_ticket_listings")
      .upsert(ids.map((listing_id) => ({ ticket_id: ticket.id, listing_id })), {
        onConflict: "ticket_id,listing_id",
        ignoreDuplicates: true,
      })
    if (insertError) return { error: friendlyDbError(insertError.message) }
  }
  // Add first, then remove the rest, so a failure never leaves the ticket with no properties
  let removal = supabase.from("support_ticket_listings").delete().eq("ticket_id", ticket.id)
  if (ids.length) removal = removal.not("listing_id", "in", `(${ids.join(",")})`)
  const { error: deleteError } = await removal
  if (deleteError) return { error: friendlyDbError(deleteError.message) }

  const { error } = await supabase
    .from("support_tickets")
    .update({
      property_scope: parsed.data.scope,
      property_validated_at: new Date().toISOString(),
      property_validated_by: user.id,
    })
    .eq("id", ticket.id)
  if (error) return { error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "property_validated", null, { scope: parsed.data.scope, listing_ids: ids })
  return done()
}

export async function acceptSupportTriage(ticketId: string): Promise<Result> {
  const ctx = await openTicket(ticketId, "edit")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  if (ticket.status !== "new") return done()
  const blockers = triageBlockers(ticket)
  if (blockers.length) return { error: blockers[0] }

  const { error } = await supabase
    .from("support_tickets")
    .update({ status: "open", possible_duplicate_of: null, needs_attachment_review: false })
    .eq("id", ticket.id)
  if (error) return { error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "triaged", null, {
    from: "new",
    to: "open",
    cleared_duplicate: !!ticket.possible_duplicate_of,
  })
  return done()
}

export async function recordSupportAnswer(ticketId: string, answer: string): Promise<Result> {
  const valid = validateAnswer(answer)
  if ("error" in valid) return valid
  const ctx = await openTicket(ticketId, "edit")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  if (ticket.status === "new") return { error: "Triage the ticket first" }

  const { error } = await supabase
    .from("support_tickets")
    .update({
      answer_summary: valid.value,
      answered_at: new Date().toISOString(),
      answered_by: user.id,
      status: "answered",
    })
    .eq("id", ticket.id)
  if (error) return { error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "answer_recorded", valid.value)
  return done()
}

export async function markSupportToldLive(ticketId: string): Promise<Result> {
  const ctx = await openTicket(ticketId, "edit")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  if (ticket.request_type !== "change") return { error: "Only change requests need this" }
  if (ticket.client_told_live_at) return done()

  const { error } = await supabase
    .from("support_tickets")
    .update({ client_told_live_at: new Date().toISOString() })
    .eq("id", ticket.id)
  if (error) return { error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "client_told_live")
  return done()
}

export async function closeSupportPromise(
  commitmentId: string,
  outcome: "kept" | "cancelled",
  note?: string
): Promise<Result> {
  if (!uuid.safeParse(commitmentId).success) return { error: "Promise not found" }
  if (outcome !== "kept" && outcome !== "cancelled") return { error: "Pick kept or cancelled" }
  const validNote = validateNote(note, "a note on why it's cancelled", outcome === "cancelled")
  if ("error" in validNote) return validNote
  const s = await session("edit")
  if ("error" in s) return s
  const { supabase, user } = s

  const { data: promise } = await supabase
    .from("support_ticket_commitments")
    .select("id, ticket_id, status")
    .eq("id", commitmentId)
    .maybeSingle()
  if (!promise) return { error: "Promise not found" }
  if (promise.status !== "open") return done()

  const { error } = await supabase
    .from("support_ticket_commitments")
    .update({ status: outcome, closed_at: new Date().toISOString(), closed_by: user.id, close_note: validNote.value })
    .eq("id", promise.id)
  if (error) return { error: friendlyDbError(error.message) }
  await logEvent(
    supabase,
    user,
    promise.ticket_id,
    outcome === "kept" ? "commitment_kept" : "commitment_cancelled",
    validNote.value,
    { commitment_id: promise.id }
  )
  return done()
}

export async function verifySupportTicket(
  ticketId: string,
  checked: string[],
  overrideReason?: string
): Promise<Result> {
  const ctx = await openTicket(ticketId, "control")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  if (ticket.status !== "answered") return { error: "Record the answer first" }
  const valid = validateVerification(ticket, Array.isArray(checked) ? checked : [], overrideReason)
  if ("error" in valid) return valid

  const { error } = await supabase
    .from("support_tickets")
    .update({ status: "resolved", verified_by: user.id, verification: valid.verification })
    .eq("id", ticket.id)
  if (error) return { error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "verified", valid.verification.override_reason ?? null, {
    ...valid.verification,
  })
  return done()
}

export async function sendBackSupportTicket(ticketId: string, note: string): Promise<Result> {
  const validNote = validateNote(note, "what's missing from the answer", true)
  if ("error" in validNote) return validNote
  const ctx = await openTicket(ticketId, "control")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  if (ticket.status !== "answered") return { error: "Only answered tickets can be sent back" }

  const { error } = await supabase
    .from("support_tickets")
    .update({ status: "open", answered_at: null, answered_by: null })
    .eq("id", ticket.id)
  if (error) return { error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "verification_failed", validNote.value)
  return done()
}

export async function dismissSupportTicket(ticketId: string, reason: string, note?: string): Promise<Result> {
  const parsed = supportDismissSchema.safeParse({ reason, note: note ?? "" })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick a reason" }
  const validNote = validateNote(parsed.data.note, "a note", false)
  if ("error" in validNote) return validNote
  const ctx = await openTicket(ticketId, "edit")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx

  const { error } = await supabase
    .from("support_tickets")
    .update({ status: "dismissed", dismiss_reason: parsed.data.reason, dismiss_note: validNote.value })
    .eq("id", ticket.id)
  if (error) return { error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "dismissed", validNote.value, { reason: parsed.data.reason })
  return done()
}

export async function reopenSupportTicket(ticketId: string, note?: string): Promise<Result> {
  if (!uuid.safeParse(ticketId).success) return { error: "Ticket not found" }
  const validNote = validateNote(note, "a note", false)
  if ("error" in validNote) return validNote
  const s = await session("edit")
  if ("error" in s) return s
  const { supabase, user } = s
  const ticket = await loadTicket(supabase, ticketId)
  if (!ticket) return { error: "Ticket not found" }
  if (ticket.merged_into) return { error: "A merged ticket can't be reopened. Work the ticket it was merged into" }
  if (ticket.status !== "resolved" && ticket.status !== "dismissed") return done()

  const { error } = await supabase.from("support_tickets").update({ status: "open" }).eq("id", ticket.id)
  if (error) return { error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "reopened", validNote.value, { from: ticket.status })
  return done()
}

export async function mergeSupportTicket(sourceId: string, targetId: string): Promise<Result> {
  if (!uuid.safeParse(sourceId).success || !uuid.safeParse(targetId).success) return { error: "Pick a ticket to merge into" }
  const s = await session("edit")
  if ("error" in s) return s
  // The RPC checks permission, same client, and open source again, and writes both timeline events
  const { error } = await s.supabase.rpc("merge_support_ticket", { p_source: sourceId, p_target: targetId })
  if (error) return { error: friendlyDbError(error.message) }
  return done(targetId)
}
