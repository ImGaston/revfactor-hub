import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getPmsAdapter, syncableProviders, type PmsAdapter } from "@/lib/pms-adapters.server"
import { isMissingConnectionsRelation } from "@/lib/pms-connections.server"
import {
  formatPmsCoverage,
  planChunks,
  PMS_RESERVATION_UPSERT_KEY,
  syncWindow,
  type DateWindow,
  type PmsReservationRow,
  type PmsSyncMode,
} from "@/lib/pms-reservations"
import { createAdminClient } from "@/lib/supabase/admin"

// PMS booking sync (client PMS connections, phase 2).
//
// For one connection: read the confirmed property → listing mappings, pull
// reservations for those properties only, window by window (≤ 3 months of
// check-ins each), and upsert them into pms_reservations on
// (connection_id, external_reservation_id). Cancellations are status updates
// on the same row. Job state and coverage live in pms_sync_runs.
//
//   backfill     2024-01-01 → today + 18 months
//   incremental  today − 30 days → today + 18 months
//   auto         resume an unfinished run, else backfill until one has
//                succeeded, then incremental
//
// Runs are bounded by a deadline: the service stops before starting a window
// it can't finish, saves the next window as the cursor (status "partial") and
// the next run resumes there. One running run per connection (unique index).
//
// Service role only (Vault secret + writes); callers gate permissions. Never
// logs provider bodies, secrets or reservation rows — only codes and counts.

const STALE_RUN_MS = 3 * 60_000
/** Don't start a new window with less than this left before the deadline. */
const MIN_WINDOW_MS = 6_000
const UPSERT_BATCH = 500
const ACTIVE_STATUSES = ["connected", "verified"]

export type PmsSyncTrigger = "manual" | "cron"
export type PmsSyncRequestMode = PmsSyncMode | "auto"

export type PmsSyncResult =
  | {
      ok: true
      runId: string
      mode: PmsSyncMode
      status: "succeeded" | "partial"
      fetched: number
      upserted: number
      coverage: string | null
    }
  | { ok: false; error: string; code?: string; runId?: string }

type Deps = {
  supabase?: SupabaseClient
  now?: () => number
  getAdapter?: (provider: string) => PmsAdapter | null
}

type RunRow = {
  id: string
  mode: PmsSyncMode
  status: string
  window_start: string
  window_end: string
  next_chunk_start: string | null
  coverage_start: string | null
}

const RUN_COLUMNS = "id, mode, status, window_start, window_end, next_chunk_start, coverage_start"

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Decide what this run covers: resume a cursor, or start a fresh window. */
export function planSyncRun(input: {
  requested: PmsSyncRequestMode
  today: string
  lastFinished: RunRow | null
  hasSucceededBackfill: boolean
  lastSucceeded: RunRow | null
}): { mode: PmsSyncMode; window: DateWindow; cursor: string; coverageStart: string } {
  const { requested, today, lastFinished, hasSucceededBackfill, lastSucceeded } = input
  const resumable =
    lastFinished &&
    (lastFinished.status === "partial" || lastFinished.status === "failed") &&
    lastFinished.next_chunk_start &&
    lastFinished.next_chunk_start <= lastFinished.window_end
  const mode: PmsSyncMode =
    requested === "auto"
      ? resumable
        ? lastFinished!.mode
        : hasSucceededBackfill
          ? "incremental"
          : "backfill"
      : requested
  if (resumable && lastFinished!.mode === mode) {
    return {
      mode,
      window: { start: lastFinished!.window_start, end: lastFinished!.window_end },
      cursor: lastFinished!.next_chunk_start!,
      coverageStart:
        mode === "backfill" ? lastFinished!.window_start : (lastSucceeded?.coverage_start ?? lastFinished!.window_start),
    }
  }
  const window = syncWindow(mode, today)
  return {
    mode,
    window,
    cursor: window.start,
    coverageStart: mode === "backfill" ? window.start : (lastSucceeded?.coverage_start ?? window.start),
  }
}

