// Report Builder orchestration — an idempotent state machine that fits inside
// a single Vercel function (maxDuration 300) and a daily cron.
//
// Each invocation:
//   1. reap — fail any 'polling' run past its 30-min window, and any run left
//      in 'ingesting' by a function that was cut off mid-ingest
//   2. resume — if a 'polling' run is still in-window, poll it (ingest if ready)
//   3. trigger — otherwise start a fresh run, then poll inline until the report
//      is ready or the inline deadline passes
//
// PriceLabs generates the report server-side. That took 30–50s in Aug 2026 but
// 50–180s by late Sep (300+ listings), so one invocation must be able to poll
// for minutes: the daily cron is the only scheduled caller, and a run left in
// 'polling' is reaped as session_expired by the next day's cron. A manual
// "Sync Report Builder" click runs the same logic and resumes an in-window run.

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
const POLL_INTERVAL_MS = 5_000

// Inline poll budget for one invocation, measured from its start. No poll
// starts after it, so the final poll (≤ REPORT_BUILDER_FETCH_TIMEOUT_MS) plus
// ingestion (≤ INGEST_RESERVE_MS; ~15s for the ~7 MB portfolio report) still
// fit under the callers' maxDuration 300. lib/__tests__/report-builder-runner
// asserts that budget against every route that hosts this state machine.
export const INLINE_DEADLINE_MS = 230_000
export const INGEST_RESERVE_MS = 25_000

// A run still 'ingesting' this long after it started was cut off by its
// function's maxDuration (resume can begin up to 30 min after start, and an
// invocation lasts at most 5 min).
const STALE_INGEST_MS = SESSION_WINDOW_MS + 15 * 60 * 1000

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

