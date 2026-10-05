"use server"

// Ticket page actions for the blind-first answer flow:
//   1. save the team's own answer (the first save unlocks the suggestion),
//   2. review it (Jev check + comparison with the suggestion),
//   3. merge / check / save the final answer.
// Plus preparing the Hub's suggested answer and testing the Jev connection.
// All run with the signed-in session (RLS applies) and are gated on
// support:edit in code too. None returns suggestion text before the team has
// a saved answer, and none sends anything to a client.

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { testJevConnection, type JevConnectionTest } from "@/lib/jev.server"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import {
  generateSuggestedAnswer,
  mergeSupportAnswers,
  runSupportAnswerReview,
  runSupportFinalCheck,
  saveSupportAnswer,
  saveSupportFinalAnswer,
} from "@/lib/support-answers.server"
import {
  SUPPORT_FINAL_SOURCES,
  type SupportAnswerVerdict,
  type SupportComparisonVerdict,
  type SupportUsedSuggestion,
} from "@/lib/support-answers"
import { supportTicketPath } from "@/lib/support-tickets"

const ticketIdSchema = z.uuid()
const finalSourceSchema = z.enum(SUPPORT_FINAL_SOURCES)

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

/** Prepare (or regenerate) the Hub's suggested answer. Returns no draft text. */
export async function generateSuggestedAnswerAction(ticketId: string): Promise<ActionResult<{ applied: boolean }>> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const auth = await editor()
  if ("error" in auth) return { ok: false, error: auth.error }

  try {
    const supabase = await createClient()
    const result = await generateSuggestedAnswer(supabase, ticketId, { origin: "manual", userId: auth.userId })
    revalidatePath(supportTicketPath(ticketId))
    if (result.status === "generated") return { ok: true, applied: result.applied }
    if (result.status === "not_configured")
      return { ok: false, error: "AI drafting is not configured.", notConfigured: true }
    if (result.status === "skipped") return { ok: false, error: result.reason }
    return { ok: false, error: `The draft failed: ${result.error}` }
  } catch (error) {
    return failure(error, "Couldn't prepare a suggested answer. Try again.")
  }
}

/** Steps 1–2: save the team's answer. The first save unlocks the suggestion. */
export async function saveSupportAnswerAction(
  ticketId: string,
  text: string
): Promise<ActionResult<{ changed: boolean; body: string; unlocked: boolean }>> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const auth = await editor()
  if ("error" in auth) return { ok: false, error: auth.error }

  try {
    const supabase = await createClient()
    const saved = await saveSupportAnswer(supabase, ticketId, text, auth.userId)
    if (!saved.ok) return saved
    if (saved.changed) revalidatePath(supportTicketPath(ticketId))
    return { ok: true, changed: saved.changed, body: saved.body, unlocked: saved.unlocked }
  } catch (error) {
    return failure(error, "Couldn't save the answer. Try again.")
  }
}

/** Step 2: Jev check of the saved team answer and comparison with the suggestion. */
export async function runAnswerReviewAction(ticketId: string): Promise<
  ActionResult<{
    check: { status: "checked"; verdict: SupportAnswerVerdict } | { status: "not_configured" | "failed"; error?: string }
    comparison:
      | { status: "compared"; verdict: SupportComparisonVerdict | null }
      | { status: "not_configured" | "no_suggestion" }
  }>
> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const auth = await editor()
  if ("error" in auth) return { ok: false, error: auth.error }

  try {
    const supabase = await createClient()
    const result = await runSupportAnswerReview(supabase, ticketId, auth.userId)
    if (result.status !== "reviewed") return { ok: false, error: result.error }
    revalidatePath(supportTicketPath(ticketId))
    const check =
      result.check.status === "checked"
        ? { status: "checked" as const, verdict: result.check.verdict }
        : result.check.status === "failed"
          ? { status: "failed" as const, error: `The AI check failed: ${result.check.error}` }
          : { status: "not_configured" as const }
    const comparison =
      result.comparison.status === "compared"
        ? { status: "compared" as const, verdict: result.comparison.verdict }
        : { status: result.comparison.status }
    return { ok: true, check, comparison }
  } catch (error) {
    return failure(error, "Couldn't review the answer. Try again.")
  }
}

/** Step 3: "Merge with AI". Returns text for the final editor; stores nothing. */
export async function mergeAnswersAction(ticketId: string): Promise<ActionResult<{ text: string; addedPoints: string[] }>> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const auth = await editor()
  if ("error" in auth) return { ok: false, error: auth.error }

  try {
    const supabase = await createClient()
    const result = await mergeSupportAnswers(supabase, ticketId, auth.userId)
    if (!result.ok) return result
    return { ok: true, text: result.text, addedPoints: result.addedPoints }
  } catch (error) {
    return failure(error, "Couldn't merge the answers. Try again.")
  }
}

/** Step 3: Jev check of the final text (saved or not). */
export async function checkFinalAnswerAction(
  ticketId: string,
  text: string
): Promise<ActionResult<{ verdict: SupportAnswerVerdict }>> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const auth = await editor()
  if ("error" in auth) return { ok: false, error: auth.error }

  try {
    const supabase = await createClient()
    const result = await runSupportFinalCheck(supabase, ticketId, text, auth.userId)
    revalidatePath(supportTicketPath(ticketId))
    if (result.status === "checked") return { ok: true, verdict: result.verdict }
    if (result.status === "not_configured")
      return { ok: false, error: "AI check not configured.", notConfigured: true }
    if (result.status === "failed") return { ok: false, error: `The AI check failed: ${result.error}` }
    return { ok: false, error: result.error }
  } catch (error) {
    return failure(error, "Couldn't check the final answer. Try again.")
  }
}

/** Step 3: save the answer to send in Assembly. */
export async function saveFinalAnswerAction(
  ticketId: string,
  text: string,
  source: string
): Promise<ActionResult<{ body: string; usedSuggestion: SupportUsedSuggestion }>> {
  if (!ticketIdSchema.safeParse(ticketId).success) return { ok: false, error: "Invalid ticket." }
  const parsedSource = finalSourceSchema.safeParse(source)
  if (!parsedSource.success) return { ok: false, error: "Invalid answer source." }
  const auth = await editor()
  if ("error" in auth) return { ok: false, error: auth.error }

  try {
    const supabase = await createClient()
    const result = await saveSupportFinalAnswer(supabase, ticketId, text, parsedSource.data, auth.userId)
    if (!result.ok) return result
    if (result.changed) revalidatePath(supportTicketPath(ticketId))
    return { ok: true, body: result.body, usedSuggestion: result.usedSuggestion }
  } catch (error) {
    return failure(error, "Couldn't save the final answer. Try again.")
  }
}

/** Diagnostic: one trivial Jev question. Shows transport, model, and latency; never a secret. */
export async function testJevConnectionAction(): Promise<ActionResult<{ result: JevConnectionTest }>> {
  const auth = await editor()
  if ("error" in auth) return { ok: false, error: auth.error }
  try {
    return { ok: true, result: await testJevConnection() }
  } catch (error) {
    return failure(error, "Couldn't reach Jev.")
  }
}
