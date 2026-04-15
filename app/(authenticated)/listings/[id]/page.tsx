import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { ListingDetail } from "./listing-detail"

export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: listing } = await supabase
    .from("listings")
    .select(
      `id, name, status, listing_id, pricelabs_link, airbnb_link, city, state, client_id, created_at, updated_at,
       pl_base_price, pl_min_price, pl_max_price, pl_recommended_base_price,
       pl_cleaning_fees, pl_no_of_bedrooms,
       pl_occupancy_next_7, pl_market_occupancy_next_7,
       pl_occupancy_next_30, pl_market_occupancy_next_30,
       pl_occupancy_past_90, pl_market_occupancy_past_90,
       pl_mpi_next_30, pl_mpi_next_60, pl_last_booked_date,
       pl_wknd_occupancy_next_30, pl_market_wknd_occupancy_next_30,
       pl_push_enabled, pl_last_refreshed_at, pl_synced_at,
       clients(id, name, status)`
    )
    .eq("id", id)
    .single()

  if (!listing) notFound()

  const clientRaw = listing.clients as
    | { id: string; name: string; status: string }
    | { id: string; name: string; status: string }[]
    | null
  const client = Array.isArray(clientRaw) ? clientRaw[0] ?? null : clientRaw

  return (
    <ListingDetail
      listing={{
        id: listing.id,
        name: listing.name,
        status: listing.status,
        listing_id: listing.listing_id,
        pricelabs_link: listing.pricelabs_link,
        airbnb_link: listing.airbnb_link,
        city: listing.city,
        state: listing.state,
        client_id: listing.client_id,
        created_at: listing.created_at,
        updated_at: listing.updated_at,
        pl_base_price: listing.pl_base_price,
        pl_min_price: listing.pl_min_price,
        pl_max_price: listing.pl_max_price,
        pl_recommended_base_price: listing.pl_recommended_base_price,
        pl_cleaning_fees: listing.pl_cleaning_fees,
        pl_no_of_bedrooms: listing.pl_no_of_bedrooms,
        pl_occupancy_next_7: listing.pl_occupancy_next_7,
        pl_market_occupancy_next_7: listing.pl_market_occupancy_next_7,
        pl_occupancy_next_30: listing.pl_occupancy_next_30,
        pl_market_occupancy_next_30: listing.pl_market_occupancy_next_30,
        pl_occupancy_past_90: listing.pl_occupancy_past_90,
        pl_market_occupancy_past_90: listing.pl_market_occupancy_past_90,
        pl_mpi_next_30: listing.pl_mpi_next_30,
        pl_mpi_next_60: listing.pl_mpi_next_60,
        pl_last_booked_date: listing.pl_last_booked_date,
        pl_wknd_occupancy_next_30: listing.pl_wknd_occupancy_next_30,
        pl_market_wknd_occupancy_next_30: listing.pl_market_wknd_occupancy_next_30,
        pl_push_enabled: listing.pl_push_enabled,
        pl_last_refreshed_at: listing.pl_last_refreshed_at,
        pl_synced_at: listing.pl_synced_at,
      }}
      client={client}
    />
  )
}
