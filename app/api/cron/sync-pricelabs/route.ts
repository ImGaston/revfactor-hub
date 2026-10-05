import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isPriceLabsConfigured } from "@/lib/pricelabs"
import { syncPriceLabsData } from "@/lib/pricelabs-sync"
import { advanceReportBuilder } from "@/lib/report-builder/runner"
import { enqueueMarketSignalJobs } from "@/lib/market-signals/jobs.server"

export const dynamic = "force-dynamic"
// The Report Builder polls inline for up to INLINE_DEADLINE_MS (230s) plus a
// final poll and ingestion; see lib/report-builder/runner.ts.
export const maxDuration = 300

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error"
}

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isPriceLabsConfigured()) {
    return NextResponse.json(
      { error: "PRICELABS_API_KEY not configured" },
      { status: 500 }
    )
  }

  const supabase = createAdminClient()

  // Chain the Report Builder ingestion onto the same daily cron (same API key)
  // so we don't add a separate cron job. It runs alongside the pl_* sync, not
  // after it: PriceLabs needs minutes to generate the report, so triggering it
  // first overlaps generation with the listing sync and gives the poll loop
  // its full inline budget instead of whatever the pl_* sync left over.
  const [plSync, reportOutcome] = await Promise.allSettled([
    syncPriceLabsData(supabase),
    advanceReportBuilder(supabase, { triggeredBy: "cron" }),
  ])

  let reportBuilder:
    | Awaited<ReturnType<typeof advanceReportBuilder>>
    | { status: string; error: string }
  if (reportOutcome.status === "fulfilled") {
    reportBuilder = reportOutcome.value
  } else {
    console.error("Report Builder (chained) error:", reportOutcome.reason)
    reportBuilder = { status: "failed", error: errorMessage(reportOutcome.reason) }
  }

  if (plSync.status === "rejected") {
    console.error("PriceLabs sync error:", plSync.reason)
    return NextResponse.json(
      { error: errorMessage(plSync.reason), reportBuilder },
      { status: 500 }
    )
  }
  const result = plSync.value

  let marketSignalJobs = 0
  try {
    marketSignalJobs = await enqueueMarketSignalJobs(supabase, {
      reason: "inventory_refresh",
      priority: 40,
    })
  } catch (err) {
    console.error("Market Signals queue error:", err)
  }

  return NextResponse.json({
    message: `Synced ${result.synced} listings from PriceLabs`,
    ...result,
    reportBuilder,
    marketSignalJobs,
  })
}
