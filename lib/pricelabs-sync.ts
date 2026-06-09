import type { SupabaseClient } from "@supabase/supabase-js"
import {
  fetchPriceLabsListings,
  parseNullableNumber,
  parseOccupancy,
  parsePriceLabsDate,
  type PriceLabsListing,
} from "@/lib/pricelabs"

export type PriceLabsSyncStatus = "synced" | "not_found" | "failed"

export type PriceLabsListingSyncResult = {
  listingId: string
  priceLabsId: string
  status: PriceLabsSyncStatus
  syncedAt: string | null
  error?: string
}

export type PriceLabsSyncResult = {
  synced: number
  notFound: number
  failed: number
  totalDb: number
  totalPriceLabs: number
  results: PriceLabsListingSyncResult[]
}

type DbListing = {
  id: string
  listing_id: string | null
}

type PriceLabsSyncDependencies = {
  fetchListings?: () => Promise<PriceLabsListing[]>
  now?: () => string
  logger?: Pick<Console, "info" | "warn" | "error">
}

export function buildPriceLabsUpdate(
  listing: PriceLabsListing,
  syncedAt: string
): Record<string, unknown> {
  return {
    pl_base_price: parseNullableNumber(listing.base),
    pl_min_price: parseNullableNumber(listing.min),
    pl_max_price: parseNullableNumber(listing.max),
    pl_recommended_base_price: parseNullableNumber(
      listing.recommended_base_price
    ),
    pl_cleaning_fees: parseNullableNumber(listing.cleaning_fees),
    pl_no_of_bedrooms: parseNullableNumber(listing.no_of_bedrooms),
    pl_occupancy_next_7: parseOccupancy(listing.occupancy_next_7),
    pl_market_occupancy_next_7: parseOccupancy(listing.market_occupancy_next_7),
    pl_occupancy_next_30: parseOccupancy(listing.adjusted_occupancy_next_30),
    pl_market_occupancy_next_30: parseOccupancy(
      listing.market_adjusted_occupancy_next_30
    ),
    pl_occupancy_past_90: parseOccupancy(listing.adjusted_occupancy_next_90),
    pl_market_occupancy_past_90: parseOccupancy(
      listing.market_adjusted_occupancy_next_90
    ),
    pl_mpi_next_30: parseNullableNumber(listing.mpi_next_30),
    pl_mpi_next_60: parseNullableNumber(listing.mpi_next_60),
    pl_last_booked_date: parsePriceLabsDate(listing.last_booked_date),
    pl_wknd_occupancy_next_30: parseOccupancy(
      listing.weekend_adjusted_occupancy_next_30
    ),
    pl_market_wknd_occupancy_next_30: parseOccupancy(
      listing.market_weekend_adjusted_occupancy_next_30
    ),
    pl_push_enabled:
      typeof listing.push_enabled === "boolean" ? listing.push_enabled : null,
    pl_last_refreshed_at: parsePriceLabsDate(listing.last_refreshed_at),
    pl_synced_at: syncedAt,
    updated_at: syncedAt,
  }
}

export async function syncPriceLabsData(
  supabase: SupabaseClient,
  dependencies: PriceLabsSyncDependencies = {}
): Promise<PriceLabsSyncResult> {
  const fetchListings =
    dependencies.fetchListings ?? (() => fetchPriceLabsListings(false))
  const now = dependencies.now ?? (() => new Date().toISOString())
  const logger = dependencies.logger ?? console

  const { data, error: dbError } = await supabase
    .from("listings")
    .select("id, listing_id")
    .not("listing_id", "is", null)

  if (dbError) {
    throw new Error(`PriceLabs sync database read failed: ${dbError.message}`)
  }

  const dbListings = (data ?? []) as DbListing[]
  if (dbListings.length === 0) {
    return {
      synced: 0,
      notFound: 0,
      failed: 0,
      totalDb: 0,
      totalPriceLabs: 0,
      results: [],
    }
  }

  const dbByPriceLabsId = new Map<string, DbListing[]>()
  for (const listing of dbListings) {
    const priceLabsId = listing.listing_id?.trim()
    if (!priceLabsId) continue
    const matches = dbByPriceLabsId.get(priceLabsId) ?? []
    matches.push(listing)
    dbByPriceLabsId.set(priceLabsId, matches)
  }

  const duplicateIds = Array.from(dbByPriceLabsId.entries())
    .filter(([, listings]) => listings.length > 1)
    .map(([priceLabsId, listings]) => ({
      priceLabsId,
      listingIds: listings.map((listing) => listing.id),
    }))

  if (duplicateIds.length > 0) {
    logger.warn("PriceLabs sync found duplicate listing IDs", { duplicateIds })
  }

  const priceLabsListings = await fetchListings()
  const priceLabsById = new Map(
    priceLabsListings.map((listing) => [String(listing.id).trim(), listing])
  )
  const syncedAt = now()
  const results: PriceLabsListingSyncResult[] = []

  for (const dbListing of dbListings) {
    const priceLabsId = dbListing.listing_id?.trim() ?? ""
    const priceLabsListing = priceLabsById.get(priceLabsId)

    if (!priceLabsListing) {
      results.push({
        listingId: dbListing.id,
        priceLabsId,
        status: "not_found",
        syncedAt: null,
      })
      continue
    }

    const { data: updatedListing, error: updateError } = await supabase
      .from("listings")
      .update(buildPriceLabsUpdate(priceLabsListing, syncedAt))
      .eq("id", dbListing.id)
      .select("id")
      .maybeSingle()

    if (updateError || !updatedListing) {
      const error = updateError?.message ?? "Update returned no listing"
      logger.error("PriceLabs listing sync failed", {
        listingId: dbListing.id,
        priceLabsId,
        error,
      })
      results.push({
        listingId: dbListing.id,
        priceLabsId,
        status: "failed",
        syncedAt: null,
        error,
      })
      continue
    }

    results.push({
      listingId: dbListing.id,
      priceLabsId,
      status: "synced",
      syncedAt,
    })
  }

  const result = {
    synced: results.filter((item) => item.status === "synced").length,
    notFound: results.filter((item) => item.status === "not_found").length,
    failed: results.filter((item) => item.status === "failed").length,
    totalDb: dbListings.length,
    totalPriceLabs: priceLabsListings.length,
    results,
  }

  logger.info("PriceLabs sync completed", {
    synced: result.synced,
    notFound: result.notFound,
    failed: result.failed,
    totalDb: result.totalDb,
    totalPriceLabs: result.totalPriceLabs,
  })

  return result
}
