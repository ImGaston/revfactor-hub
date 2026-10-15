import "server-only"

import { isStepCount, Output, ToolLoopAgent } from "ai"
import type { SupabaseClient } from "@supabase/supabase-js"

import { isAiGatewayConfigured } from "@/lib/ai-gateway.server"
import {
  changeWindows,
  computeOutcome,
  dueCheckpoints,
  judgeOutcome,
  type ChangeSetLite,
  type ChangeWindow,
  type Checkpoint,
  type OutcomeMetrics,
  type OutcomeReservation,
  type OutcomeSnapshot,
  type OutcomeVerdict,
} from "@/lib/listing-outcomes"
import {
  OUTCOME_SUMMARY_INSTRUCTIONS,
  OUTCOME_SUMMARY_MODEL_ID,
  buildOutcomePrompt,
  outcomeSummarySchema,
  type OutcomeSummary,
} from "@/lib/listing-outcomes-summary"
import { planChannels } from "@/lib/listing-strategy"
import type { PlanChannel } from "@/lib/pricing-plan"

// Reservation columns only: never guest names or confirmation codes.
const RESERVATION_COLUMNS =
  "booked_at, check_in, check_out, number_of_days, booking_status, booking_channel, cancelled_at, rental_revenue, booking_window_days"
const SNAPSHOT_COLUMNS =
  "snapshot_date, occupancy_next_30, market_occupancy_next_30, occupancy_next_90, market_occupancy_next_90, mpi_next_30"
export const REVIEW_COLUMNS =
  "id, change_set_id, window_start, checkpoint_day, as_of, verdict, metrics, reasons, summary, suggestion, summary_model, generated_by, created_at, updated_at"

export type OutcomeReviewRow = {
  id: string
  change_set_id: string
  window_start: string
  checkpoint_day: Checkpoint
  as_of: string
  verdict: OutcomeVerdict
  metrics: OutcomeMetrics
  reasons: string[]
  summary: string | null
  suggestion: string | null
  summary_model: string | null
  generated_by: "cron" | "staff"
  created_at: string
  updated_at: string
}

export type OutcomeWindowView = {
  window: ChangeWindow
  live: { metrics: OutcomeMetrics; verdict: OutcomeVerdict; reasons: string[] }
  reviews: OutcomeReviewRow[]
}

export type ListingOutcomes = {
  asOf: string
  listingName: string
  windows: OutcomeWindowView[]
  /** False until migration 20261016120000_listing_outcomes is applied. */
  snapshotsEnabled: boolean
  reviewsEnabled: boolean
}

const isMissingTable = (e: { code?: string } | null) => e?.code === "PGRST205" || e?.code === "42P01"
export const todayUtc = () => new Date().toISOString().slice(0, 10)

type Inputs = {
  listingName: string
  reservations: OutcomeReservation[]
  floor: number | null
  channels: PlanChannel[]
  snapshots: OutcomeSnapshot[] | null
  changeSets: ChangeSetLite[]
}

/** Everything the outcome math needs for one listing. `client` is the session client (RLS) or admin. */
export async function loadOutcomeInputs(client: SupabaseClient, listingId: string): Promise<Inputs> {
  const [listing, reservations, plan, snapshots, sets, actions] = await Promise.all([
    client.from("listings").select("name").eq("id", listingId).maybeSingle(),
    client.from("pricelabs_reservations_cache").select(RESERVATION_COLUMNS).eq("hub_listing_id", listingId).limit(5000),
    client.from("listing_pricing_plans").select("floor_payout, channels").eq("listing_id", listingId).maybeSingle(),
    client
      .from("listing_daily_snapshots")
      .select(SNAPSHOT_COLUMNS)
      .eq("listing_id", listingId)
      .order("snapshot_date", { ascending: false })
      .limit(400),
    client
      .from("listing_setting_change_sets")
      .select("id, title, status, approved_at, created_at")
      .eq("listing_id", listingId),
    client
      .from("listing_setting_changes")
      .select("change_set_id, action")
      .eq("listing_id", listingId)
      .not("change_set_id", "is", null)
      .limit(2000),
  ])
  if (reservations.error) throw new Error(reservations.error.message)
  if (sets.error && !isMissingTable(sets.error)) throw new Error(sets.error.message)
  if (snapshots.error && !isMissingTable(snapshots.error)) throw new Error(snapshots.error.message)
  const floor = plan.data?.floor_payout != null ? Number(plan.data.floor_payout) : null
  return {
    listingName: (listing.data?.name as string | undefined) ?? "Listing",
    reservations: (reservations.data ?? []).map((r) => ({
      ...(r as OutcomeReservation),
      rental_revenue: r.rental_revenue == null ? null : Number(r.rental_revenue),
    })),
    floor: floor && floor > 0 ? floor : null,
    channels: planChannels((plan.data as { channels: PlanChannel[] } | null) ?? null),
    snapshots: snapshots.error ? null : ((snapshots.data ?? []) as OutcomeSnapshot[]).map(numericSnapshot),
    changeSets: markObservationOnly((sets.data ?? []) as ChangeSetLite[], actions.data ?? []),
  }
}

