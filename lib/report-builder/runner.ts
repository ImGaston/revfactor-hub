// Report Builder orchestration — an idempotent state machine that fits inside
// a single Vercel function (≤60s) and a daily cron, without hanging a function
// for the 30-min PriceLabs session window.
//
// Each invocation:
//   1. reap — fail any 'polling' run past its 30-min window
//   2. resume — if a 'polling' run is still in-window, poll it once (ingest if ready)
//   3. trigger — otherwise start a fresh run, then bounded-poll inline (~45s)
//
// A manual "Sync / Resume" button calls this with triggeredBy='manual', which
// lets a human close out a slow report within the window if the cron's inline
// poll didn't finish.

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
const INLINE_DEADLINE_MS = 45_000
const POLL_INTERVAL_MS = 5_000

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
  // Cap the inline poll loop (ms). Lower it when chaining after another job so
  // the combined function stays under its maxDuration. Defaults to ~45s.
  inlineDeadlineMs?: number
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
  return { runId, status: "failed", message: reason, error: reason }
}

/** Ingest a completed envelope and produce the success result (or fail the run). */
async function finalize(
  supabase: SupabaseClient,
  runId: string,
  envelope: ReportEnvelope
): Promise<AdvanceResult> {
  const reason = errorReasonOf(envelope)
  if (reason) return failRun(supabase, runId, `error_reason: ${reason}`)

  await supabase.from("report_runs").update({ status: "ingesting" }).eq("id", runId)
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
      err instanceof Error ? err.message : "Ingestion failed"
    )
  }
}

/** Poll a request_id until completed or the inline deadline; ingest if ready. */
async function pollUntilDeadline(
  supabase: SupabaseClient,
  runId: string,
  requestId: string,
  startedAt: number,
  deadlineMs: number
): Promise<AdvanceResult> {
  let attempt = 0
  while (Date.now() - startedAt < deadlineMs) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    attempt++
    let envelope: ReportEnvelope
    try {
      envelope = await pollData(requestId)
    } catch {
      // transient poll error — record attempt and keep trying within the window
      await supabase
        .from("report_runs")
        .update({ last_polled_at: new Date().toISOString(), poll_attempts: attempt })
        .eq("id", runId)
      continue
    }
    const reason = errorReasonOf(envelope)
    if (reason) return failRun(supabase, runId, `error_reason: ${reason}`)
    if (envelopeIsCompleted(envelope)) return finalize(supabase, runId, envelope)

    await supabase
      .from("report_runs")
      .update({ last_polled_at: new Date().toISOString(), poll_attempts: attempt })
      .eq("id", runId)
  }
  return {
    runId,
    status: "polling",
    message: "Report still generating; will resume on next cron or manual sync",
  }
}

export async function advanceReportBuilder(
  supabase: SupabaseClient,
  options: AdvanceOptions
): Promise<AdvanceResult> {
  const startedAt = Date.now()
  const inlineDeadlineMs = options.inlineDeadlineMs ?? INLINE_DEADLINE_MS
  const nowIso = new Date().toISOString()

  // 1. Reap expired polling runs.
  await supabase
    .from("report_runs")
    .update({
      status: "failed",
      error_reason: "session_expired",
      completed_at: nowIso,
    })
    .eq("status", "polling")
    .lt("session_expires_at", nowIso)

  // 2. Resume an in-window polling run, if any.
  const { data: active } = await supabase
    .from("report_runs")
    .select("id, request_id, session_expires_at")
    .eq("status", "polling")
    .gte("session_expires_at", nowIso)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (active?.request_id) {
    return pollUntilDeadline(
      supabase,
      active.id as string,
      active.request_id as string,
      startedAt,
      inlineDeadlineMs
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
      err instanceof Error ? err.message : "requestData failed"
    )
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
    return pollUntilDeadline(
      supabase,
      runId,
      envelope.request_id,
      startedAt,
      inlineDeadlineMs
    )
  }

  return failRun(
    supabase,
    runId,
    "Unexpected /data response: no inline data and no request_id"
  )
}
