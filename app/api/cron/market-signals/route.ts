import { NextResponse } from "next/server"

import { getMarketSignalsRuntimeStatus } from "@/lib/market-signals/ingest.server"
import {
  enqueueMarketSignalJobs,
  processMarketSignalJobs,
} from "@/lib/market-signals/jobs.server"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 300

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (
    !cronSecret ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const runtime = getMarketSignalsRuntimeStatus()
  if (!runtime.serviceRoleConfigured) {
    return NextResponse.json(
      {
        ok: false,
        error: "Market Signals requires SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 503 }
    )
  }

  try {
    const supabase = createAdminClient()
    const enqueued =
      runtime.configuredSources > 0
        ? await enqueueMarketSignalJobs(supabase, {
            reason: "scheduled",
            priority: 50,
          })
        : 0
    const maximumJobs = Math.min(
      10,
      Math.max(1, Number(process.env.MARKET_SIGNALS_JOBS_PER_RUN ?? 1))
    )
    const result = await processMarketSignalJobs(supabase, {
      maximumJobs,
      timeBudgetMs: 270_000,
      leaseSeconds: 330,
    })
    return NextResponse.json({
      ok: result.failed === 0,
      configuredProviders: runtime.configuredSources,
      enqueued,
      ...result,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
