import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import { ClientsView } from "@/components/clients/clients-view"
import { getClientStripeBilling } from "@/lib/client-stripe-billing"

export default async function ClientsPage() {
  const [supabase, profile] = await Promise.all([
    createClient(),
    getProfile(),
  ])

  const isSuperAdmin = profile?.role === "super_admin"
  const [{ data: clients }, billingByClient] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, status, email, billing_amount, onboarding_date, ending_date, assembly_client_id, listings(id, status), tasks(id, status)"
      )
      .order("name"),
    isSuperAdmin
      ? getClientStripeBilling(supabase)
      : Promise.resolve(new Map<string, number>()),
  ])

  const filteredClients = (clients ?? []).map((c) => ({
    ...c,
    billing_amount: isSuperAdmin ? (billingByClient.get(c.id) ?? null) : null,
    listings: (c.listings ?? []).filter((l: { status?: string }) => l.status !== "inactive"),
  }))

  return (
    <ClientsView
      clients={filteredClients}
      isSuperAdmin={isSuperAdmin}
    />
  )
}
