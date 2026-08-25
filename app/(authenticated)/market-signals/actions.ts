"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { distanceMiles } from "@/lib/market-signals/domain"
import {
  generateMarketSignalBriefForImpact,
  getMarketSignalBriefRuntimeStatus,
} from "@/lib/market-signals/briefs.server"
import { getMarketSignalsRuntimeStatus } from "@/lib/market-signals/ingest.server"
import { enqueueMarketSignalJobs } from "@/lib/market-signals/jobs.server"
import { hasPermission } from "@/lib/permissions.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"

const marketIdSchema = z.uuid()
const impactIdSchema = z.uuid()
const briefIdSchema = z.uuid()
const listingIdSchema = z.uuid()
const reviewDecisionSchema = z.enum(["watch", "dismissed", "escalated"])

async function requireEditor() {
  const [canEdit, profile] = await Promise.all([
    hasPermission("market_signals", "edit"),
    getProfile(),
  ])
  if (!canEdit || !profile) throw new Error("Unauthorized")
  return profile
}

function parseMarketId(value: string) {
  const result = marketIdSchema.safeParse(value)
  if (!result.success) throw new Error("Invalid market")
  return result.data
}

function parseId(schema: z.ZodUUID, value: string, label: string) {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(`Invalid ${label}`)
  return result.data
}

function adjustmentIdFromValue(value: string) {
  const trimmed = value.trim()
  const direct = z.uuid().safeParse(trimmed)
  if (direct.success) return direct.data
  const match = trimmed.match(/\/adjustments\/([0-9a-f-]{36})(?:[/?#]|$)/i)
  const parsed = z.uuid().safeParse(match?.[1])
  if (!parsed.success) {
    throw new Error("Paste a valid Adjustment URL or ID")
  }
  return parsed.data
}

async function loadDecisionEvidence(
  supabase: Awaited<ReturnType<typeof createClient>>,
  impactId: string,
  briefId: string
) {
  const [impactResult, briefResult] = await Promise.all([
    supabase
      .from("market_event_impacts")
      .select(
        `
          id, action_gate, materiality_score, vulnerability_score,
          impact_start, impact_end, evidence_freshness,
          event:market_events!inner(title, category, state),
          market:revenue_markets!inner(name)
        `
      )
      .eq("id", impactId)
      .eq("status", "active")
      .single(),
    supabase
      .from("market_signal_briefs")
      .select(
        "id, impact_id, input_hash, prompt_version, model_id, generated_at"
      )
      .eq("id", briefId)
      .eq("impact_id", impactId)
      .eq("status", "completed")
      .single(),
  ])
  if (impactResult.error || !impactResult.data) {
    throw new Error("This signal is no longer available for review")
  }
  if (briefResult.error || !briefResult.data) {
    throw new Error("A completed current Signal Brief is required")
  }
  return {
    impact: impactResult.data,
    brief: briefResult.data,
  }
}

function decisionReason(decision: z.infer<typeof reviewDecisionSchema>) {
  if (decision === "watch") {
    return "Reviewer chose to continue monitoring without creating a commercial action."
  }
  if (decision === "dismissed") {
    return "Reviewer dismissed the current signal after reviewing the available evidence."
  }
  return "Reviewer escalated the signal for internal revenue-management review."
}

export async function recordMarketSignalDecisionAction(input: {
  impactId: string
  briefId: string
  decision: string
}) {
  try {
    const impactId = parseId(impactIdSchema, input.impactId, "signal")
    const briefId = parseId(briefIdSchema, input.briefId, "Signal Brief")
    const parsedDecision = reviewDecisionSchema.safeParse(input.decision)
    if (!parsedDecision.success) throw new Error("Invalid review decision")
    const profile = await requireEditor()
    const supabase = await createClient()
    const evidence = await loadDecisionEvidence(supabase, impactId, briefId)
    const { error } = await supabase.from("market_signal_reviews").insert({
      impact_id: impactId,
      brief_id: briefId,
      decision: parsedDecision.data,
      reason: decisionReason(parsedDecision.data),
      evidence_snapshot: evidence,
      created_by: profile.id,
    })
    if (error?.code === "23505") {
      return {
        error: "This Signal Brief has already been reviewed",
        message: null,
      }
    }
    if (error) return { error: error.message, message: null }

    revalidatePath("/market-signals")
    return {
      error: null,
      message:
        parsedDecision.data === "watch"
          ? "Signal moved to Reviewed and remains monitored."
          : parsedDecision.data === "dismissed"
            ? "Signal dismissed for this evidence version."
            : "Signal escalated for internal review.",
    }
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to record decision",
      message: null,
    }
  }
}

export async function createMarketSignalAdjustmentAction(input: {
  impactId: string
  briefId: string
  listingId: string
}) {
  try {
    const impactId = parseId(impactIdSchema, input.impactId, "signal")
    const briefId = parseId(briefIdSchema, input.briefId, "Signal Brief")
    const listingId = parseId(listingIdSchema, input.listingId, "listing")
    await requireEditor()
    if (!(await hasPermission("adjustments", "create"))) {
      throw new Error("You do not have permission to create Adjustments")
    }
    const supabase = await createClient()
    const { data, error } = await supabase.rpc(
      "create_market_signal_adjustment",
      {
        p_impact_id: impactId,
        p_brief_id: briefId,
        p_listing_id: listingId,
        p_reason:
          "Reviewer created a bounded Adjustment to verify event-window pricing, inventory, stay rules, and restrictions before approving any change.",
      }
    )
    if (error) throw new Error(error.message)
    const adjustment = Array.isArray(data) ? data[0] : data
    const adjustmentId = adjustment?.adjustment_id as string | undefined
    if (!adjustmentId) throw new Error("The Adjustment could not be created")

    revalidatePath("/market-signals")
    revalidatePath("/adjustments")
    return {
      error: null,
      message: "Adjustment created for human review; no live setting changed.",
      adjustmentId,
    }
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to create Adjustment",
      message: null,
      adjustmentId: null,
    }
  }
}

export async function linkMarketSignalAdjustmentAction(input: {
  impactId: string
  briefId: string
  adjustment: string
}) {
  try {
    const impactId = parseId(impactIdSchema, input.impactId, "signal")
    const briefId = parseId(briefIdSchema, input.briefId, "Signal Brief")
    const adjustmentId = adjustmentIdFromValue(input.adjustment)
    await requireEditor()
    if (!(await hasPermission("adjustments", "view"))) {
      throw new Error("You do not have permission to view Adjustments")
    }
    const supabase = await createClient()
    const { error } = await supabase.rpc("link_market_signal_adjustment", {
      p_impact_id: impactId,
      p_brief_id: briefId,
      p_adjustment_id: adjustmentId,
      p_reason:
        "Reviewer linked an existing open Adjustment to this Signal Brief.",
    })
    if (error) throw new Error(error.message)

    revalidatePath("/market-signals")
    revalidatePath("/adjustments")
    return {
      error: null,
      message: "Existing Adjustment linked to this signal.",
      adjustmentId,
    }
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to link Adjustment",
      message: null,
      adjustmentId: null,
    }
  }
}

