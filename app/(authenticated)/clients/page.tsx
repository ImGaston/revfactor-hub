import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import { ClientsView } from "@/components/clients/clients-view"

export default async function ClientsPage() {
  const [supabase, profile] = await Promise.all([
    createClient(),
    getProfile(),
  ])

  const { data: clients } = await supabase
    .from("clients")
    .select(
      "id, name, status, billing_amount, onboarding_date, ending_date, autopayment_set_up, stripe_dashboard, email, assembly_link, assembly_client_id, assembly_company_id, listings(id, name, status, listing_id, pricelabs_link, airbnb_link, city, state, pl_occupancy_next_7, pl_market_occupancy_next_7, pl_occupancy_next_30, pl_market_occupancy_next_30, pl_mpi_next_30, pl_last_booked_date), tasks(id, title, status, owner, tags, profiles(full_name, email))"
    )
    .order("name")

  const filteredClients = (clients ?? []).map((c) => ({
    ...c,
    listings: (c.listings ?? []).filter((l: { status?: string }) => l.status !== "inactive"),
  }))

  return (
    <ClientsView
      clients={filteredClients}
      isSuperAdmin={profile?.role === "super_admin"}
    />
  )
}
