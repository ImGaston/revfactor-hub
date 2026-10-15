"use server"

import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import { changeWindows, computeOutcome, judgeOutcome } from "@/lib/listing-outcomes"
import {
  getListingOutcomes,
  loadOutcomeInputs,
  summarizeOutcome,
  todayUtc,
  type ListingOutcomes,
} from "@/lib/listing-outcomes.server"
import type { OutcomeSummary } from "@/lib/listing-outcomes-summary"

type Result<T> = ({ ok: true } & T) | { ok: false; error: string }

/** Results for the Setup tab, loaded when it opens (reservation revenue → reservations:view). */
export async function getListingOutcomesAction(listingId: string): Promise<Result<{ outcomes: ListingOutcomes }>> {
  const [canListings, canReservations] = await Promise.all([
    hasPermission("listings", "view"),
    hasPermission("reservations", "view"),
  ])
  if (!canListings || !canReservations) return { ok: false, error: "You don't have permission to view results." }
  try {
    const outcomes = await getListingOutcomes(await createClient(), listingId)
    return { ok: true, outcomes }
  } catch (e) {
    console.error("listing outcomes: load failed", e)
    return { ok: false, error: "Couldn't load results. Try again in a moment." }
  }
}

/** An AI-written summary of today's numbers for one window. Not saved; checkpoints are saved by the daily cron. */
export async function summarizeOutcomeNowAction(
  listingId: string,
  changeSetId: string
): Promise<Result<{ summary: OutcomeSummary }>> {
  const [canEdit, canReservations] = await Promise.all([
    hasPermission("listings", "edit"),
    hasPermission("reservations", "view"),
  ])
  if (!canEdit || !canReservations) return { ok: false, error: "You don't have permission to do that." }
  const profile = await getProfile()
  try {
    const inputs = await loadOutcomeInputs(await createClient(), listingId)
    const window = changeWindows(inputs.changeSets).find((w) => w.changeSetId === changeSetId)
    if (!window) return { ok: false, error: "That change window no longer exists." }
    const metrics = computeOutcome({
      reservations: inputs.reservations,
      windowStart: window.start,
      asOf: todayUtc(),
      channels: inputs.channels,
      floor: inputs.floor,
      snapshots: inputs.snapshots ?? [],
    })
    const judged = judgeOutcome(metrics)
    const summary = await summarizeOutcome({
      listingName: inputs.listingName,
      window,
      checkpointDay: null,
      metrics,
      ...judged,
      userLabel: profile?.id ?? "staff",
    })
    if (!summary) return { ok: false, error: "The AI summary isn't available right now." }
    return { ok: true, summary }
  } catch (e) {
    console.error("listing outcomes: summary failed", e)
    return { ok: false, error: "Couldn't write the summary." }
  }
}
