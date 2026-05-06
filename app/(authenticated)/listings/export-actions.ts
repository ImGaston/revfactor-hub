"use server"

import { createClient } from "@/lib/supabase/server"

export type ListingExportRow = {
  name: string
  client_name: string | null
  client_status: string | null
  city: string | null
  state: string | null
  listing_id: string | null
  airbnb_link: string | null
  pricelabs_link: string | null
  status: string
  base_price: number | null
  min_price: number | null
  max_price: number | null
  recommended_base_price: number | null
  cleaning_fees: number | null
  bedrooms: number | null
  occ_7d: number | null
  market_occ_7d: number | null
  occ_30d: number | null
  market_occ_30d: number | null
  occ_past_90d: number | null
  market_occ_past_90d: number | null
  mpi_30d: number | null
  mpi_60d: number | null
  last_booked_date: string | null
  wknd_occ_30d: number | null
  market_wknd_occ_30d: number | null
  pl_synced_at: string | null
}

export async function getListingsExportData(
  listingIds: string[]
): Promise<ListingExportRow[]> {
  if (listingIds.length === 0) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("listings")
    .select(
      `id, name, listing_id, pricelabs_link, airbnb_link, city, state, status,
       clients(name, status),
       pl_base_price, pl_min_price, pl_max_price, pl_recommended_base_price,
       pl_cleaning_fees, pl_no_of_bedrooms,
       pl_occupancy_next_7, pl_market_occupancy_next_7,
       pl_occupancy_next_30, pl_market_occupancy_next_30,
       pl_occupancy_past_90, pl_market_occupancy_past_90,
       pl_mpi_next_30, pl_mpi_next_60, pl_last_booked_date,
       pl_wknd_occupancy_next_30, pl_market_wknd_occupancy_next_30,
       pl_synced_at`
    )
    .in("id", listingIds)
    .order("name")

  if (error) throw new Error(error.message)

  return (data ?? []).map((l) => {
    const client = l.clients as unknown as { name: string; status: string } | null
    return {
      name: l.name,
      client_name: client?.name ?? null,
      client_status: client?.status ?? null,
      city: l.city,
      state: l.state,
      listing_id: l.listing_id,
      airbnb_link: l.airbnb_link,
      pricelabs_link: l.pricelabs_link,
      status: l.status,
      base_price: l.pl_base_price,
      min_price: l.pl_min_price,
      max_price: l.pl_max_price,
      recommended_base_price: l.pl_recommended_base_price,
      cleaning_fees: l.pl_cleaning_fees,
      bedrooms: l.pl_no_of_bedrooms,
      occ_7d: l.pl_occupancy_next_7,
      market_occ_7d: l.pl_market_occupancy_next_7,
      occ_30d: l.pl_occupancy_next_30,
      market_occ_30d: l.pl_market_occupancy_next_30,
      occ_past_90d: l.pl_occupancy_past_90,
      market_occ_past_90d: l.pl_market_occupancy_past_90,
      mpi_30d: l.pl_mpi_next_30,
      mpi_60d: l.pl_mpi_next_60,
      last_booked_date: l.pl_last_booked_date,
      wknd_occ_30d: l.pl_wknd_occupancy_next_30,
      market_wknd_occ_30d: l.pl_market_wknd_occupancy_next_30,
      pl_synced_at: l.pl_synced_at,
    }
  })
}
