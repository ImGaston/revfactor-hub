import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isStripeConfigured } from "@/lib/stripe"
import { syncStripeData } from "@/lib/stripe-sync"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "STRIPE_SECRET_KEY not configured" },
      { status: 500 },
    )
  }

  try {
    const supabase = createAdminClient()
    const result = await syncStripeData(supabase)
    return NextResponse.json({
      message: `Synced ${result.subscriptions.upserted} subscriptions and ${result.invoices.upserted} invoices`,
      ...result,
    })
  } catch (err) {
    console.error("Stripe sync error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