function markObservationOnly(sets: ChangeSetLite[], actions: { change_set_id: string | null; action: string }[]) {
  const real = new Set<string>()
  const any = new Set<string>()
  for (const a of actions) {
    if (!a.change_set_id) continue
    any.add(a.change_set_id)
    if (a.action !== "RecordObservation") real.add(a.change_set_id)
  }
  return sets.map((s) => ({ ...s, observationOnly: any.has(s.id) && !real.has(s.id) }))
}

function numericSnapshot(s: OutcomeSnapshot): OutcomeSnapshot {
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    snapshot_date: s.snapshot_date,
    occupancy_next_30: n(s.occupancy_next_30),
    market_occupancy_next_30: n(s.market_occupancy_next_30),
    occupancy_next_90: n(s.occupancy_next_90),
    market_occupancy_next_90: n(s.market_occupancy_next_90),
    mpi_next_30: n(s.mpi_next_30),
  }
}

function outcomeFor(inputs: Inputs, window: ChangeWindow, asOf: string) {
  const metrics = computeOutcome({
    reservations: inputs.reservations,
    windowStart: window.start,
    asOf,
    channels: inputs.channels,
    floor: inputs.floor,
    snapshots: inputs.snapshots ?? [],
  })
  return { metrics, ...judgeOutcome(metrics) }
}

/** Live outcome per tracked change window plus saved checkpoint reviews. */
export async function getListingOutcomes(
  client: SupabaseClient,
  listingId: string,
  asOf = todayUtc()
): Promise<ListingOutcomes> {
  const inputs = await loadOutcomeInputs(client, listingId)
  const windows = changeWindows(inputs.changeSets)
  const { data: reviews, error } = await client
    .from("listing_outcome_reviews")
    .select(REVIEW_COLUMNS)
    .eq("listing_id", listingId)
    .order("checkpoint_day")
  if (error && !isMissingTable(error)) throw new Error(error.message)
  return {
    asOf,
    listingName: inputs.listingName,
    snapshotsEnabled: inputs.snapshots !== null,
    reviewsEnabled: !error,
    windows: windows
      .filter((w) => w.start <= asOf)
      .reverse()
      .map((w) => ({
        window: w,
        live: outcomeFor(inputs, w, asOf),
        reviews: ((reviews ?? []) as OutcomeReviewRow[]).filter((r) => r.change_set_id === w.changeSetId),
      })),
  }
}

