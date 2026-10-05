"use server"

// Ticket page actions for "Our answer": generate the Hub's suggested answer,
// save the owner's answer, and run the Jev answer check. All run with the
// signed-in session (RLS applies) and are gated on support:edit in code too.
// None of them sends anything to a client.

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import {
  generateSuggestedAnswer,
  runSupportAnswerCheck,
  saveSupportAnswer,
} from "@/lib/support-answers.server"
import type { SupportAnswerVerdict } from "@/lib/support-answers"
import { supportTicketPath } from "@/lib/support-tickets"

const ticketIdSchema = z.uuid()

type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; notConfigured?: boolean }

async function editor(): Promise<{ userId: string } | { error: string }> {
  if (!(await hasPermission("support", "edit"))) return { error: "You don't have permission to edit support tickets." }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Sign in again to continue." }
  return { userId: user.id }
}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  console.error(`[support/answer-actions] ${fallback}:`, error instanceof Error ? error.message : error)
  return { ok: false, error: fallback }
}

/** Generate (or regenerate) the Hub's suggested answer. Replaces the current draft. */
export async function generateSuggestedAnswerAction(
  ticketId: string
): Promise<ActionResult<{ applied: boolean }>> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const auth = await editor()
  if ("error" in auth) return { ok: false, error: auth.error }

  try {
    const supabase = await createClient()
    const result = await generateSuggestedAnswer(supabase, ticketId, { origin: "manual", userId: auth.userId })
    revalidatePath(supportTicketPath(ticketId))
    switch (result.status) {
      case "generated":
        return { ok: true, applied: result.applied }
      case "not_configured":
        return { ok: false, error: "AI drafting is not configured.", notConfigured: true }
      case "skipped":
        return { ok: false, error: result.reason }
      case "failed":
        return { ok: false, error: `The draft failed: ${result.error}` }
    }
  } catch (error) {
    return failure(error, "Couldn't generate a draft. Try again.")
  }
}

/** Save the answer the owner will send in Assembly. */
export async function saveSupportAnswerAction(
  ticketId: string,
  text: string
): Promise<ActionResult<{ changed: boolean; body: string }>> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const auth = await editor()
  if ("error" in auth) return { ok: false, error: auth.error }

  try {
    const supabase = await createClient()
    const saved = await saveSupportAnswer(supabase, ticketId, text, auth.userId)
    if (!saved.ok) return saved
    if (saved.changed) revalidatePath(supportTicketPath(ticketId))
    return { ok: true, changed: saved.changed, body: saved.body }
  } catch (error) {
    return failure(error, "Couldn't save the answer. Try again.")
  }
}

/**
 * Save the answer if it changed, then check it with Jev against the client's
 * ask, the ticket facts, and approved knowledge.
 */
export async function checkSupportAnswerAction(
  ticketId: string,
  text: string
): Promise<ActionResult<{ verdict: SupportAnswerVerdict; body: string }>> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const auth = await editor()
  if ("error" in auth) return { ok: false, error: auth.error }

  try {
    const supabase = await createClient()
    const saved = await saveSupportAnswer(supabase, ticketId, text, auth.userId)
    if (!saved.ok) return saved
    const result = await runSupportAnswerCheck(supabase, ticketId, saved.body, auth.userId)
    revalidatePath(supportTicketPath(ticketId))
    switch (result.status) {
      case "checked":
        return { ok: true, verdict: result.verdict, body: saved.body }
      case "not_configured":
        return { ok: false, error: "AI check not configured. The answer was saved.", notConfigured: true }
      case "failed":
        return { ok: false, error: `The AI check failed: ${result.error}` }
    }
  } catch (error) {
    return failure(error, "Couldn't check the answer. Try again.")
  }
}
