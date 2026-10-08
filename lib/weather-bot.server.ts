import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  weatherBotSignalPayloadSchema,
  type WeatherBotDeliveryResult,
  type WeatherBotSignalPayload,
} from "@/lib/weather-bot"

type ClaimedDeliveryRow = {
  delivery_id: string
  lease_token: string
  attempt: number
  payload: unknown
}

type DeliveryRow = {
  id: string
  status: "queued" | "leased" | "delivered" | "failed"
  attempts: number
  payload: unknown
  slack_channel_id: string | null
  slack_message_ts: string | null
  last_error: string | null
  delivered_at: string | null
  created_at: string
}

export type WeatherBotDelivery = {
  id: string
  status: DeliveryRow["status"]
  attempts: number
  signal: WeatherBotSignalPayload
  slackChannelId: string | null
  slackMessageTs: string | null
  lastError: string | null
  deliveredAt: string | null
  createdAt: string
}

export async function enqueueWeatherBotDeliveries(
  supabase: SupabaseClient,
  marketId?: string
) {
  const { data, error } = await supabase.rpc("enqueue_weather_bot_deliveries", {
    p_market_id: marketId ?? null,
  })
  if (error) {
    throw new Error(`Failed to enqueue Weather-bot signals: ${error.message}`)
  }
  return Number(data ?? 0)
}

export async function claimWeatherBotDelivery(
  supabase: SupabaseClient,
  leaseSeconds = 300
) {
  const boundedLeaseSeconds = Math.min(900, Math.max(30, leaseSeconds))
  const { data, error } = await supabase.rpc("claim_weather_bot_delivery", {
    p_lease_seconds: boundedLeaseSeconds,
  })
  if (error) {
    throw new Error(`Failed to claim Weather-bot signal: ${error.message}`)
  }
  const row = (
    Array.isArray(data) ? data[0] : data
  ) as ClaimedDeliveryRow | null
  if (!row) return null

  const signal = weatherBotSignalPayloadSchema.parse(row.payload)
  return {
    deliveryId: row.delivery_id,
    leaseToken: row.lease_token,
    attempt: row.attempt,
    signal,
  }
}

export async function finishWeatherBotDelivery(
  supabase: SupabaseClient,
  deliveryId: string,
  result: WeatherBotDeliveryResult
) {
  const delivered = result.outcome === "delivered"
  const { data, error } = await supabase.rpc("finish_weather_bot_delivery", {
    p_delivery_id: deliveryId,
    p_lease_token: result.leaseToken,
    p_delivered: delivered,
    p_slack_channel_id: delivered ? result.slackChannelId : null,
    p_slack_message_ts: delivered ? result.slackMessageTs : null,
    p_error: delivered ? null : result.error,
  })
  if (error) {
    throw new Error(`Failed to finish Weather-bot delivery: ${error.message}`)
  }
  return String(data)
}

export async function listWeatherBotDeliveries(
  supabase: SupabaseClient,
  options?: {
    market?: string
    status?: DeliveryRow["status"]
    since?: string
    limit?: number
  }
) {
  const limit = Math.min(100, Math.max(1, options?.limit ?? 25))
  // Fetch a bounded superset because the market slug lives inside the immutable
  // JSON snapshot. This avoids exposing an unindexed, caller-controlled JSON
  // filter while the active pilot has a small number of markets.
  const fetchLimit = options?.market ? Math.min(500, limit * 10) : limit
  let query = supabase
    .from("weather_bot_deliveries")
    .select(
      "id, status, attempts, payload, slack_channel_id, slack_message_ts, last_error, delivered_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(fetchLimit)

  if (options?.status) query = query.eq("status", options.status)
  if (options?.since) query = query.gte("created_at", options.since)

  const { data, error } = await query
  if (error) {
    throw new Error(`Failed to list Weather-bot signals: ${error.message}`)
  }

  const deliveries = ((data ?? []) as DeliveryRow[]).flatMap(
    (row): WeatherBotDelivery[] => {
      const parsed = weatherBotSignalPayloadSchema.safeParse(row.payload)
      if (!parsed.success) return []
      if (options?.market && parsed.data.market.slug !== options.market)
        return []
      return [
        {
          id: row.id,
          status: row.status,
          attempts: row.attempts,
          signal: parsed.data,
          slackChannelId: row.slack_channel_id,
          slackMessageTs: row.slack_message_ts,
          lastError: row.last_error,
          deliveredAt: row.delivered_at,
          createdAt: row.created_at,
        },
      ]
    }
  )

  return deliveries.slice(0, limit)
}
