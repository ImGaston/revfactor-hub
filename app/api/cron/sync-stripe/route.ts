import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isStripeConfigured } from "@/lib/stripe"
import { syncStripeData } from "@/lib/stripe-sync"
import { getMarketSignalsRuntimeStatus } from "@/lib/market-signals/ingest.server"
import {
  enqueueMarketSignalJobs,
  processMarketSignalJobs,
} from "@/lib/market-signals/jobs.server"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "STRIPE_SECRET_KEY not configured" },
      { status: 500 }
    )
  }

  try {
    const supabase = createAdminClient()
    const result = await syncStripeData(supabase)
    let marketSignals:
      | Awaited<ReturnType<typeof processMarketSignalJobs>>
      | { error: string }
      | null = null
    try {
      const runtime = getMarketSignalsRuntimeStatus()
      if (runtime.ready) {
        await enqueueMarketSignalJobs(supabase, {
          reason: "scheduled",
          priority: 50,
        })
      }
      marketSignals = await processMarketSignalJobs(supabase, {
        maximumJobs: 5,
        timeBudgetMs: Math.max(30_000, 280_000 - (Date.now() - startedAt)),
        leaseSeconds: 330,
      })
    } catch (error) {
      console.error("Market Signals (chained) error:", error)
      marketSignals = {
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
    return NextResponse.json({
      message: `Synced ${result.subscriptions.upserted} subscriptions, ${result.invoices.upserted} invoices, and ${result.payouts.upserted} payouts`,
      ...result,
      marketSignals,
    })
  } catch (err) {
    console.error("Stripe sync error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
