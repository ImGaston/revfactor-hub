"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  fetchPriceLabsListings,
  isPriceLabsConfigured,
  parseRevenue,
} from "@/lib/pricelabs"

type ListingInput = {
  client_id: string
  name: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
}

export async function createListingAction(input: ListingInput) {
  const supabase = await createClient()
  const { error } = await supabase.from("listings").insert(input)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function updateListingAction(id: string, input: ListingInput) {
  const supabase = await createClient()
  const { error } = await supabase.from("listings").update(input).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function deleteListingAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("listings").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/settings/listings")
  revalidatePath("/clients")
  return { error: null }
}

export async function syncPriceLabsAction() {
  if (!isPriceLabsConfigured()) {
    return { error: "PRICELABS_API_KEY not configured", synced: 0 }
  }

  const supabase = createAdminClient()

  const { data: dbListings, error: dbError } = await supabase
    .from("listings")
    .select("id, listing_id")
    .not("listing_id", "is", null)

  if (dbError) return { error: dbError.message, synced: 0 }
  if (!dbListings?.length) return { error: null, synced: 0 }

  const idMap = new Map<string, string>()
  for (const row of dbListings) {
    if (row.listing_id) idMap.set(row.listing_id, row.id)
  }

  try {
    const plListings = await fetchPriceLabsListings(false)
    let synced = 0
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

      if (!updateError) synced++
    }

    revalidatePath("/settings/listings")
    revalidatePath("/listings")
    return { error: null, synced }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unknown error",
      synced: 0,
    }
  }
}