export async function retryMarketSignalBriefAction(impactIdValue: string) {
  try {
    const impactId = parseId(impactIdSchema, impactIdValue, "signal")
    await requireEditor()
    if (!getMarketSignalBriefRuntimeStatus().configured) {
      throw new Error("AI Gateway is not configured")
    }
    const result = await generateMarketSignalBriefForImpact(
      createAdminClient(),
      impactId
    )
    if (result.status === "failed") {
      throw new Error(result.error ?? "Signal Brief generation failed")
    }
    revalidatePath("/market-signals")
    return {
      error: null,
      message:
        result.status === "cached"
          ? "The current Signal Brief was already cached."
          : result.status === "pending"
            ? "Signal Brief generation is already in progress."
            : "Signal Brief generated.",
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to generate Signal Brief",
      message: null,
    }
  }
}

export async function prepareMarketPilotAction(marketIdValue: string) {
  try {
    const marketId = parseMarketId(marketIdValue)
    const profile = await requireEditor()
    if (!getMarketSignalsRuntimeStatus().serviceRoleConfigured) {
      return {
        error: "SUPABASE_SERVICE_ROLE_KEY is not configured",
        message: null,
      }
    }
    const admin = createAdminClient()
    const [
      { data: market, error: marketError },
      listingsResult,
      membersResult,
      activeListingsResult,
    ] = await Promise.all([
      admin
        .from("revenue_markets")
        .select("id, center_lat, center_lon, radius_miles, status")
        .eq("id", marketId)
        .single(),
      admin
        .from("report_listings")
        .select("hub_listing_id, latitude, longitude")
        .not("hub_listing_id", "is", null)
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .eq("sync_on", true),
      admin
        .from("revenue_market_listings")
        .select("listing_id")
        .eq("market_id", marketId),
      admin.from("listings").select("id").eq("status", "active"),
    ])

    if (marketError || !market) {
      return {
        error: marketError?.message ?? "Market not found",
        message: null,
      }
    }
    if (market.status === "active") {
      return { error: "The market is already active", message: null }
    }
    if (listingsResult.error) {
      return { error: listingsResult.error.message, message: null }
    }
    if (membersResult.error) {
      return { error: membersResult.error.message, message: null }
    }
    if (activeListingsResult.error) {
      return { error: activeListingsResult.error.message, message: null }
    }

    const existing = new Set(
      (membersResult.data ?? []).map((member) => member.listing_id as string)
    )
    const activeListings = new Set(
      (activeListingsResult.data ?? []).map((listing) => listing.id as string)
    )
    const center = {
      latitude: Number(market.center_lat),
      longitude: Number(market.center_lon),
    }
    const radiusMiles = Number(market.radius_miles)
    const proposalsByListing = new Map<
      string,
      {
        market_id: string
        listing_id: string
        distance_miles: number
        assignment_source: "coordinate_import"
        membership_status: "proposed"
        assigned_by: string
      }
    >()
    for (const listing of listingsResult.data ?? []) {
      const listingId = listing.hub_listing_id as string | null
      const latitude = Number(listing.latitude)
      const longitude = Number(listing.longitude)
      if (
        !listingId ||
        existing.has(listingId) ||
        !activeListings.has(listingId)
      ) {
        continue
      }
      const distance = distanceMiles(center, { latitude, longitude })
      if (distance > radiusMiles) continue
      const prior = proposalsByListing.get(listingId)
      if (!prior || distance < prior.distance_miles) {
        proposalsByListing.set(listingId, {
          market_id: marketId,
          listing_id: listingId,
          distance_miles: Math.round(distance * 100) / 100,
          assignment_source: "coordinate_import",
          membership_status: "proposed",
          assigned_by: profile.id,
        })
      }
    }
    const proposals = Array.from(proposalsByListing.values())

    if (proposals.length > 0) {
      const { error } = await admin
        .from("revenue_market_listings")
        .insert(proposals)
      if (error) return { error: error.message, message: null }
    }

    revalidatePath("/market-signals")
    return {
      error: null,
      message:
        proposals.length > 0
          ? `${proposals.length} coordinate-matched listings are ready for review.`
          : "No new coordinate-matched listings were found inside this market radius.",
    }
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to prepare market",
      message: null,
    }
  }
}

