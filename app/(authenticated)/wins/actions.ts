"use server"

// Server Actions for the Wins dashboard.
//
// Every action re-checks its permission server-side. Hiding a button is a UX
// affordance, not an access control, and RLS alone does not cover the actions
// that read the Assembly deep link or call the aggregation RPC.
//
// This module deliberately imports nothing from lib/assembly.ts: the feature
// is read-only with respect to Assembly, and not importing the API client is
// the cheapest way to keep it that way.

import { revalidatePath } from "next/cache"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { runWinsDetection } from "@/lib/wins-detection.server"
import { buildWinMessage } from "@/lib/wins-message"
import { getWinCandidate } from "@/lib/wins-queries"
import {
  WIN_EVENT_TYPES,
  WIN_REVIEW_STATES,
  buildAssemblyDeepLink,
  type WinEventType,
  type WinReviewState,
} from "@/lib/wins"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_MESSAGE_LENGTH = 2000
const MAX_DISMISS_REASON = 500

type ActionResult<T extends object = object> = { error: string } | ({ success: true } & T)

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

/** Run detection and persist a new snapshot. */
export async function runWinsDetectionAction(
  periodMonths?: number
): Promise<ActionResult<{ runId: string; candidateCount: number }>> {
  const { supabase, user } = await requireUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("wins", "edit"))) {
    return { error: "You do not have permission to run detection" }
  }

  const months = Number.isInteger(periodMonths) ? Number(periodMonths) : 3
  if (months < 1 || months > 12) return { error: "Period must be between 1 and 12 months" }

  try {
    const result = await runWinsDetection(supabase, {
      userId: user.id,
      periodMonths: months,
      triggeredBy: "manual",
    })
    revalidatePath("/wins")
    return { success: true, runId: result.runId, candidateCount: result.candidateCount }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Detection failed" }
  }
}

/**
 * Compose the suggested message for a candidate and persist it as a new draft.
 *
 * Drafts are append-only: regenerating writes a new row rather than mutating
 * the old one, so a message someone already copied keeps the exact figures it
 * was built from.
 */
export async function generateWinMessageAction(
  candidateId: string
): Promise<ActionResult<{ draftId: string; body: string }>> {
  if (!UUID_RE.test(candidateId)) return { error: "Invalid candidate" }
  const { supabase, user } = await requireUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("wins", "edit"))) {
    return { error: "You do not have permission to generate messages" }
  }

  const candidate = await getWinCandidate(supabase, candidateId)
  if (!candidate) return { error: "Win not found" }

  const composed = buildWinMessage(candidate)
  if (!composed) {
    return { error: "This category does not produce a client message" }
  }

  const { data, error } = await supabase
    .from("win_message_drafts")
    .insert({
      candidate_id: candidate.id,
      client_id: candidate.client_id,
      scope: "listing",
      template_key: composed.templateKey,
      template_version: composed.templateVersion,
      generated_body: composed.body,
      // Frozen at generation time. Editing the body must never touch this.
      evidence_snapshot: candidate.evidence,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error || !data) return { error: error?.message ?? "Could not save the draft" }

  await supabase.from("win_events").insert({
    candidate_id: candidate.id,
    draft_id: data.id,
    event_type: "message_generated",
    actor_id: user.id,
    metadata: { template_key: composed.templateKey, length: composed.body.length },
  })

  return { success: true, draftId: data.id as string, body: composed.body }
}

/** Persist a manually edited body as a new draft revision. */
export async function saveEditedMessageAction(
  candidateId: string,
  body: string
): Promise<ActionResult<{ draftId: string }>> {
  if (!UUID_RE.test(candidateId)) return { error: "Invalid candidate" }
  const trimmed = body.trim()
  if (!trimmed) return { error: "Message cannot be empty" }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { error: `Message must be under ${MAX_MESSAGE_LENGTH} characters` }
  }

  const { supabase, user } = await requireUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("wins", "edit"))) {
    return { error: "You do not have permission to edit messages" }
  }

  const candidate = await getWinCandidate(supabase, candidateId)
  if (!candidate) return { error: "Win not found" }

  const composed = buildWinMessage(candidate)
  const { data, error } = await supabase
    .from("win_message_drafts")
    .insert({
      candidate_id: candidate.id,
      client_id: candidate.client_id,
      scope: "listing",
      template_key: composed?.templateKey ?? "manual.v1",
      template_version: composed?.templateVersion ?? "v1",
      generated_body: composed?.body ?? trimmed,
      edited_body: trimmed,
      evidence_snapshot: candidate.evidence,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error || !data) return { error: error?.message ?? "Could not save the draft" }

  await supabase.from("win_events").insert({
    candidate_id: candidate.id,
    draft_id: data.id,
    event_type: "message_edited",
    actor_id: user.id,
    // Length only. The body itself never goes into the audit metadata.
    metadata: { length: trimmed.length },
  })

  return { success: true, draftId: data.id as string }
}

/**
 * Record a user-intent event.
 *
 * `copied` and `assembly_opened` are NOT delivery confirmations. The Hub has
 * no visibility into Assembly, so neither event may ever be presented, stored,
 * or aggregated as "sent". Only `marked_shared` records a human assertion, and
 * it is written by its own explicit action below.
 */
