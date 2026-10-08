import { NextRequest, NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { listWeatherBotDeliveries } from "@/lib/weather-bot.server"

export const dynamic = "force-dynamic"

const DELIVERY_STATUSES = new Set(["queued", "leased", "delivered", "failed"])

function apiError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  )
}

export async function GET(request: NextRequest) {
  const auth = await verifyApiKey(request, "weather:read")
  if (!auth.ok) return apiError(auth.error, auth.status)

  const params = request.nextUrl.searchParams
  const market = params.get("market")?.trim() || undefined
  if (market && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(market)) {
    return apiError("market must be a valid market slug", 400)
  }

  const status = params.get("status")?.trim() || undefined
  if (status && !DELIVERY_STATUSES.has(status)) {
    return apiError("status must be queued, leased, delivered, or failed", 400)
  }

  const since = params.get("since")?.trim() || undefined
  if (since && Number.isNaN(Date.parse(since))) {
    return apiError("since must be a valid ISO 8601 timestamp", 400)
  }

  const rawLimit = params.get("limit")
  if (rawLimit && !/^\d+$/.test(rawLimit)) {
    return apiError("limit must be a positive integer", 400)
  }

  try {
    const signals = await listWeatherBotDeliveries(createAdminClient(), {
      market,
      status: status as
        | "queued"
        | "leased"
        | "delivered"
        | "failed"
        | undefined,
      since,
      limit: Math.min(Number(rawLimit) || 25, 100),
    })
    return NextResponse.json(
      {
        data: signals,
        meta: {
          count: signals.length,
          generatedAt: new Date().toISOString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error(
      "[api/v1/weather-signals] list failed:",
      error instanceof Error ? error.message : error
    )
    return apiError("Internal server error", 500)
  }
}