/** AI wording for computed numbers. Null when the gateway isn't configured or the call fails. */
export async function summarizeOutcome(input: {
  listingName: string
  window: ChangeWindow
  checkpointDay: number | null
  verdict: OutcomeVerdict
  reasons: string[]
  metrics: OutcomeMetrics
  userLabel: string
}): Promise<OutcomeSummary | null> {
  if (!isAiGatewayConfigured()) return null
  try {
    const agent = new ToolLoopAgent({
      id: "revfactor-listing-outcome-summary",
      model: OUTCOME_SUMMARY_MODEL_ID,
      instructions: OUTCOME_SUMMARY_INSTRUCTIONS,
      providerOptions: {
        gateway: {
          user: input.userLabel,
          tags: ["feature:listing-outcomes", `environment:${process.env.VERCEL_ENV ?? "development"}`],
        },
      },
      output: Output.object({ schema: outcomeSummarySchema }),
      stopWhen: isStepCount(1),
      maxOutputTokens: 600,
    })
    const result = await agent.generate({
      prompt: buildOutcomePrompt({
        listingName: input.listingName,
        windowTitles: input.window.titles,
        checkpointDay: input.checkpointDay,
        verdict: input.verdict,
        reasons: input.reasons,
        metrics: input.metrics,
      }),
      timeout: { totalMs: 30_000, stepMs: 30_000 },
    })
    const out = result.output
    return { summary: out.summary, suggestion: input.verdict === "on_track" || input.verdict === "too_early" ? null : out.suggestion }
  } catch (e) {
    console.error("listing outcomes: summary failed", e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Saves a checkpoint review (upsert on change set × checkpoint). The metrics
 * are as of the checkpoint day, so a late run still reports that day.
 */
export async function saveCheckpointReview(
  admin: SupabaseClient,
  input: {
    listingId: string
    inputs: Inputs
    window: ChangeWindow
    checkpoint: Checkpoint
    generatedBy: "cron" | "staff"
    userId?: string | null
    withSummary: boolean
  }
) {
  const asOf = new Date(Date.parse(`${input.window.start}T00:00:00Z`) + input.checkpoint * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const live = outcomeFor(input.inputs, input.window, asOf)
  const summary = input.withSummary
    ? await summarizeOutcome({
        listingName: input.inputs.listingName,
        window: input.window,
        checkpointDay: input.checkpoint,
        ...live,
        userLabel: input.generatedBy === "cron" ? "cron" : (input.userId ?? "staff"),
      })
    : null
  const { error } = await admin.from("listing_outcome_reviews").upsert(
    {
      listing_id: input.listingId,
      change_set_id: input.window.changeSetId,
      window_start: input.window.start,
      checkpoint_day: input.checkpoint,
      as_of: asOf,
      verdict: live.verdict,
      metrics: live.metrics,
      reasons: live.reasons,
      summary: summary?.summary ?? null,
      suggestion: summary?.suggestion ?? null,
      summary_model: summary ? OUTCOME_SUMMARY_MODEL_ID : null,
      generated_by: input.generatedBy,
      generated_by_user: input.userId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "change_set_id,checkpoint_day" }
  )
  if (error) throw new Error(error.message)
  return live.verdict
}

/**
 * Daily: copies today's PriceLabs numbers (already synced into listings.pl_*)
 * into listing_daily_snapshots so pace can be compared with the market later.
 */
export async function captureDailySnapshots(admin: SupabaseClient, today = todayUtc()) {
  const { data, error } = await admin
    .from("listings")
    .select(
      "id, pl_min_price, pl_base_price, pl_max_price, pl_recommended_base_price, pl_push_enabled, pl_occupancy_next_7, pl_market_occupancy_next_7, pl_occupancy_next_30, pl_market_occupancy_next_30, pl_occupancy_past_90, pl_market_occupancy_past_90, pl_wknd_occupancy_next_30, pl_market_wknd_occupancy_next_30, pl_mpi_next_30, pl_mpi_next_60, pl_last_booked_date, pl_last_refreshed_at, pl_synced_at"
    )
    .gte("pl_synced_at", `${today}T00:00:00Z`)
  if (error) throw new Error(error.message)
  const rows = (data ?? []).map((l) => ({
    listing_id: l.id,
    snapshot_date: today,
    min_price: l.pl_min_price,
    base_price: l.pl_base_price,
    max_price: l.pl_max_price,
    recommended_base_price: l.pl_recommended_base_price,
    push_enabled: l.pl_push_enabled,
    occupancy_next_7: l.pl_occupancy_next_7,
    market_occupancy_next_7: l.pl_market_occupancy_next_7,
    occupancy_next_30: l.pl_occupancy_next_30,
    market_occupancy_next_30: l.pl_market_occupancy_next_30,
    // pl_occupancy_past_90 holds PriceLabs' adjusted_occupancy_next_90 (see buildPriceLabsUpdate).
    occupancy_next_90: l.pl_occupancy_past_90,
    market_occupancy_next_90: l.pl_market_occupancy_past_90,
    wknd_occupancy_next_30: l.pl_wknd_occupancy_next_30,
    market_wknd_occupancy_next_30: l.pl_market_wknd_occupancy_next_30,
    mpi_next_30: l.pl_mpi_next_30,
    mpi_next_60: l.pl_mpi_next_60,
    last_booked_date: l.pl_last_booked_date,
    pricelabs_refreshed_at: l.pl_last_refreshed_at,
    captured_at: new Date().toISOString(),
  }))
  if (rows.length === 0) return { captured: 0, enabled: true }
  const { error: upErr } = await admin
    .from("listing_daily_snapshots")
    .upsert(rows, { onConflict: "listing_id,snapshot_date" })
  if (upErr) {
    if (isMissingTable(upErr)) return { captured: 0, enabled: false }
    throw new Error(upErr.message)
  }
  return { captured: rows.length, enabled: true }
}

/** Daily: saves every due checkpoint (day 7/14/30/60/90) for listings with tracked changes. */
export async function runOutcomeCheckpoints(
  admin: SupabaseClient,
  { today = todayUtc(), deadline, listingIds }: { today?: string; deadline?: number; listingIds?: string[] } = {}
) {
  const result = { saved: 0, errors: [] as string[], enabled: true }
  let q = admin
    .from("listing_setting_change_sets")
    .select("listing_id, id, title, status, approved_at, created_at")
  if (listingIds) q = q.in("listing_id", listingIds)
  const { data: sets, error } = await q
  if (error) {
    if (!isMissingTable(error)) result.errors.push(error.message)
    return result
  }
  const { data: done, error: rErr } = await admin.from("listing_outcome_reviews").select("change_set_id, checkpoint_day")
  if (rErr) {
    if (isMissingTable(rErr)) return { ...result, enabled: false }
    result.errors.push(rErr.message)
    return result
  }
  const doneBySet = new Map<string, number[]>()
  for (const r of done ?? []) doneBySet.set(r.change_set_id, [...(doneBySet.get(r.change_set_id) ?? []), r.checkpoint_day])

  const { data: actions } = await admin
    .from("listing_setting_changes")
    .select("change_set_id, action")
    .in("change_set_id", (sets ?? []).map((s) => s.id))
  const marked = markObservationOnly((sets ?? []) as ChangeSetLite[], actions ?? [])
  const byListing = new Map<string, ChangeSetLite[]>()
  for (const s of sets ?? []) {
    const m = marked.find((x) => x.id === s.id)!
    byListing.set(s.listing_id, [...(byListing.get(s.listing_id) ?? []), m])
  }

  for (const [listingId, listingSets] of byListing) {
    const due = changeWindows(listingSets)
      .map((w) => ({ w, checkpoints: dueCheckpoints(w.start, today, doneBySet.get(w.changeSetId) ?? []) }))
      .filter((d) => d.checkpoints.length > 0)
    if (due.length === 0) continue
    let inputs: Inputs
    try {
      inputs = await loadOutcomeInputs(admin, listingId)
    } catch (e) {
      result.errors.push(`${listingId}: ${e instanceof Error ? e.message : "load failed"}`)
      continue
    }
    for (const { w, checkpoints } of due) {
      for (const checkpoint of checkpoints) {
        if (deadline && Date.now() > deadline) {
          result.errors.push("Stopped early: time budget used up")
          return result
        }
        try {
          // Only the newest due checkpoint gets an AI summary; catch-up rows stay numbers-only.
          const newest = checkpoint === checkpoints[checkpoints.length - 1]
          await saveCheckpointReview(admin, { listingId, inputs, window: w, checkpoint, generatedBy: "cron", withSummary: newest })
          result.saved++
        } catch (e) {
          result.errors.push(`${listingId} day ${checkpoint}: ${e instanceof Error ? e.message : "save failed"}`)
        }
      }
    }
  }
  return result
}