export type RunnerClock = {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const systemClock: RunnerClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

type AdvanceOptions = {
  triggeredBy: "cron" | "manual"
  userId?: string | null
  // Cap the inline poll loop (ms from the start of this call). Defaults to
  // INLINE_DEADLINE_MS, which assumes the caller runs under maxDuration 300.
  inlineDeadlineMs?: number
  // Tests inject a virtual clock; production uses wall time.
  clock?: RunnerClock
}

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

async function failRun(
  supabase: SupabaseClient,
  runId: string,
  reason: string,
  clock: RunnerClock
): Promise<AdvanceResult> {
  await supabase
    .from("report_runs")
    .update({
      status: "failed",
      error_reason: reason,
      completed_at: new Date(clock.now()).toISOString(),
    })
    .eq("id", runId)
  return { runId, status: "failed", message: reason, error: reason }
}

/** Ingest a completed envelope and produce the success result (or fail the run). */
async function finalize(
  supabase: SupabaseClient,
  runId: string,
  envelope: ReportEnvelope,
  clock: RunnerClock
): Promise<AdvanceResult> {
  const reason = errorReasonOf(envelope)
  if (reason) return failRun(supabase, runId, `error_reason: ${reason}`, clock)

  // Claim the run atomically: a cron and a manual click can poll the same
  // request_id at once, and only one of them should ingest it.
  const { data: claimed, error: claimError } = await supabase
    .from("report_runs")
    .update({ status: "ingesting" })
    .eq("id", runId)
    .in("status", ["pending", "polling"])
    .select("id")
  if (claimError) {
    // Leave the row alone: another sync may own it, and an unclaimed run stays
    // 'polling' so a later sync inside the session can still ingest it.
    const message = `Could not claim run for ingestion: ${claimError.message}`
    return { runId, status: "failed", message, error: message }
  }
  if (!claimed || claimed.length === 0) {
    return {
      runId,
      status: "noop",
      message: "Report is already being ingested by another sync",
    }
  }

  try {
    const result = await ingestReport(supabase, runId, envelope, payloadBytesOf(envelope))
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
    return failRun(
      supabase,
      runId,
      err instanceof Error ? err.message : "Ingestion failed",
      clock
    )
  }
}

/**
 * Poll a request_id until completed, the inline deadline, or the PriceLabs
 * session expiry — whichever comes first — and ingest if ready.
 */
async function pollUntilDeadline(
  supabase: SupabaseClient,
  run: {
    runId: string
    requestId: string
    sessionExpiresAt: number
    priorAttempts: number
  },
  startedAt: number,
  deadlineMs: number,
  clock: RunnerClock
): Promise<AdvanceResult> {
  const { runId, requestId } = run
  const stopAt = Math.min(startedAt + deadlineMs, run.sessionExpiresAt)
  let attempt = run.priorAttempts
  let lastPollError: string | null = null

  while (stopAt - clock.now() >= POLL_INTERVAL_MS) {
    await clock.sleep(POLL_INTERVAL_MS)
    attempt++
    let envelope: ReportEnvelope
    try {
      envelope = await pollData(requestId)
      lastPollError = null
    } catch (err) {
      // transient poll error — record attempt and keep trying within the window
      lastPollError = err instanceof Error ? err.message : String(err)
      console.warn(`Report Builder poll ${attempt} for run ${runId} failed:`, lastPollError)
      await supabase
        .from("report_runs")
        .update({ last_polled_at: new Date(clock.now()).toISOString(), poll_attempts: attempt })
        .eq("id", runId)
      continue
    }
    const reason = errorReasonOf(envelope)
    if (reason) return failRun(supabase, runId, `error_reason: ${reason}`, clock)
    if (envelopeIsCompleted(envelope)) return finalize(supabase, runId, envelope, clock)

    await supabase
      .from("report_runs")
      .update({ last_polled_at: new Date(clock.now()).toISOString(), poll_attempts: attempt })
      .eq("id", runId)
  }

  console.warn(
    `Report Builder run ${runId} still generating after ${attempt} polls` +
      (lastPollError ? ` (last poll error: ${lastPollError})` : "")
  )
  return {
    runId,
    status: "polling",
    message:
      "Report still generating; sync again within 30 minutes to resume it",
  }
}

export async function advanceReportBuilder(
  supabase: SupabaseClient,
  options: AdvanceOptions
): Promise<AdvanceResult> {
  const clock = options.clock ?? systemClock
  const startedAt = clock.now()
  const inlineDeadlineMs = options.inlineDeadlineMs ?? INLINE_DEADLINE_MS
  const nowIso = new Date(startedAt).toISOString()

  // 1. Reap expired polling runs, and runs stranded mid-ingest.
  await supabase
    .from("report_runs")
    .update({
      status: "failed",
      error_reason: "session_expired",
      completed_at: nowIso,
    })
    .eq("status", "polling")
    .lt("session_expires_at", nowIso)
  await supabase
    .from("report_runs")
    .update({
      status: "failed",
      error_reason: "ingest_interrupted",
      completed_at: nowIso,
    })
    .eq("status", "ingesting")
    .lt("started_at", new Date(startedAt - STALE_INGEST_MS).toISOString())

  // 2. Resume an in-window polling run, if any.
  const { data: active } = await supabase
    .from("report_runs")
    .select("id, request_id, session_expires_at, poll_attempts")
    .eq("status", "polling")
    .gte("session_expires_at", nowIso)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (active?.request_id) {
    // The query already proved the session is in-window; an unparseable
    // timestamp falls back to the inline deadline alone.
    const expiresAt = Date.parse(String(active.session_expires_at))
    return pollUntilDeadline(
      supabase,
      {
        runId: active.id as string,
        requestId: active.request_id as string,
        sessionExpiresAt: Number.isFinite(expiresAt) ? expiresAt : Infinity,
        priorAttempts: (active.poll_attempts as number | null) ?? 0,
      },
      startedAt,
      inlineDeadlineMs,
      clock
    )
  }

  // 3. Trigger a fresh run.
  let templateId: string
  try {
    templateId = await resolveTemplateId()
  } catch (err) {
    return {
      runId: null,
      status: "failed",
      message: err instanceof Error ? err.message : "Failed to resolve template",
      error: err instanceof Error ? err.message : "Failed to resolve template",
    }
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
    const msg = insertError?.message ?? "Failed to create report_runs row"
    return { runId: null, status: "failed", message: msg, error: msg }
  }
  const runId = run.id as string

  let envelope: ReportEnvelope
  try {
    envelope = await requestData(templateId)
  } catch (err) {
    return failRun(
      supabase,
      runId,
      err instanceof Error ? err.message : "requestData failed",
      clock
    )
  }

  const reason = errorReasonOf(envelope)
  if (reason) return failRun(supabase, runId, `error_reason: ${reason}`, clock)

  // Inline data — ingest immediately.
  if (envelopeIsCompleted(envelope)) return finalize(supabase, runId, envelope, clock)

  if (envelopeIsInProgress(envelope) && envelope.request_id) {
    const sessionExpiresAt = clock.now() + SESSION_WINDOW_MS
    await supabase
      .from("report_runs")
      .update({
        status: "polling",
        request_id: envelope.request_id,
        session_expires_at: new Date(sessionExpiresAt).toISOString(),
        report_currency: getReportCurrency(envelope),
      })
      .eq("id", runId)
    return pollUntilDeadline(
      supabase,
      { runId, requestId: envelope.request_id, sessionExpiresAt, priorAttempts: 0 },
      startedAt,
      inlineDeadlineMs,
      clock
    )
  }

  return failRun(
    supabase,
    runId,
    "Unexpected /data response: no inline data and no request_id",
    clock
  )
}
