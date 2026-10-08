import { NextResponse } from "next/server"

import { verifyApiKey } from "@/lib/api-auth.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { weatherBotSlackSummary } from "@/lib/weather-bot"
import { claimWeatherBotDelivery } from "@/lib/weather-bot.server"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const auth = await verifyApiKey(request, "weather:deliver")
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } }
    )
  }

  try {
    const delivery = await claimWeatherBotDelivery(createAdminClient(), 300)
    if (!delivery) {
      return new NextResponse(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      })
    }

    const hubUrl = new URL(delivery.signal.hubUrl, request.url).toString()
    return NextResponse.json(
      {
        ...delivery,
        signal: { ...delivery.signal, hubUrl },
        suggestedSlackMessage: weatherBotSlackSummary(delivery.signal),
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error(
      "[api/v1/weather-signals/claim] claim failed:",
      error instanceof Error ? error.message : error
    )
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
