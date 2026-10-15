import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isPriceLabsConfigured } from "@/lib/pricelabs"
import { syncPriceLabsData } from "@/lib/pricelabs-sync"
import { advanceReportBuilder } from "@/lib/report-builder/runner"
import { runListingSetupCheck } from "@/lib/listing-setup-check.server"
import { captureDailySnapshots, runOutcomeCheckpoints } from "@/lib/listing-outcomes.server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Total time budget for the function; the Report Builder gets whatever is left
// after the pl_* sync, with headroom so we never exceed maxDuration.
const FUNCTION_BUDGET_MS = 52_000
// The setup check stops starting new listings after this point.
const SETUP_CHECK_BUDGET_MS = 30_000
// Checkpoint reviews (AI summaries) stop starting new ones after this point.
const OUTCOMES_BUDGET_MS = 40_000

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

  const startedAt = Date.now()
  const supabase = createAdminClient()

  try {
    const result = await syncPriceLabsData(supabase)

    // Listing revenue setup: confirm the decided PriceLabs settings (or flag
    // drift) right after the sync. Few listings carry setup rows, so this is a
    // handful of requests; it never blocks the Report Builder for long.
    let setupCheck:
      | Awaited<ReturnType<typeof runListingSetupCheck>>
      | { error: string }
      | null = null
    try {
      setupCheck = await runListingSetupCheck(supabase, {
        deadline: startedAt + SETUP_CHECK_BUDGET_MS,
      })
      // The per-setting details stay out of the cron response.
      setupCheck = { ...setupCheck, details: [] }
    } catch (err) {
      console.error("Listing setup check (chained) error:", err)
      setupCheck = { error: err instanceof Error ? err.message : "Unknown error" }
    }

    // Listing outcomes: store today's PriceLabs market numbers (pace vs market
    // needs history the pl_* columns overwrite) and save due day-7/14/30/60/90
    // checkpoint reviews. Both are no-ops until the outcomes migration exists.
    let outcomes:
      | { snapshots: Awaited<ReturnType<typeof captureDailySnapshots>>; checkpoints: Awaited<ReturnType<typeof runOutcomeCheckpoints>> }
      | { error: string }
      | null = null
    try {
      const snapshots = await captureDailySnapshots(supabase)
      const checkpoints = await runOutcomeCheckpoints(supabase, {
        deadline: startedAt + OUTCOMES_BUDGET_MS,
      })
      outcomes = { snapshots, checkpoints }
    } catch (err) {
      console.error("Listing outcomes (chained) error:", err)
      outcomes = { error: err instanceof Error ? err.message : "Unknown error" }
    }

    // Chain the Report Builder ingestion onto the same daily cron (same API key)
    // so we don't add a separate cron job. It advances its own state machine and
    // only inline-polls with the time left in this function's budget; a slow
    // report finishes via the manual "Sync Report Builder" button or next day.
    let reportBuilder:
      | Awaited<ReturnType<typeof advanceReportBuilder>>
      | { status: string; error: string }
      | null = null
    try {
      const inlineDeadlineMs = Math.max(
        8_000,
        FUNCTION_BUDGET_MS - (Date.now() - startedAt)
      )
      reportBuilder = await advanceReportBuilder(supabase, {
        triggeredBy: "cron",
        inlineDeadlineMs,
      })
    } catch (err) {
      console.error("Report Builder (chained) error:", err)
      reportBuilder = {
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
      }
    }

    return NextResponse.json({
      message: `Synced ${result.synced} listings from PriceLabs`,
      ...result,
      setupCheck,
      outcomes,
      reportBuilder,
    })
  } catch (err) {
    console.error("PriceLabs sync error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
