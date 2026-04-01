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
      "id, name, status, billing_amount, onboarding_date, ending_date, autopayment_set_up, stripe_dashboard, email, assembly_link, listings(id, name, listing_id, pricelabs_link, airbnb_link, city, state), tasks(id, title, status, owner, tag, profiles(full_name, email))"
    )
    .order("name")

  return (
    <ClientsView
      clients={clients ?? []}
      isSuperAdmin={profile?.role === "super_admin"}
    />
  )
}
