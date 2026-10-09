import "server-only"

// Reads, writes, and generates the plain-English (ASD-STE100) ask. Session
// client only: RLS (support:view to read, support:edit to save) is the gate.

import type { SupabaseClient } from "@supabase/supabase-js"
import { isStepCount, Output, ToolLoopAgent } from "ai"

import {
  SUPPORT_ASK_PLAIN_INSTRUCTIONS,
  SUPPORT_ASK_PLAIN_MODEL_ID,
  askPlainSourceHash,
  askPlainViolations,
  buildAskPlainPrompt,
  supportAskPlainSchema,
  type SupportAskPlain,
} from "@/lib/support-ask-plain"
import { isMissingRelation } from "@/lib/support-answers.server"

const TIMEOUT_MS = 30_000

export type SupportAskPlainState = {
  /** False until migration 20261009150000 is applied: the section hides */
  schemaReady: boolean
  plain: (SupportAskPlain & { generatedAt: string }) | null
  /** The saved version was written from the current message */
  fresh: boolean
}

export async function loadSupportAskPlain(
  supabase: SupabaseClient,
  ticketId: string,
  message: string | null
): Promise<SupportAskPlainState> {
  const { data, error } = await supabase
    .from("support_ticket_ask_plain")
    .select("wants, says, source_hash, generated_at")
    .eq("ticket_id", ticketId)
    .maybeSingle()
  if (error) {
    if (isMissingRelation(error)) return { schemaReady: false, plain: null, fresh: false }
    throw new Error(`plain ask load failed: ${error.message}`)
  }
  if (!data) return { schemaReady: true, plain: null, fresh: false }
  return {
    schemaReady: true,
    plain: { wants: data.wants, says: data.says ?? [], generatedAt: data.generated_at },
    fresh: !!message && data.source_hash === askPlainSourceHash(message),
  }
}

/** One model call, plus one retry when a sentence breaks the length cap. */
export async function generateSupportAskPlain(message: string, userLabel: string): Promise<SupportAskPlain> {
  const agent = new ToolLoopAgent({
    id: "revfactor-support-ask-plain",
    model: SUPPORT_ASK_PLAIN_MODEL_ID,
    reasoning: "none",
    instructions: SUPPORT_ASK_PLAIN_INSTRUCTIONS,
    providerOptions: {
      gateway: {
        user: userLabel,
        tags: ["feature:support-ask-plain", `environment:${process.env.VERCEL_ENV ?? "development"}`],
      },
    },
    output: Output.object({ schema: supportAskPlainSchema }),
    stopWhen: isStepCount(1),
    maxOutputTokens: 600,
  })
  let violations: string[] = []
  let output: SupportAskPlain | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await agent.generate({
      prompt: buildAskPlainPrompt(message, violations),
      timeout: { totalMs: TIMEOUT_MS, stepMs: TIMEOUT_MS },
    })
    output = result.output
    violations = askPlainViolations(output)
    if (violations.length === 0) break
  }
  // Two tries: a long sentence still beats no plain version
  return output as SupportAskPlain
}

export async function saveSupportAskPlain(
  supabase: SupabaseClient,
  ticketId: string,
  message: string,
  plain: SupportAskPlain,
  userId: string
): Promise<{ ok: boolean }> {
  const { error } = await supabase.from("support_ticket_ask_plain").upsert(
    {
      ticket_id: ticketId,
      wants: plain.wants,
      says: plain.says,
      source_hash: askPlainSourceHash(message),
      model: SUPPORT_ASK_PLAIN_MODEL_ID,
      generated_by: userId,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "ticket_id" }
  )
  if (error) console.error("plain ask save failed", error.message)
  return { ok: !error }
}
