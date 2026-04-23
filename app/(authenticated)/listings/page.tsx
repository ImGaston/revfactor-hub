import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { ListingsView } from "./listings-view"

export default async function ListingsPage() {
  const supabase = await createClient()

  const [{ data: listings }, canEdit, canDelete] = await Promise.all([
    supabase
      .from("listings")
      .select(
        "id, name, listing_id, pricelabs_link, airbnb_link, city, state, client_id, clients(id, name, status)"
      )
      .order("name"),
    hasPermission("listings", "edit"),
    hasPermission("listings", "delete"),
  ])

  const flatListings = (listings ?? []).map((l: Record<string, unknown>) => {
    const client = l.clients as {
      id: string
      name: string
      status: string
    } | null
    return {
      id: l.id as string,
      name: l.name as string,
      listing_id: l.listing_id as string | null,
      pricelabs_link: l.pricelabs_link as string | null,
      airbnb_link: l.airbnb_link as string | null,
      city: l.city as string | null,
      state: l.state as string | null,
      client_id: l.client_id as string,
      client_name: client?.name ?? null,
      client_status: client?.status ?? null,
    }
  })

  return (
    <ListingsView
      listings={flatListings}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  )
}
