import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { ListingsSettings } from "./listings-settings"

export default async function SettingsListingsPage() {
  const [profile, canEdit] = await Promise.all([
    getProfile(),
    hasPermission("listings", "edit"),
  ])
  if (!profile || !canEdit) redirect("/settings/account")

  const supabase = await createClient()

  const { data: listings } = await supabase
    .from("listings")
    .select("id, name, status, listing_id, pricelabs_link, airbnb_link, city, state, client_id, clients(id, name)")
    .order("name")

  const flatListings = (listings ?? []).map((l: Record<string, unknown>) => {
    const client = l.clients as { id: string; name: string } | null
    return {
      id: l.id as string,
      name: l.name as string,
      status: (l.status as string) ?? "active",
      listing_id: l.listing_id as string | null,
      pricelabs_link: l.pricelabs_link as string | null,
      airbnb_link: l.airbnb_link as string | null,
      city: l.city as string | null,
      state: l.state as string | null,
      client_id: l.client_id as string,
      client_name: client?.name ?? null,
    }
  })

  return <ListingsSettings listings={flatListings} />
}
