import "server-only"

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  getWinsSlackChannelId,
  isSlackConfigured,
  postSlackMessage,
} from "@/lib/slack"
import {
  buildWinMessageForCandidate,
  publicListingName,
  sanitizeText,
  shortenListingName,
} from "@/lib/wins-message"
import { getLatestWinsRun } from "@/lib/wins-queries"
import type { WinCandidate, WinCategory } from "@/lib/wins"

export const WINS_SLACK_SKIP_REASONS = [
  "no_template",
  "blocked",
  "already_delivered",
  "slack_not_configured",
  "slack_post_failed",
  "dry_run",
] as const

export type WinsSlackSkipReason = (typeof WINS_SLACK_SKIP_REASONS)[number]

export type WinsSlackDeliverySummary = {
  runId: string | null
  channelId: string
  considered: number
  sent: number
  skipped: number
  failed: number
  wouldSend: number
}

export type WinSlackPayload = {
  header: string
  text: string
  payloadHash: string
}

const CATEGORY_LABELS: Record<WinCategory, string> = {
  double_win: "Double Win",
  yoy_positive_steady: "YoY Positive Steady",
  market_compass_candidate: "Market Compass",
  conflicting_signal: "Conflicting Signal",
  insufficient_data: "Insufficient Data",
  no_win: "No Win",
}

const CANDIDATE_SELECT =
  "id, run_id, hub_listing_id, pricelabs_listing_id, client_id, listing_name_snapshot, client_name_snapshot, category, confidence, pickup_trend, reason_codes, is_blocked, priority_rank, evidence, created_at"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function hashWinSlackPayload(channelId: string, text: string): string {
  return createHash("sha256").update(`${channelId}\n${text}`).digest("hex")
}

/**
 * Strip broadcast mentions, Airbnb URLs, and credential-shaped tokens.
 *
 * The templates already use public listing names and evidence figures only;
 * this is the last gate before Slack so a future template cannot page the
 * channel or leak an address URL.
 */
