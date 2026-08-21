"use server"

// Server Actions for the Wins rules editor.
//
// Rule sets are immutable rows: saving publishes a NEW version and points
// `is_active` at it. Nothing is ever edited in place, because a run's evidence
// cites its rules version and rewriting that version would silently change the
// meaning of work someone already reviewed.

import { revalidatePath } from "next/cache"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { ruleSetToRow, validateRuleSet, type WinsRuleInput } from "@/lib/wins"

const MAX_NOTE = 300

type ActionResult<T extends object = object> = { error: string } | ({ success: true } & T)

/**
 * Publish a new rule version and activate it.
 *
 * Activation goes through the `activate_win_rule_set` RPC so deactivating the
 * previous row and activating the new one happen in one statement — the
 * partial unique index on `is_active` rejects any window where two rows are
 * active, which would otherwise leave detection with no rules at all.
 */
export async function publishWinRulesAction(
  input: WinsRuleInput,
  note?: string
): Promise<ActionResult<{ version: number }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("wins", "control"))) {
    return { error: "Publishing detection rules requires the wins:control permission" }
  }

  const parsed = validateRuleSet(input)
  if ("error" in parsed) return { error: parsed.error }

  const { data: latest } = await supabase
    .from("win_rule_sets")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = ((latest?.version as number) ?? 0) + 1

  const { data: inserted, error } = await supabase
    .from("win_rule_sets")
    .insert({
      version: nextVersion,
      note: note?.trim().slice(0, MAX_NOTE) || null,
      ...ruleSetToRow(parsed.value),
      is_active: false,
      created_by: user.id,
    })
    .select("id, version")
    .single()

  if (error || !inserted) {
    // The CHECK constraints are the real boundary; validateRuleSet only gets
    // to the message first.
    return { error: error?.message ?? "Could not publish the rule set" }
  }

  const { error: activateError } = await supabase.rpc("activate_win_rule_set", {
    p_id: inserted.id,
  })
  if (activateError) return { error: activateError.message }

  revalidatePath("/settings/wins")
  revalidatePath("/wins")
  return { success: true, version: inserted.version as number }
}

/** Roll back to a previously published version without duplicating it. */
export async function activateWinRulesAction(
  ruleSetId: string
): Promise<ActionResult> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(ruleSetId)) return { error: "Invalid rule set" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("wins", "control"))) {
    return { error: "Activating detection rules requires the wins:control permission" }
  }

  const { error } = await supabase.rpc("activate_win_rule_set", { p_id: ruleSetId })
  if (error) return { error: error.message }

  revalidatePath("/settings/wins")
  revalidatePath("/wins")
  return { success: true }
}
