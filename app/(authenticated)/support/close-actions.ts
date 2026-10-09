"use server"

// Ticket close-out actions: confirm the property, accept a triage ticket,
// keep or cancel promises, mark a change as told live, and verify (or send
// back) an answered ticket. Every write runs with the signed-in session, so
// row-level security (support:edit / support:control) and the database guard
// (the resolve checklist) still apply, and each change lands on the timeline
// with the person as actor.

import { revalidatePath } from "next/cache"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { z } from "zod"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import {
  supportTicketPath,
  type SupportPropertyScope,
  type SupportRequestType,
  type SupportStatus,
} from "@/lib/support-tickets"
import {
  friendlyDbError,
  isClosed,
  triageBlockers,
  validateNote,
  validateVerification,
} from "@/lib/support-workflow"

type Result = { ok: true } | { ok: false; error: string }

const uuid = z.uuid()

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
): Promise<{ supabase: SupabaseClient; user: User } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in again to continue." }
  if (!(await hasPermission("support", action)))
    return {
      ok: false,
      error: action === "control" ? "You don't have permission to verify tickets." : "You don't have permission to edit support tickets.",
    }
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
  if (error) console.error(`[support/close-actions] ${eventType} event failed for ${ticketId}:`, error.message)
}

function done(ticketId: string): Result {
  revalidatePath(supportTicketPath(ticketId))
  // The layout holds the sidebar queue; "layout" refreshes it and every page under it
  revalidatePath("/support", "layout")
  return { ok: true }
}

/** Valid id, allowed user, ticket exists and is still open. */
async function openTicket(
  ticketId: string,
  action: "edit" | "control"
): Promise<{ supabase: SupabaseClient; user: User; ticket: TicketRow } | { ok: false; error: string }> {
  if (!uuid.safeParse(ticketId).success) return { ok: false, error: "Ticket not found." }
  const s = await session(action)
  if ("error" in s) return s
  const ticket = await loadTicket(s.supabase, ticketId)
  if (!ticket) return { ok: false, error: "Ticket not found." }
  if (isClosed(ticket)) return { ok: false, error: "This ticket is closed. Reopen it first." }
  return { ...s, ticket }
}

const propertySchema = z
  .object({
    scope: z.enum(["listings", "portfolio", "account"]),
    listingIds: z.array(z.uuid()).max(25),
  })
  .refine((p) => p.scope !== "listings" || p.listingIds.length > 0, "Pick at least one property")

export async function confirmSupportPropertyAction(
  ticketId: string,
  scope: string,
  listingIds: string[]
): Promise<Result> {
  const parsed = propertySchema.safeParse({ scope, listingIds })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pick the property" }
  const ctx = await openTicket(ticketId, "edit")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  const ids = parsed.data.scope === "listings" ? [...new Set(parsed.data.listingIds)] : []

  if (ids.length) {
    const { data: owned } = await supabase.from("listings").select("id").eq("client_id", ticket.client_id).in("id", ids)
    if ((owned ?? []).length !== ids.length) return { ok: false, error: "Pick properties that belong to this client" }
    const { error: insertError } = await supabase
      .from("support_ticket_listings")
      .upsert(ids.map((listing_id) => ({ ticket_id: ticket.id, listing_id })), {
        onConflict: "ticket_id,listing_id",
        ignoreDuplicates: true,
      })
    if (insertError) return { ok: false, error: friendlyDbError(insertError.message) }
  }
  // Add first, then remove the rest, so a failure never leaves the ticket with no properties
  let removal = supabase.from("support_ticket_listings").delete().eq("ticket_id", ticket.id)
  if (ids.length) removal = removal.not("listing_id", "in", `(${ids.join(",")})`)
  const { error: deleteError } = await removal
  if (deleteError) return { ok: false, error: friendlyDbError(deleteError.message) }

  const { error } = await supabase
    .from("support_tickets")
    .update({
      property_scope: parsed.data.scope,
      property_validated_at: new Date().toISOString(),
      property_validated_by: user.id,
    })
    .eq("id", ticket.id)
  if (error) return { ok: false, error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "property_validated", null, { scope: parsed.data.scope, listing_ids: ids })
  return done(ticket.id)
}

export async function acceptSupportTriageAction(ticketId: string): Promise<Result> {
  const ctx = await openTicket(ticketId, "edit")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  if (ticket.status !== "new") return done(ticket.id)
  const blockers = triageBlockers(ticket)
  if (blockers.length) return { ok: false, error: blockers[0] }

  const { error } = await supabase
    .from("support_tickets")
    .update({ status: "open", possible_duplicate_of: null, needs_attachment_review: false })
    .eq("id", ticket.id)
  if (error) return { ok: false, error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "triaged", null, {
    from: "new",
    to: "open",
    cleared_duplicate: !!ticket.possible_duplicate_of,
  })
  return done(ticket.id)
}

export async function markSupportToldLiveAction(ticketId: string): Promise<Result> {
  const ctx = await openTicket(ticketId, "edit")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  if (ticket.request_type !== "change") return { ok: false, error: "Only change requests need this" }
  if (ticket.client_told_live_at) return done(ticket.id)

  const { error } = await supabase
    .from("support_tickets")
    .update({ client_told_live_at: new Date().toISOString() })
    .eq("id", ticket.id)
  if (error) return { ok: false, error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "client_told_live")
  return done(ticket.id)
}

