// Report Builder orchestration — an idempotent state machine driven by a
// per-minute Vercel cron (`/api/cron/report-builder`). Starting a report and
// polling it are separate steps, so a report that takes several minutes is
// finished by later ticks instead of dying with the invocation that started it.
//
// Each tick (`tickReportBuilder`):
//   1. reap — fail runs that can no longer finish (expired session, interrupted
//      trigger or ingestion), at the moment they expire
//   2. poll — if a 'polling' run is in-window, poll it ONCE (ingest if ready)
//   3. start — otherwise, if today's run is due (or a retry is due after a
//      failure, with backoff and a daily cap), start a fresh run
//
// Concurrency: at most one run is active at a time (partial unique index on
// report_runs, migration 20261017120000), each poll claims the run with a
// compare-and-set on poll_attempts, and only the invocation that flips
// 'polling' → 'ingesting' ingests. Overlapping ticks or a manual click
// therefore never double-ingest.
//
// The manual "Sync Report Builder" button (`advanceReportBuilder`) does the
// same reap + one poll, or starts a run; it never waits for the report.

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  envelopeIsCompleted,
  envelopeIsInProgress,
  getReportCurrency,
  pollData,
  requestData,
  resolveTemplateId,
  type ReportEnvelope,
} from "@/lib/report-builder/client"
import { ingestReport } from "@/lib/report-builder/ingest"

const SESSION_WINDOW_MS = 30 * 60 * 1000
// A run stuck in 'pending' (died between insert and /data) or 'ingesting'
// (died mid-ingest) is failed after these windows so it frees the active slot.
const PENDING_STALE_MS = 5 * 60 * 1000
const INGESTING_STALE_MS = 10 * 60 * 1000

// Daily schedule: the first run is due at 08:00 UTC; failed cron runs are
// retried with backoff (15, 30, 60 min…) up to this many cron runs per day.
export const DAILY_RUN_HOUR_UTC = 8
export const MAX_CRON_RUNS_PER_DAY = 4
const RETRY_BACKOFF_BASE_MS = 15 * 60 * 1000

const ACTIVE_STATUSES = ["pending", "polling", "ingesting"] as const

export type AdvanceStatus = "completed" | "polling" | "failed" | "noop"

export type AdvanceResult = {
  runId: string | null
  status: AdvanceStatus
  message: string
  listingCount?: number
  metricRowCount?: number
  unresolvedCount?: number
  reportCurrency?: string | null
  error?: string
}

type AdvanceOptions = {
  triggeredBy: "cron" | "manual"
  userId?: string | null
}

type PollingRun = {
  id: string
  request_id: string | null
  poll_attempts: number
}

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback

function payloadBytesOf(envelope: ReportEnvelope): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(envelope))
  } catch {
    return null
  }
}

function errorReasonOf(envelope: ReportEnvelope): string | null {
  const er = (envelope.error_reason ?? "").trim()
  return er === "" ? null : er
}

function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event: `report_builder.${event}`, ...fields }))
}

