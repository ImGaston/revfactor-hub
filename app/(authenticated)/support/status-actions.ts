"use server"

// Super-admin ticket actions: change the status directly (including
// "resolved outside the Hub") and add notes, also on closed tickets. Today
// that's Fede and Gastón. The database function re-checks the role, so a
// crafted request from anyone else still fails.

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import { friendlyStatusError, validateStatusChange, validateSupportNote } from "@/lib/support-status"
import { supportTicketPath, type SupportStatus } from "@/lib/support-tickets"

type Result = { ok: true } | { ok: false; error: string }

const ticketIdSchema = z.uuid()

async function superAdmin(): Promise<{ userId: string } | { error: string }> {
  const profile = await getProfile()
  if (!profile) return { error: "Sign in again to continue." }
  if (profile.role !== "super_admin") return { error: "Only Fede or Gastón can do this." }
  return { userId: profile.id }
}

function refresh(ticketId: string) {
  revalidatePath(supportTicketPath(ticketId))
  // The layout holds the sidebar queue; "layout" refreshes it and every page under it
  revalidatePath("/support", "layout")
}

export async function setSupportStatusAction(
  ticketId: string,
  status: string,
  note: string,
  dismissReason?: string | null
): Promise<Result> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const auth = await superAdmin()
  if ("error" in auth) return { ok: false, error: auth.error }

  const supabase = await createClient()
  const { data: current } = await supabase
    .from("support_tickets")
    .select("status, merged_into")
    .eq("id", ticketId)
    .maybeSingle()
  if (!current) return { ok: false, error: "Ticket not found." }

  const valid = validateStatusChange({
    current: current.status as SupportStatus,
    merged: !!current.merged_into,
    status,
    note,
    dismissReason,
  })
  if ("error" in valid) return { ok: false, error: valid.error }

  const { error } = await supabase.rpc("set_support_ticket_status", {
    p_ticket: ticketId,
    p_status: valid.status,
    p_note: valid.note,
    p_dismiss_reason: valid.dismissReason,
  })
  if (error) {
    console.error("[support/status-actions] status change failed:", error.message)
    return { ok: false, error: friendlyStatusError(error.message) }
  }
  refresh(ticketId)
  return { ok: true }
}

export async function addSupportNoteAction(ticketId: string, note: string): Promise<Result> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const auth = await superAdmin()
  if ("error" in auth) return { ok: false, error: auth.error }
  const valid = validateSupportNote(note)
  if ("error" in valid) return { ok: false, error: valid.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from("support_ticket_events")
    .insert({ ticket_id: ticketId, event_type: "note", actor_id: auth.userId, body: valid.note })
  if (error) {
    console.error("[support/status-actions] note failed:", error.message)
    return { ok: false, error: "Couldn't add the note. Try again." }
  }
  refresh(ticketId)
  return { ok: true }
}
