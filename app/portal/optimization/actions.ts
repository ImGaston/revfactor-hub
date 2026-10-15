"use server"

import { after } from "next/server"

import { resolvePortalAccess } from "@/lib/assembly-portal-session.server"
import {
  notifyTeamOfOwnerDecision,
  recordOwnerDecision,
  type DecisionResult,
} from "@/lib/listing-optimization.server"
import type { OptimizationDecision } from "@/lib/listing-optimization"

const DECISIONS: OptimizationDecision[] = ["accept", "decline", "reset"]

// Every call re-validates the Assembly session token; nothing from the
// browser other than the token establishes who the owner is.
export async function decideOptimizationItemAction(input: {
  token: string
  itemId: string
  decision: OptimizationDecision
  choice?: string | null
  note?: string | null
}): Promise<DecisionResult> {
  if (!DECISIONS.includes(input.decision) || typeof input.itemId !== "string") {
    return { ok: false, error: "Invalid request." }
  }
  const access = await resolvePortalAccess(input.token)
  if (!access.ok) {
    return { ok: false, error: "Your session expired. Reopen this page from your portal." }
  }
  const result = await recordOwnerDecision({
    viewer: access.viewer,
    itemId: input.itemId,
    decision: input.decision,
    choice: typeof input.choice === "string" ? input.choice : null,
    note: typeof input.note === "string" ? input.note : null,
  })
  // Ping the team once per owner session when changes are accepted (after the response).
  if (result.ok && input.decision === "accept") after(() => notifyTeamOfOwnerDecision(input.itemId))
  return result
}
