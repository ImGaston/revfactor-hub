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
      "id, name, status, email, billing_amount, onboarding_date, ending_date, assembly_client_id, listings(id, status), tasks(id, status)"
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