async function failRun(
  supabase: SupabaseClient,
  runId: string,
  reason: string
): Promise<AdvanceResult> {
  await supabase
    .from("report_runs")
    .update({
      status: "failed",
      error_reason: reason,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId)
  log("failed", { runId, reason })
  return { runId, status: "failed", message: reason, error: reason }
}

/** Fail every run that can no longer finish, at the moment it expires. */
export async function reapStaleRuns(supabase: SupabaseClient, now: Date) {
  const nowIso = now.toISOString()
  const reaps = [
    {
      status: "polling",
      column: "session_expires_at",
      before: nowIso,
      reason: "session_expired",
    },
    {
      status: "pending",
      column: "started_at",
      before: new Date(now.getTime() - PENDING_STALE_MS).toISOString(),
      reason: "trigger_interrupted: the run never received a request_id",
    },
    {
      status: "ingesting",
      column: "last_polled_at",
      before: new Date(now.getTime() - INGESTING_STALE_MS).toISOString(),
      reason: "ingest_interrupted: ingestion did not finish",
    },
  ]
  for (const r of reaps) {
    const { data } = await supabase
      .from("report_runs")
      .update({ status: "failed", error_reason: r.reason, completed_at: nowIso })
      .eq("status", r.status)
      .lt(r.column, r.before)
      .select("id")
    for (const row of data ?? []) log("reaped", { runId: row.id, reason: r.reason })
  }
}

/**
 * Ingest a completed envelope. Only the invocation that flips the run from
 * 'polling' to 'ingesting' proceeds, so overlapping polls never double-ingest.
 */
async function finalize(
  supabase: SupabaseClient,
  runId: string,
  envelope: ReportEnvelope
): Promise<AdvanceResult> {
  const reason = errorReasonOf(envelope)
  if (reason) return failRun(supabase, runId, `error_reason: ${reason}`)

  const { data: claimed } = await supabase
    .from("report_runs")
    .update({ status: "ingesting", last_polled_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["pending", "polling"])
    .select("id")
  if (!claimed || claimed.length === 0) {
    return { runId, status: "noop", message: "Run is already being ingested" }
  }

  try {
    const result = await ingestReport(supabase, runId, envelope, payloadBytesOf(envelope))
    log("completed", {
      runId,
      listingCount: result.listingCount,
      metricRowCount: result.metricRowCount,
    })
    return {
      runId,
      status: "completed",
      message: `Ingested ${result.metricRowCount} metric rows across ${result.listingCount} listings`,
      listingCount: result.listingCount,
      metricRowCount: result.metricRowCount,
      unresolvedCount: result.unresolvedCount,
      reportCurrency: result.reportCurrency,
    }
  } catch (err) {
    return failRun(supabase, runId, `ingest failed: ${errorMessage(err, "unknown error")}`)
  }
}

/** Claim one poll of an in-window run, poll PriceLabs once, ingest if ready. */
async function pollOnce(
  supabase: SupabaseClient,
  run: PollingRun
): Promise<AdvanceResult> {
  if (!run.request_id) {
    return failRun(supabase, run.id, "polling run has no request_id")
  }

  // Compare-and-set on poll_attempts: if another invocation polled first,
  // this one steps aside instead of polling twice.
  const attempt = run.poll_attempts + 1
  const { data: claimed } = await supabase
    .from("report_runs")
    .update({ poll_attempts: attempt, last_polled_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("status", "polling")
    .eq("poll_attempts", run.poll_attempts)
    .select("id")
  if (!claimed || claimed.length === 0) {
    return { runId: run.id, status: "noop", message: "Another invocation is polling this run" }
  }

  let envelope: ReportEnvelope
  try {
    envelope = await pollData(run.request_id)
  } catch (err) {
    // Transient (timeout, 5xx): keep polling on the next tick, but leave the
    // last error on the row so a run that ends up expiring explains itself.
    const msg = `poll error (attempt ${attempt}): ${errorMessage(err, "unknown error")}`
    log("poll", { runId: run.id, attempt, error: msg })
    await supabase
      .from("report_runs")
      .update({ error_reason: msg })
      .eq("id", run.id)
      .eq("status", "polling")
    return { runId: run.id, status: "polling", message: msg }
  }

  log("poll", {
    runId: run.id,
    attempt,
    pricelabsStatus: envelope.status ?? null,
    errorReason: errorReasonOf(envelope),
  })

  const reason = errorReasonOf(envelope)
  if (reason) return failRun(supabase, run.id, `error_reason: ${reason}`)
  if (envelopeIsCompleted(envelope)) return finalize(supabase, run.id, envelope)

  return {
    runId: run.id,
    status: "polling",
    message: `Report still generating (poll ${attempt}); the next tick polls again`,
  }
}

/** Request a fresh report from PriceLabs and leave the run in 'polling'. */
async function startRun(
  supabase: SupabaseClient,
  options: AdvanceOptions
): Promise<AdvanceResult> {
  let templateId: string
  try {
    templateId = await resolveTemplateId()
  } catch (err) {
    const msg = errorMessage(err, "Failed to resolve template")
    return { runId: null, status: "failed", message: msg, error: msg }
  }

  const { data: run, error: insertError } = await supabase
    .from("report_runs")
    .insert({
      template_id: templateId,
      status: "pending",
      triggered_by: options.triggeredBy,
      triggered_by_user_id: options.userId ?? null,
    })
    .select("id")
    .single()
  if (insertError || !run) {
    // 23505: the one-active-run index — another invocation started a run first.
    if (insertError?.code === "23505") {
      return { runId: null, status: "noop", message: "A report run is already in progress" }
    }
    const msg = insertError?.message ?? "Failed to create report_runs row"
    return { runId: null, status: "failed", message: msg, error: msg }
  }
  const runId = run.id as string
  log("started", { runId, triggeredBy: options.triggeredBy, templateId })

  let envelope: ReportEnvelope
  try {
    envelope = await requestData(templateId)
  } catch (err) {
    return failRun(supabase, runId, `request failed: ${errorMessage(err, "requestData failed")}`)
  }

  const reason = errorReasonOf(envelope)
  if (reason) return failRun(supabase, runId, `error_reason: ${reason}`)

  // Inline data — ingest immediately.
  if (envelopeIsCompleted(envelope)) return finalize(supabase, runId, envelope)

  if (envelopeIsInProgress(envelope) && envelope.request_id) {
    await supabase
      .from("report_runs")
      .update({
        status: "polling",
        request_id: envelope.request_id,
        session_expires_at: new Date(Date.now() + SESSION_WINDOW_MS).toISOString(),
        report_currency: getReportCurrency(envelope),
      })
      .eq("id", runId)
    return {
      runId,
      status: "polling",
      message: "Report requested; it is polled every minute until it is ready",
    }
  }

  return failRun(
    supabase,
    runId,
    `Unexpected /data response: no inline data and no request_id (status: ${envelope.status ?? "none"})`
  )
}

async function findActiveRun(supabase: SupabaseClient, now: Date) {
  const { data } = await supabase
    .from("report_runs")
    .select("id, status, request_id, poll_attempts, session_expires_at")
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  if (data.status === "polling" && data.session_expires_at && new Date(data.session_expires_at as string) <= now) {
    return null // expired; reaped on this or the next tick
  }
  return data as PollingRun & { status: string }
}

/** Start of today's daily window (08:00 UTC), or yesterday's before 08:00. */
export function dailyWindowStart(now: Date): Date {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DAILY_RUN_HOUR_UTC)
  )
  if (start > now) start.setUTCDate(start.getUTCDate() - 1)
  return start
}

/**
 * Decide whether the tick should start a run: none completed since today's
 * 08:00 UTC, fewer than MAX_CRON_RUNS_PER_DAY cron runs so far, and the
 * backoff after the last failed cron run has elapsed.
 */
export function isRunDue(
  now: Date,
  windowRuns: { status: string; triggered_by: string; completed_at: string | null }[]
): { due: boolean; reason: string } {
  if (windowRuns.some((r) => r.status === "completed")) {
    return { due: false, reason: "Today's report is already ingested" }
  }
  const cronRuns = windowRuns.filter((r) => r.triggered_by === "cron")
  if (cronRuns.length >= MAX_CRON_RUNS_PER_DAY) {
    return { due: false, reason: `Daily retry cap reached (${MAX_CRON_RUNS_PER_DAY} cron runs)` }
  }
  if (cronRuns.length > 0) {
    const lastFailedAt = Math.max(
      ...cronRuns.map((r) => (r.completed_at ? new Date(r.completed_at).getTime() : 0))
    )
    const backoffMs = RETRY_BACKOFF_BASE_MS * 2 ** (cronRuns.length - 1)
    if (now.getTime() - lastFailedAt < backoffMs) {
      return { due: false, reason: `Retry backoff (${backoffMs / 60000} min) not elapsed` }
    }
  }
  return { due: true, reason: cronRuns.length === 0 ? "Daily run due" : "Retry due" }
}

/** One per-minute cron tick: reap, then poll the active run once or start one. */
export async function tickReportBuilder(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<AdvanceResult> {
  await reapStaleRuns(supabase, now)

  const active = await findActiveRun(supabase, now)
  if (active?.status === "polling") return pollOnce(supabase, active)
  if (active) {
    return { runId: active.id, status: "noop", message: `Run is ${active.status}` }
  }

  const { data: windowRuns, error } = await supabase
    .from("report_runs")
    .select("status, triggered_by, completed_at")
    .gte("started_at", dailyWindowStart(now).toISOString())
  if (error) {
    return { runId: null, status: "failed", message: error.message, error: error.message }
  }
  const due = isRunDue(now, windowRuns ?? [])
  if (!due.due) return { runId: null, status: "noop", message: due.reason }

  return startRun(supabase, { triggeredBy: "cron" })
}

/**
 * Manual "Sync Report Builder": poll the active run once, or start a new one.
 * Never waits for the report — the per-minute tick finishes it.
 */
export async function advanceReportBuilder(
  supabase: SupabaseClient,
  options: AdvanceOptions
): Promise<AdvanceResult> {
  const now = new Date()
  await reapStaleRuns(supabase, now)

  const active = await findActiveRun(supabase, now)
  if (active?.status === "polling") return pollOnce(supabase, active)
  if (active) {
    return { runId: active.id, status: "polling", message: `Run is ${active.status}` }
  }

  return startRun(supabase, options)
}