export async function closeSupportPromiseAction(
  commitmentId: string,
  outcome: "kept" | "cancelled",
  note?: string
): Promise<Result> {
  if (!uuid.safeParse(commitmentId).success) return { ok: false, error: "Promise not found." }
  if (outcome !== "kept" && outcome !== "cancelled") return { ok: false, error: "Pick kept or cancelled" }
  const validNote = validateNote(note, "a note on why it's cancelled", outcome === "cancelled")
  if ("error" in validNote) return { ok: false, error: validNote.error }
  const s = await session("edit")
  if ("error" in s) return s
  const { supabase, user } = s

  const { data: promise } = await supabase
    .from("support_ticket_commitments")
    .select("id, ticket_id, status")
    .eq("id", commitmentId)
    .maybeSingle()
  if (!promise) return { ok: false, error: "Promise not found." }
  if (promise.status !== "open") return done(promise.ticket_id)

  const { error } = await supabase
    .from("support_ticket_commitments")
    .update({ status: outcome, closed_at: new Date().toISOString(), closed_by: user.id, close_note: validNote.value })
    .eq("id", promise.id)
  if (error) return { ok: false, error: friendlyDbError(error.message) }
  await logEvent(
    supabase,
    user,
    promise.ticket_id,
    outcome === "kept" ? "commitment_kept" : "commitment_cancelled",
    validNote.value,
    { commitment_id: promise.id }
  )
  return done(promise.ticket_id)
}

export async function verifySupportTicketAction(
  ticketId: string,
  checked: string[],
  overrideReason?: string
): Promise<Result> {
  const ctx = await openTicket(ticketId, "control")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  if (ticket.status !== "answered") return { ok: false, error: "Record the answer first" }
  const valid = validateVerification(ticket, Array.isArray(checked) ? checked : [], overrideReason)
  if ("error" in valid) return { ok: false, error: valid.error }

  const { error } = await supabase
    .from("support_tickets")
    .update({ status: "resolved", verified_by: user.id, verification: valid.verification })
    .eq("id", ticket.id)
  if (error) return { ok: false, error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "verified", valid.verification.override_reason ?? null, {
    ...valid.verification,
  })
  return done(ticket.id)
}

export async function sendBackSupportTicketAction(ticketId: string, note: string): Promise<Result> {
  const validNote = validateNote(note, "what's missing from the answer", true)
  if ("error" in validNote) return { ok: false, error: validNote.error }
  const ctx = await openTicket(ticketId, "control")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx
  if (ticket.status !== "answered") return { ok: false, error: "Only answered tickets can be sent back" }

  const { error } = await supabase
    .from("support_tickets")
    .update({ status: "open", answered_at: null, answered_by: null })
    .eq("id", ticket.id)
  if (error) return { ok: false, error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "verification_failed", validNote.value)
  return done(ticket.id)
}

// Roles that never work client support (see the permission seed in the migration)
const EXTERNAL_ROLES = new Set(["contractor", "marketing", "hostpricing"])

export async function assignSupportTicketAction(ticketId: string, assigneeId: string | null): Promise<Result> {
  const ctx = await openTicket(ticketId, "edit")
  if ("error" in ctx) return ctx
  const { supabase, user, ticket } = ctx

  let assigneeName: string | null = null
  if (assigneeId) {
    if (!uuid.safeParse(assigneeId).success) return { ok: false, error: "Pick a team member" }
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("id", assigneeId)
      .maybeSingle()
    if (!profile || EXTERNAL_ROLES.has(profile.role)) return { ok: false, error: "Pick a team member" }
    assigneeName = profile.full_name || profile.email
  }

  const { error } = await supabase.from("support_tickets").update({ assignee_id: assigneeId }).eq("id", ticket.id)
  if (error) return { ok: false, error: friendlyDbError(error.message) }
  await logEvent(supabase, user, ticket.id, "assigned", null, { assignee_id: assigneeId, assignee_name: assigneeName })
  return done(ticket.id)
}

/** Merge this ticket into the one that stays (merge_support_ticket writes both timeline events). */
export async function mergeSupportTicketAction(
  sourceId: string,
  targetId: string,
  /** The "Check with AI" title, when the user chose to use it */
  newTitle: string | null = null
): Promise<Result> {
  if (!uuid.safeParse(sourceId).success || !uuid.safeParse(targetId).success)
    return { ok: false, error: "Pick a ticket to merge into" }
  const title = newTitle?.trim() ?? ""
  if (newTitle !== null && (title.length < 3 || title.length > 300))
    return { ok: false, error: "The new title must be 3 to 300 characters" }
  const s = await session("edit")
  if ("error" in s) return s
  const { error } = await s.supabase.rpc("merge_support_ticket", { p_source: sourceId, p_target: targetId })
  if (error) return { ok: false, error: friendlyDbError(error.message) }

  if (title) {
    const { data: before } = await s.supabase.from("support_tickets").select("summary").eq("id", targetId).maybeSingle()
    const { error: titleError } = await s.supabase.from("support_tickets").update({ summary: title }).eq("id", targetId)
    // The merge already happened; a failed rename is reported in the log, not undone
    if (titleError) console.error("[support/close-actions] title after merge failed:", titleError.message)
    else await logEvent(s.supabase, s.user, targetId, "edited", `Title changed after a merge: ${title}`, { previous_summary: before?.summary ?? null })
  }
  revalidatePath(supportTicketPath(sourceId))
  return done(targetId)
}
