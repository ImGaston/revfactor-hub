import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isPriceLabsConfigured } from "@/lib/pricelabs"
import { syncPriceLabsData } from "@/lib/pricelabs-sync"
import { advanceReportBuilder } from "@/lib/report-builder/runner"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Total time budget for the function; the Report Builder gets whatever is left
// after the pl_* sync, with headroom so we never exceed maxDuration.
const FUNCTION_BUDGET_MS = 52_000

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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

    // Chain the Report Builder ingestion onto the same daily cron (same API key)
    // so we don't add a separate cron job. It advances its own state machine and
    // only inline-polls with the time left in this function's budget; a slow
    // report finishes via the manual "Sync Report Builder" button or next day.
    let reportBuilder: Awaited<ReturnType<typeof advanceReportBuilder>> | { status: string; error: string } | null = null
    try {
      const inlineDeadlineMs = Math.max(8_000, FUNCTION_BUDGET_MS - (Date.now() - startedAt))
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
