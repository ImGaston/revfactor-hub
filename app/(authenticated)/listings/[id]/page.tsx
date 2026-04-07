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
      "id, name, listing_id, pricelabs_link, airbnb_link, city, state, client_id, created_at, updated_at, clients(id, name, status)"
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
        listing_id: listing.listing_id,
        pricelabs_link: listing.pricelabs_link,
        airbnb_link: listing.airbnb_link,
        city: listing.city,
        state: listing.state,
        client_id: listing.client_id,
        created_at: listing.created_at,
        updated_at: listing.updated_at,
      }}
      client={client}
    />
  )
}