export async function recordWinEventAction(
  candidateId: string,
  eventType: WinEventType,
  draftId?: string | null
): Promise<ActionResult> {
  if (!UUID_RE.test(candidateId)) return { error: "Invalid candidate" }
  if (!WIN_EVENT_TYPES.includes(eventType)) return { error: "Invalid event type" }
  if (eventType === "marked_shared") {
    return { error: "Use markWinSharedAction to record a manual share" }
  }
  if (draftId && !UUID_RE.test(draftId)) return { error: "Invalid draft" }

  const { supabase, user } = await requireUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("wins", "view"))) return { error: "Not authorized" }

  // The deep link is only ever handed to wins:control, so opening it is too.
  if (eventType === "assembly_opened" && !(await hasPermission("wins", "control"))) {
    return { error: "Not authorized" }
  }

  const { error } = await supabase.from("win_events").insert({
    candidate_id: candidateId,
    draft_id: draftId ?? null,
    event_type: eventType,
    actor_id: user.id,
    metadata: {},
  })
  if (error) return { error: error.message }
  return { success: true }
}

/**
 * Record that a person says they shared the message in Assembly.
 *
 * This is the only signal in the system that a message reached a client, and
 * it is a human assertion, not an observation.
 */
export async function markWinSharedAction(
  candidateId: string,
  expectedVersion?: number
): Promise<ActionResult> {
  if (!UUID_RE.test(candidateId)) return { error: "Invalid candidate" }

  const { supabase, user } = await requireUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("wins", "control"))) {
    return { error: "You do not have permission to mark wins as shared" }
  }

  const candidate = await getWinCandidate(supabase, candidateId)
  if (!candidate?.hub_listing_id) return { error: "Win not found" }

  const result = await upsertReview(
    supabase,
    candidate.hub_listing_id,
    candidate.id,
    user.id,
    "shared_manually",
    null,
    expectedVersion
  )
  if ("error" in result) return result

  await supabase.from("win_events").insert({
    candidate_id: candidate.id,
    event_type: "marked_shared",
    actor_id: user.id,
    metadata: {},
  })

  revalidatePath("/wins")
  return { success: true }
}

export async function updateWinReviewAction(
  candidateId: string,
  state: WinReviewState,
  dismissReason?: string | null,
  expectedVersion?: number
): Promise<ActionResult> {
  if (!UUID_RE.test(candidateId)) return { error: "Invalid candidate" }
  if (!WIN_REVIEW_STATES.includes(state)) return { error: "Invalid state" }
  if (state === "shared_manually") {
    return { error: "Use markWinSharedAction to record a manual share" }
  }
  if (state === "dismissed" && !dismissReason?.trim()) {
    return { error: "A reason is required to dismiss a win" }
  }
  const reason = dismissReason?.trim().slice(0, MAX_DISMISS_REASON) ?? null

  const { supabase, user } = await requireUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("wins", "edit"))) {
    return { error: "You do not have permission to update wins" }
  }

  const candidate = await getWinCandidate(supabase, candidateId)
  if (!candidate?.hub_listing_id) return { error: "Win not found" }

  const result = await upsertReview(
    supabase,
    candidate.hub_listing_id,
    candidate.id,
    user.id,
    state,
    reason,
    expectedVersion
  )
  if ("error" in result) return result

  if (state === "dismissed" || state === "new") {
    await supabase.from("win_events").insert({
      candidate_id: candidate.id,
      event_type: state === "dismissed" ? "dismissed" : "reopened",
      actor_id: user.id,
      metadata: {},
    })
  }

  revalidatePath("/wins")
  return { success: true }
}

/**
 * Upsert review state with optimistic concurrency.
 *
 * Review state hangs off the listing rather than the candidate so it survives
 * recomputes; the version guard is what stops two reviewers working the same
 * win from silently overwriting each other.
 */
async function upsertReview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  hubListingId: string,
  candidateId: string,
  userId: string,
  state: WinReviewState,
  dismissReason: string | null,
  expectedVersion?: number
): Promise<ActionResult> {
  const { data: existing } = await supabase
    .from("win_reviews")
    .select("id, version")
    .eq("hub_listing_id", hubListingId)
    .maybeSingle()

  if (!existing) {
    const { error } = await supabase.from("win_reviews").insert({
      hub_listing_id: hubListingId,
      state,
      dismiss_reason: dismissReason,
      last_candidate_id: candidateId,
      updated_by: userId,
    })
    if (error) return { error: error.message }
    return { success: true }
  }

  if (expectedVersion != null && existing.version !== expectedVersion) {
    return { error: "Another user already updated this win. Refresh and try again." }
  }

  const { data: updated, error } = await supabase
    .from("win_reviews")
    .update({
      state,
      dismiss_reason: dismissReason,
      last_candidate_id: candidateId,
      updated_by: userId,
      version: (existing.version as number) + 1,
    })
    .eq("id", existing.id)
    .eq("version", existing.version)
    .select("id")

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: "Another user already updated this win. Refresh and try again." }
  }
  return { success: true }
}

/**
 * Resolve the Assembly chat URL for a candidate.
 *
 * Gated on wins:control and re-derived server-side rather than trusted from
 * the client, so a crafted request cannot point the button at another client's
 * conversation.
 */
export async function getAssemblyLinkAction(
  candidateId: string
): Promise<ActionResult<{ url: string | null }>> {
  if (!UUID_RE.test(candidateId)) return { error: "Invalid candidate" }

  const { supabase, user } = await requireUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("wins", "control"))) return { error: "Not authorized" }

  const candidate = await getWinCandidate(supabase, candidateId)
  if (!candidate?.client_id) return { success: true, url: null }

  const { data: client } = await supabase
    .from("clients")
    .select("assembly_client_id, assembly_company_id")
    .eq("id", candidate.client_id)
    .maybeSingle()

  return { success: true, url: client ? buildAssemblyDeepLink(client) : null }
}
