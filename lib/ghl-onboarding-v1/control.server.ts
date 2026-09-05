import "server-only"
import { randomBytes } from "node:crypto"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { hash, loadJourney } from "./service.server"
import { clientContext } from "./domain"
export const ControlSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), journeyId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("pause"),
      journeyId: z.uuid(),
      expectedRevision: z.number().int().min(1),
      reason: z.enum([
        "human_takeover",
        "opt_out",
        "cancelled",
        "scope_correction",
      ]),
    })
    .strict(),
  z
    .object({
      action: z.literal("renew_link"),
      journeyId: z.uuid(),
      expectedRevision: z.number().int().min(1),
    })
    .strict(),
])
export async function controlJourney(input: z.infer<typeof ControlSchema>) {
  if (input.action === "status") {
    const row = await loadJourney(input.journeyId)
    return {
      ...clientContext(row.payload),
      revision: row.revision,
      manualTakeover: row.payload.manualTakeover,
    }
  }
  const token =
    input.action === "renew_link" ? randomBytes(32).toString("base64url") : null
  const { data, error } = await createAdminClient().rpc(
    "control_ghl_onboarding_v1",
    {
      p_id: input.journeyId,
      p_revision: input.expectedRevision,
      p_action: input.action,
      p_reason: input.action === "pause" ? input.reason : null,
      p_token_hash: token ? hash(token) : null,
    }
  )
  if (error)
    throw new Error(
      error.message.includes("revision_conflict")
        ? "revision_conflict"
        : "journey_control_failed"
    )
  return { ...data, ...(token ? { contextToken: token } : {}) }
}
