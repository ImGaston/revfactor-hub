import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { ListingsView } from "./listings-view"

export default async function ListingsPage() {
  const supabase = await createClient()

  const [{ data: listings }, canEdit, canDelete] = await Promise.all([
    supabase
      .from("listings")
      .select(
        "id, name, status, listing_id, pricelabs_link, airbnb_link, city, state, client_id, initial_setup_date, adjustment_confirmed_date, deactivated_date, clients:clients_basic(id, name, status)"
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
      status: l.status as string,
      listing_id: l.listing_id as string | null,
      pricelabs_link: l.pricelabs_link as string | null,
      airbnb_link: l.airbnb_link as string | null,
      city: l.city as string | null,
      state: l.state as string | null,
      client_id: l.client_id as string,
      initial_setup_date: l.initial_setup_date as string | null,
      adjustment_confirmed_date: l.adjustment_confirmed_date as string | null,
      deactivated_date: l.deactivated_date as string | null,
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
