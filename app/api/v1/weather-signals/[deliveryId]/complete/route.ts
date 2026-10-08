import { NextResponse } from "next/server"
import { z } from "zod"

import { verifyApiKey } from "@/lib/api-auth.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { weatherBotDeliveryResultSchema } from "@/lib/weather-bot"
import { finishWeatherBotDelivery } from "@/lib/weather-bot.server"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ deliveryId: string }> }
) {
  const auth = await verifyApiKey(request, "weather:deliver")
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } }
    )
  }

  const { deliveryId } = await context.params
  if (!z.uuid().safeParse(deliveryId).success) {
    return NextResponse.json(
      { error: "deliveryId must be a UUID" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    )
  }
  const parsed = weatherBotDeliveryResultSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid delivery result", details: parsed.error.flatten() },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    )
  }

  try {
    const status = await finishWeatherBotDelivery(
      createAdminClient(),
      deliveryId,
      parsed.data
    )
    return NextResponse.json(
      { ok: true, status },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    const leaseConflict = message.includes("lease is no longer valid")
    console.error("[api/v1/weather-signals/complete] finish failed:", message)
    return NextResponse.json(
      {
        error: leaseConflict
          ? "Delivery lease expired or was already completed"
          : "Internal server error",
      },
      {
        status: leaseConflict ? 409 : 500,
        headers: { "Cache-Control": "no-store" },
      }
    )
  }
}
