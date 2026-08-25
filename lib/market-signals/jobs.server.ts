import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { generateMarketSignalBriefsForMarket } from "@/lib/market-signals/briefs.server"
import { syncMarketSignalsForMarket } from "@/lib/market-signals/ingest.server"
import { scoreMarketVulnerability } from "@/lib/market-signals/vulnerability.server"

export type MarketSignalJobReason =
  | "scheduled"
  | "manual"
  | "recovery"
  | "inventory_refresh"

type ClaimedJob = {
  job_id: string
  market_id: string
  reason: MarketSignalJobReason
  attempt: number
  lease_token: string
}

export type MarketSignalJobResult = {
  jobId: string
  marketId: string
  attempt: number
  status: "succeeded" | "queued" | "failed"
  durationMs: number
  error: string | null
  sourcesSynced: number
}

export async function enqueueMarketSignalJobs(
  supabase: SupabaseClient,
  options: {
    reason: MarketSignalJobReason
    marketId?: string
    priority?: number
  }
) {
  const { data, error } = await supabase.rpc("enqueue_market_signal_jobs", {
    p_reason: options.reason,
    p_market_id: options.marketId ?? null,
    p_priority: options.priority ?? 50,
  })
  if (error) {
    throw new Error(`Failed to enqueue Market Signals work: ${error.message}`)
  }
  return Number(data ?? 0)
}

async function claimMarketSignalJob(
  supabase: SupabaseClient,
  leaseSeconds: number
) {
  const { data, error } = await supabase.rpc("claim_market_signal_job", {
    p_lease_seconds: leaseSeconds,
  })
  if (error) {
    throw new Error(`Failed to claim Market Signals work: ${error.message}`)
  }
  const row = Array.isArray(data) ? data[0] : data
  return (row ?? null) as ClaimedJob | null
}

async function finishMarketSignalJob(
  supabase: SupabaseClient,
  input: {
    job: ClaimedJob
    succeeded: boolean
    durationMs: number
    result: Record<string, unknown> | null
    error: string | null
  }
) {
  const { data, error } = await supabase.rpc("finish_market_signal_job", {
    p_job_id: input.job.job_id,
    p_lease_token: input.job.lease_token,
    p_succeeded: input.succeeded,
    p_result: input.result,
    p_error: input.error,
    p_duration_ms: input.durationMs,
  })
  if (error) {
    throw new Error(`Failed to finish Market Signals work: ${error.message}`)
  }
  return data as MarketSignalJobResult["status"]
}

export async function processMarketSignalJobs(
  supabase: SupabaseClient,
  options?: {
    maximumJobs?: number
    timeBudgetMs?: number
    leaseSeconds?: number
  }
) {
  const maximumJobs = Math.min(10, Math.max(1, options?.maximumJobs ?? 1))
  const timeBudgetMs = Math.min(
    280_000,
    Math.max(30_000, options?.timeBudgetMs ?? 270_000)
  )
  const leaseSeconds = Math.min(900, Math.max(30, options?.leaseSeconds ?? 330))
  const deadline = Date.now() + timeBudgetMs
  const results: MarketSignalJobResult[] = []

  while (results.length < maximumJobs && Date.now() < deadline) {
    const job = await claimMarketSignalJob(supabase, leaseSeconds)
    if (!job) break
    const startedAt = Date.now()

    try {
      const sourceResults =
        job.reason === "inventory_refresh"
          ? []
          : await syncMarketSignalsForMarket(supabase, job.market_id, {
              dueOnly: job.reason === "scheduled",
            })
      const derivedOnly =
        job.reason === "inventory_refresh"
          ? await scoreMarketVulnerability(supabase, job.market_id, new Date())
          : null
      const derivedBriefs = derivedOnly
        ? await generateMarketSignalBriefsForMarket(supabase, job.market_id)
        : []
      const durationMs = Date.now() - startedAt
      const result = {
        sourcesSynced: sourceResults.length,
        rowsRead: sourceResults.reduce((sum, row) => sum + row.rowsRead, 0),
        rowsChanged: sourceResults.reduce(
          (sum, row) => sum + row.rowsChanged,
          0
        ),
        impactsScored:
          derivedOnly?.impactsScored ??
          sourceResults.reduce((sum, row) => sum + row.impactsScored, 0),
        exposuresStored:
          derivedOnly?.listingExposuresScored ??
          sourceResults.reduce(
            (sum, row) => sum + row.listingExposuresScored,
            0
          ),
        needsReview:
          derivedOnly?.needsReview ??
          sourceResults.reduce((sum, row) => sum + row.needsReview, 0),
        briefsGenerated:
          derivedBriefs.filter((brief) => brief.status === "generated").length +
          sourceResults.reduce((sum, row) => sum + row.briefsGenerated, 0),
      }
      const status = await finishMarketSignalJob(supabase, {
        job,
        succeeded: true,
        durationMs,
        result,
        error: null,
      })
      results.push({
        jobId: job.job_id,
        marketId: job.market_id,
        attempt: job.attempt,
        status,
        durationMs,
        error: null,
        sourcesSynced: sourceResults.length,
      })
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const message =
        error instanceof Error ? error.message : "Unknown Market Signals error"
      const status = await finishMarketSignalJob(supabase, {
        job,
        succeeded: false,
        durationMs,
        result: null,
        error: message,
      })
      results.push({
        jobId: job.job_id,
        marketId: job.market_id,
        attempt: job.attempt,
        status,
        durationMs,
        error: message,
        sourcesSynced: 0,
      })
    }
  }

  return {
    processed: results.length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    retrying: results.filter((result) => result.status === "queued").length,
    failed: results.filter((result) => result.status === "failed").length,
    exhaustedTimeBudget: Date.now() >= deadline,
    results,
  }
}
