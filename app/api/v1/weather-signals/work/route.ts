import { NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { getMarketSignalsRuntimeStatus } from "@/lib/market-signals/ingest.server"
import {
  enqueueMarketSignalJobs,
  processMarketSignalJobs,
} from "@/lib/market-signals/jobs.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { weatherBotWorkRequestSchema } from "@/lib/weather-bot"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await verifyApiKey(request, "weather:work")
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } }
    )
  }

  let body: unknown = {}
  try {
    const rawBody = await request.text()
    if (rawBody.trim()) body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    )
  }
  const parsed = weatherBotWorkRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid worker request", details: parsed.error.flatten() },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    )
  }

  const runtime = getMarketSignalsRuntimeStatus()
  if (!runtime.serviceRoleConfigured || !runtime.nwsConfigured) {
    return NextResponse.json(
      {
        error:
          "Weather ingestion requires SUPABASE_SERVICE_ROLE_KEY and NWS_USER_AGENT",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    )
  }

  try {
    const supabase = createAdminClient()
    const enqueued = await enqueueMarketSignalJobs(supabase, {
      reason: "scheduled",
      priority: 60,
    })
    const result = await processMarketSignalJobs(supabase, {
      maximumJobs: parsed.data.maximumJobs,
      timeBudgetMs: 270_000,
      leaseSeconds: 330,
    })
    return NextResponse.json(
      { ok: result.failed === 0, enqueued, ...result },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error(
      "[api/v1/weather-signals/work] worker failed:",
      error instanceof Error ? error.message : error
    )
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