export async function syncPmsConnection(
  connectionId: string,
  options: { mode?: PmsSyncRequestMode; trigger: PmsSyncTrigger; actorId?: string | null; deadline: number },
  deps: Deps = {}
): Promise<PmsSyncResult> {
  const supabase = deps.supabase ?? createAdminClient()
  const now = deps.now ?? Date.now
  const startedAt = now()

  const { data: connection, error: connectionError } = await supabase
    .from("client_pms_connections")
    .select("id, client_id, provider, status")
    .eq("id", connectionId)
    .maybeSingle()
  if (connectionError || !connection) return { ok: false, error: "Connection not found" }
  if (!ACTIVE_STATUSES.includes(connection.status as string)) {
    return { ok: false, error: "Only connected or verified connections can sync bookings" }
  }
  const adapter = (deps.getAdapter ?? getPmsAdapter)(connection.provider as string)
  if (!adapter) return { ok: false, error: "Booking sync isn't available for this PMS yet", code: "unsupported_provider" }
  const clientId = connection.client_id as string

  const { data: mapped, error: mappedError } = await supabase
    .from("client_pms_properties")
    .select("external_property_id, mapped_listing_id")
    .eq("connection_id", connectionId)
    .eq("client_id", clientId)
    .eq("mapping_status", "confirmed")
  if (mappedError) return { ok: false, error: "Couldn't read the property mappings" }
  const listingFor = new Map(
    ((mapped ?? []) as { external_property_id: string; mapped_listing_id: string | null }[])
      .filter((m) => m.mapped_listing_id)
      .map((m) => [m.external_property_id, m.mapped_listing_id as string])
  )
  if (listingFor.size === 0) return { ok: false, error: "Confirm at least one property mapping first", code: "no_mappings" }

  // Reap a run that died mid-way (its cursor stays, so the next run resumes it).
  await supabase
    .from("pms_sync_runs")
    .update({ status: "failed", error_code: "interrupted", finished_at: new Date(startedAt).toISOString() })
    .eq("connection_id", connectionId)
    .eq("status", "running")
    .lt("started_at", new Date(startedAt - STALE_RUN_MS).toISOString())

  const [lastFinishedRes, succeededRes] = await Promise.all([
    supabase
      .from("pms_sync_runs")
      .select(RUN_COLUMNS)
      .eq("connection_id", connectionId)
      .neq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("pms_sync_runs")
      .select(RUN_COLUMNS)
      .eq("connection_id", connectionId)
      .eq("status", "succeeded")
      .order("started_at", { ascending: false })
      .limit(20),
  ])
  if (lastFinishedRes.error || succeededRes.error) {
    if (isMissingConnectionsRelation(lastFinishedRes.error ?? succeededRes.error)) {
      return { ok: false, error: "Booking sync needs the PMS reservations migration (20261021120000)", code: "not_ready" }
    }
    return { ok: false, error: "Couldn't read the sync history" }
  }
  const succeeded = (succeededRes.data ?? []) as RunRow[]
  const plan = planSyncRun({
    requested: options.mode ?? "auto",
    today: isoDay(startedAt),
    lastFinished: (lastFinishedRes.data as RunRow | null) ?? null,
    hasSucceededBackfill: succeeded.some((r) => r.mode === "backfill"),
    lastSucceeded: succeeded[0] ?? null,
  })
  const chunks = planChunks({ start: plan.cursor, end: plan.window.end }, adapter.chunkMonths)

  const { data: run, error: runError } = await supabase
    .from("pms_sync_runs")
    .insert({
      connection_id: connectionId,
      client_id: clientId,
      provider: adapter.provider,
      mode: plan.mode,
      trigger: options.trigger,
      status: "running",
      window_start: plan.window.start,
      window_end: plan.window.end,
      next_chunk_start: plan.cursor,
      chunks_total: chunks.length,
      started_by: options.actorId ?? null,
      started_at: new Date(startedAt).toISOString(),
    })
    .select("id")
    .single()
  if (runError || !run) {
    if (runError?.code === "23505") return { ok: false, error: "A booking sync is already running for this connection" }
    if (isMissingConnectionsRelation(runError)) {
      return { ok: false, error: "Booking sync needs the PMS reservations migration (20261021120000)", code: "not_ready" }
    }
    console.error("pms sync: run insert failed", runError?.code ?? "unknown")
    return { ok: false, error: "Couldn't start the sync" }
  }
  const runId = run.id as string

  const finish = async (patch: Record<string, unknown>) => {
    const { error } = await supabase
      .from("pms_sync_runs")
      .update({ ...patch, finished_at: new Date(now()).toISOString() })
      .eq("id", runId)
    if (error) console.error("pms sync: run update failed", error.code ?? "unknown")
  }
  const fail = async (code: string, error: string, counts: Record<string, number>, cursor: string | null) => {
    await finish({ status: "failed", error_code: code, next_chunk_start: cursor, ...counts })
    console.error("pms sync: run failed", { runId, code })
    return { ok: false as const, error, code, runId }
  }

  const { data: secret, error: secretError } = await supabase.rpc("pms_connection_secret", {
    p_connection_id: connectionId,
  })
  if (secretError || typeof secret !== "string") {
    return fail("secret_unavailable", "The stored credential is unavailable", {}, plan.cursor)
  }
  const opened = await adapter.open(secret)
  if (!opened.ok) return fail(opened.code, "Couldn't open the PMS connection", {}, plan.cursor)
  const session = opened.data

  const propertyIds = [...listingFor.keys()]
  let fetched = 0
  let upserted = 0
  let done = 0
  for (const chunk of chunks) {
    if (options.deadline - now() < MIN_WINDOW_MS) {
      await finish({
        status: "partial",
        next_chunk_start: chunk.start,
        chunks_done: done,
        fetched_count: fetched,
        upserted_count: upserted,
      })
      return { ok: true, runId, mode: plan.mode, status: "partial", fetched, upserted, coverage: null }
    }
    const result = await session.fetchReservations({ propertyIds, window: chunk }, { deadline: options.deadline })
    if (!result.ok) {
      return fail(result.code, `The PMS returned an error (${result.code})`, {
        chunks_done: done,
        fetched_count: fetched,
        upserted_count: upserted,
      }, chunk.start)
    }
    fetched += result.data.length
    const fetchedAt = new Date(now()).toISOString()
    const rows: PmsReservationRow[] = []
    for (const r of result.data) {
      const listingId = listingFor.get(r.external_property_id)
      // Adapters already scope rows to the requested ids; this is a second fence.
      if (!listingId) continue
      rows.push({
        ...r,
        connection_id: connectionId,
        client_id: clientId,
        provider: adapter.provider,
        listing_id: listingId,
        source_fetched_at: fetchedAt,
      })
    }
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const { error } = await supabase
        .from("pms_reservations")
        .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: PMS_RESERVATION_UPSERT_KEY })
      if (error) {
        console.error("pms sync: upsert failed", error.code ?? "unknown")
        return fail("write_failed", "Couldn't save the bookings", {
          chunks_done: done,
          fetched_count: fetched,
          upserted_count: upserted,
        }, chunk.start)
      }
      upserted += Math.min(UPSERT_BATCH, rows.length - i)
    }
    done++
    const next = chunks[done]?.start ?? null
    await supabase
      .from("pms_sync_runs")
      .update({ next_chunk_start: next, chunks_done: done, fetched_count: fetched, upserted_count: upserted })
      .eq("id", runId)
  }

  const coverage = await readCoverage(supabase, connectionId)
  await finish({
    status: "succeeded",
    next_chunk_start: null,
    error_code: null,
    chunks_done: done,
    fetched_count: fetched,
    upserted_count: upserted,
    coverage_start: plan.coverageStart,
    coverage_end: plan.window.end,
    ...coverage,
  })
  return {
    ok: true,
    runId,
    mode: plan.mode,
    status: "succeeded",
    fetched,
    upserted,
    coverage: formatPmsCoverage(plan.coverageStart, plan.window.end, coverage.stay_count),
  }
}