export function sanitizeSlackWinText(value: string): string {
  return value
    .replace(/[<>]/g, "")
    .replace(/&(?:[a-z]+|#\d+);/gi, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, " ")
    .replace(/@(?:channel|here|everyone)\b/gi, "")
    .replace(/https?:\/\/(?:www\.)?airbnb\.com\/\S+/gi, "")
    .replace(/\b(?:xox[baprs]-|sk-|rvf_live_)[A-Za-z0-9-]+\b/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function buildWinSlackPayload(
  candidate: WinCandidate,
  body: string,
  channelId: string
): WinSlackPayload {
  const listing = shortenListingName(publicListingName(candidate.listing_name_snapshot))
  const period = sanitizeText(candidate.evidence.period.label)
  const header = `Win · ${CATEGORY_LABELS[candidate.category]} · ${listing} · ${period}`
  const text = sanitizeSlackWinText(`${header}\n\n${body}`)
  return {
    header,
    text,
    payloadHash: hashWinSlackPayload(channelId, text),
  }
}

/**
 * Reconstruct a sent delivery from the stranger-test triple:
 * Slack channel ID + Slack message ts + win_candidates.id.
 */
export async function findWinSlackDelivery(
  supabase: SupabaseClient,
  input: { candidateId: string; channelId: string; slackTs: string }
): Promise<{
  id: string
  candidate_id: string
  channel_id: string
  slack_ts: string
  status: "sent"
} | null> {
  if (!UUID_RE.test(input.candidateId)) return null
  const { data } = await supabase
    .from("win_slack_deliveries")
    .select("id, candidate_id, channel_id, slack_ts, status")
    .eq("candidate_id", input.candidateId)
    .eq("channel_id", input.channelId)
    .eq("slack_ts", input.slackTs)
    .eq("status", "sent")
    .maybeSingle()
  if (!data?.id || !data.slack_ts) return null
  return {
    id: data.id as string,
    candidate_id: data.candidate_id as string,
    channel_id: data.channel_id as string,
    slack_ts: data.slack_ts as string,
    status: "sent",
  }
}

export async function deliverWinSlackNotes(opts: {
  supabase: SupabaseClient
  runId?: string
  dryRun?: boolean
  actorId?: string | null
}): Promise<WinsSlackDeliverySummary> {
  const channelId = getWinsSlackChannelId()
  const empty: WinsSlackDeliverySummary = {
    runId: null,
    channelId,
    considered: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    wouldSend: 0,
  }

  const runId = await resolveCompletedRunId(opts.supabase, opts.runId)
  if (!runId) return empty

  const candidates = await fetchRunCandidates(opts.supabase, runId)
  const sentIds = await fetchSentCandidateIds(opts.supabase, candidates, channelId)

  const summary: WinsSlackDeliverySummary = {
    runId,
    channelId,
    considered: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    wouldSend: 0,
  }

  const slackReady = isSlackConfigured()

  for (const candidate of candidates) {
    const skip = classifySkip(candidate, sentIds.has(candidate.id))
    if (skip) {
      summary.skipped++
      if (!opts.dryRun && skip !== "already_delivered") {
        await writeDelivery(opts.supabase, {
          candidateId: candidate.id,
          channelId,
          status: "skipped",
          skipReason: skip,
          payloadHash: hashWinSlackPayload(channelId, skip),
        })
      }
      continue
    }

    const composed = buildWinMessageForCandidate(candidate)
    if (!composed) {
      summary.skipped++
      if (!opts.dryRun) {
        await writeDelivery(opts.supabase, {
          candidateId: candidate.id,
          channelId,
          status: "skipped",
          skipReason: "no_template",
          payloadHash: hashWinSlackPayload(channelId, "no_template"),
        })
      }
      continue
    }

    const payload = buildWinSlackPayload(candidate, composed.body, channelId)
    summary.wouldSend++

    if (opts.dryRun) {
      summary.skipped++
      continue
    }

    if (!slackReady) {
      summary.skipped++
      await writeDelivery(opts.supabase, {
        candidateId: candidate.id,
        channelId,
        status: "skipped",
        skipReason: "slack_not_configured",
        payloadHash: payload.payloadHash,
      })
      continue
    }

    const posted = await postSlackMessage({
      text: payload.text,
      channelId,
    })

    if ("skipReason" in posted && posted.skipReason === "slack_not_configured") {
      summary.skipped++
      await writeDelivery(opts.supabase, {
        candidateId: candidate.id,
        channelId,
        status: "skipped",
        skipReason: "slack_not_configured",
        payloadHash: payload.payloadHash,
      })
      continue
    }

    if (!posted.ok) {
      summary.failed++
      await writeDelivery(opts.supabase, {
        candidateId: candidate.id,
        channelId,
        status: "failed",
        skipReason: "slack_post_failed",
        payloadHash: payload.payloadHash,
      })
      continue
    }

    const deliveryId = await writeDelivery(opts.supabase, {
      candidateId: candidate.id,
      channelId: posted.channelId,
      slackTs: posted.ts,
      status: "sent",
      payloadHash: payload.payloadHash,
      sentAt: new Date().toISOString(),
    })

    if (deliveryId === "already_delivered") {
      summary.skipped++
      continue
    }

    summary.sent++
    sentIds.add(candidate.id)

    await opts.supabase.from("win_events").insert({
      candidate_id: candidate.id,
      event_type: "slack_posted",
      actor_id: opts.actorId ?? null,
      metadata: {
        channel_id: posted.channelId,
        slack_ts: posted.ts,
        delivery_id: deliveryId,
      },
    })
  }

  return summary
}

function classifySkip(
  candidate: WinCandidate,
  alreadyDelivered: boolean
): Exclude<WinsSlackSkipReason, "slack_not_configured" | "slack_post_failed" | "dry_run"> | null {
  if (alreadyDelivered) return "already_delivered"
  if (candidate.is_blocked) return "blocked"
  if (!buildWinMessageForCandidate(candidate)) return "no_template"
  return null
}

async function resolveCompletedRunId(
  supabase: SupabaseClient,
  runId?: string
): Promise<string | null> {
  if (runId) {
    if (!UUID_RE.test(runId)) return null
    const { data } = await supabase
      .from("win_detection_runs")
      .select("id, status")
      .eq("id", runId)
      .maybeSingle()
    if (!data || data.status !== "completed") return null
    return data.id as string
  }

  const latest = await getLatestWinsRun(supabase)
  return latest?.id ?? null
}

async function fetchRunCandidates(
  supabase: SupabaseClient,
  runId: string
): Promise<WinCandidate[]> {
  const { data, error } = await supabase
    .from("win_candidates")
    .select(CANDIDATE_SELECT)
    .eq("run_id", runId)
    .order("priority_rank", { ascending: true })
    .limit(2000)

  if (error) throw new Error(`Failed to read win candidates: ${error.message}`)
  return (data ?? []) as WinCandidate[]
}

async function fetchSentCandidateIds(
  supabase: SupabaseClient,
  candidates: WinCandidate[],
  channelId: string
): Promise<Set<string>> {
  const ids = candidates.map((c) => c.id)
  if (ids.length === 0) return new Set()

  const { data, error } = await supabase
    .from("win_slack_deliveries")
    .select("candidate_id")
    .eq("channel_id", channelId)
    .eq("status", "sent")
    .in("candidate_id", ids)

  if (error) throw new Error(`Failed to read Slack deliveries: ${error.message}`)
  return new Set((data ?? []).map((row) => row.candidate_id as string))
}

async function writeDelivery(
  supabase: SupabaseClient,
  row: {
    candidateId: string
    channelId: string
    slackTs?: string
    status: "sent" | "skipped" | "failed"
    skipReason?: WinsSlackSkipReason
    payloadHash: string
    sentAt?: string
  }
): Promise<string | "already_delivered"> {
  const { data, error } = await supabase
    .from("win_slack_deliveries")
    .insert({
      candidate_id: row.candidateId,
      channel_id: row.channelId,
      slack_ts: row.slackTs ?? null,
      status: row.status,
      skip_reason: row.skipReason ?? null,
      payload_hash: row.payloadHash,
      sent_at: row.sentAt ?? null,
    })
    .select("id")
    .single()

  if (error) {
    // Unique (candidate_id, channel_id) WHERE status=sent — a concurrent
    // rerun already posted. Treat as a no-op, not a failure.
    if (row.status === "sent" && error.code === "23505") return "already_delivered"
    throw new Error(`Failed to record Slack delivery: ${error.message}`)
  }

  return (data?.id as string) ?? "already_delivered"
}