export async function activateMarketPilotAction(marketIdValue: string) {
  try {
    const marketId = parseMarketId(marketIdValue)
    const profile = await requireEditor()
    const supabase = await createClient()
    const reviewedAt = new Date().toISOString()
    const { data: proposed, error: proposedError } = await supabase
      .from("revenue_market_listings")
      .select("listing_id")
      .eq("market_id", marketId)
      .eq("membership_status", "proposed")
    if (proposedError) return { error: proposedError.message, message: null }
    if (!proposed || proposed.length === 0) {
      return {
        error: "Prepare and review at least one listing before activation",
        message: null,
      }
    }

    const { error: membershipError } = await supabase
      .from("revenue_market_listings")
      .update({
        membership_status: "approved",
        reviewed_by: profile.id,
        reviewed_at: reviewedAt,
      })
      .eq("market_id", marketId)
      .eq("membership_status", "proposed")
    if (membershipError)
      return { error: membershipError.message, message: null }

    const { error: marketError } = await supabase
      .from("revenue_markets")
      .update({
        status: "active",
        reviewed_by: profile.id,
        reviewed_at: reviewedAt,
        updated_by: profile.id,
      })
      .eq("id", marketId)
    if (marketError) return { error: marketError.message, message: null }

    revalidatePath("/market-signals")
    return {
      error: null,
      message: `${proposed.length} listings approved. The market is active; PredictHQ remains disabled until its rotated token is configured.`,
    }
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to activate market",
      message: null,
    }
  }
}

export async function syncMarketSignalsAction(marketIdValue: string) {
  try {
    const marketId = parseMarketId(marketIdValue)
    await requireEditor()
    const runtime = getMarketSignalsRuntimeStatus()
    if (!runtime.ready) {
      return {
        error:
          "Market Signals requires SUPABASE_SERVICE_ROLE_KEY and PREDICTHQ_ACCESS_TOKEN",
        message: null,
      }
    }
    await enqueueMarketSignalJobs(createAdminClient(), {
      reason: "manual",
      marketId,
      priority: 90,
    })
    revalidatePath("/market-signals")
    return {
      error: null,
      message:
        "Market refresh queued. The agent worker will process it with retry protection.",
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to sync market",
      message: null,
    }
  }
}