async function readCoverage(supabase: SupabaseClient, connectionId: string) {
  const base = () => supabase.from("pms_reservations")
  const [stays, cancelled, earliest, latest] = await Promise.all([
    base().select("id", { count: "exact", head: true }).eq("connection_id", connectionId).eq("status", "accepted"),
    base().select("id", { count: "exact", head: true }).eq("connection_id", connectionId).eq("status", "cancelled"),
    base()
      .select("check_in")
      .eq("connection_id", connectionId)
      .eq("status", "accepted")
      .order("check_in", { ascending: true })
      .limit(1)
      .maybeSingle(),
    base()
      .select("check_out")
      .eq("connection_id", connectionId)
      .eq("status", "accepted")
      .not("check_out", "is", null)
      .order("check_out", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  return {
    stay_count: stays.count ?? null,
    cancelled_count: cancelled.count ?? null,
    earliest_check_in: (earliest.data?.check_in as string | undefined) ?? null,
    latest_check_out: (latest.data?.check_out as string | undefined) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Daily cron: every active connection whose PMS has an adapter
// ---------------------------------------------------------------------------

export type PmsSyncAllResult = {
  connections: number
  succeeded: number
  partial: number
  failed: number
  skipped: number
  stoppedEarly: boolean
  errors: { connectionId: string; code: string }[]
}

export async function syncAllPmsConnections(
  options: { deadline: number },
  deps: Deps = {}
): Promise<PmsSyncAllResult | { skipped: true; reason: string }> {
  const supabase = deps.supabase ?? createAdminClient()
  const now = deps.now ?? Date.now
  const { data, error } = await supabase
    .from("client_pms_connections")
    .select("id")
    .in("provider", syncableProviders())
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: true })
  if (error) {
    if (isMissingConnectionsRelation(error)) return { skipped: true, reason: "PMS connections migration not applied" }
    throw new Error(`PMS connections read failed (${error.code ?? "unknown"})`)
  }
  const result: PmsSyncAllResult = {
    connections: (data ?? []).length,
    succeeded: 0,
    partial: 0,
    failed: 0,
    skipped: 0,
    stoppedEarly: false,
    errors: [],
  }
  for (const { id } of (data ?? []) as { id: string }[]) {
    if (options.deadline - now() < MIN_WINDOW_MS) {
      result.stoppedEarly = true
      break
    }
    const run = await syncPmsConnection(id, { mode: "auto", trigger: "cron", deadline: options.deadline }, deps)
    if (run.ok) {
      if (run.status === "succeeded") result.succeeded++
      else result.partial++
    } else if (run.code === "no_mappings" || run.code === "unsupported_provider") {
      result.skipped++
    } else if (run.code === "not_ready") {
      return { skipped: true, reason: "PMS reservations migration not applied" }
    } else {
      result.failed++
      result.errors.push({ connectionId: id, code: run.code ?? "error" })
    }
  }
  return result
}
