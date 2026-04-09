import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  fetchPriceLabsListings,
  isPriceLabsConfigured,
  parseRevenue,
} from "@/lib/pricelabs"

export const dynamic = "force-dynamic"
export const maxDuration = 60

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

  try {
    const supabase = createAdminClient()

    // Fetch all listings from our DB that have a listing_id (PriceLabs ID)
    const { data: dbListings, error: dbError } = await supabase
      .from("listings")
      .select("id, listing_id")
      .not("listing_id", "is", null)

    if (dbError) {
      return NextResponse.json(
        { error: `DB error: ${dbError.message}` },
        { status: 500 }
      )
    }

    if (!dbListings?.length) {
      return NextResponse.json({
        message: "No listings with listing_id found",
        synced: 0,
      })
    }

    // Build a lookup map: PriceLabs ID → Supabase UUID
    const idMap = new Map<string, string>()
    for (const row of dbListings) {
      if (row.listing_id) {
        idMap.set(row.listing_id, row.id)
      }
    }

    // Fetch all listings from PriceLabs API
    const plListings = await fetchPriceLabsListings(false)

    let synced = 0
    const errors: string[] = []
    const now = new Date().toISOString()

    for (const pl of plListings) {
      const supabaseId = idMap.get(pl.id)
      if (!supabaseId) continue

      const { error: updateError } = await supabase
        .from("listings")
        .update({
          pl_base_price: pl.base,
          pl_min_price: pl.min,
          pl_max_price: pl.max,
          pl_recommended_base_price: pl.recommended_base_price,
          pl_cleaning_fees: pl.cleaning_fees,
          pl_no_of_bedrooms: pl.no_of_bedrooms,
          pl_occupancy_next_7: pl.occupancy_next_7,
          pl_market_occupancy_next_7: pl.market_occupancy_next_7,
          pl_occupancy_next_30: pl.occupancy_next_30,
          pl_market_occupancy_next_30: pl.market_occupancy_next_30,
          pl_occupancy_next_60: pl.occupancy_next_60,
          pl_market_occupancy_next_60: pl.market_occupancy_next_60,
          pl_occupancy_past_90: pl.occupancy_past_90,
          pl_market_occupancy_past_90: pl.market_occupancy_past_90,
          pl_revenue_past_7: parseRevenue(pl.revenue_past_7),
          pl_stly_revenue_past_7: parseRevenue(pl.stly_revenue_past_7),
          pl_push_enabled: pl.push_enabled,
          pl_last_refreshed_at: pl.last_refreshed_at,
          pl_synced_at: now,
          updated_at: now,
        })
        .eq("id", supabaseId)

      if (updateError) {
        errors.push(`${pl.id}: ${updateError.message}`)
      } else {
        synced++
      }
    }

    return NextResponse.json({
      message: `Synced ${synced} listings from PriceLabs`,
      synced,
      total_pl: plListings.length,
      total_db: dbListings.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    console.error("PriceLabs sync error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
