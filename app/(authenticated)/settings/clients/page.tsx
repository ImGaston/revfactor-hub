import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"
import { ClientsSettings } from "./clients-settings"

export default async function SettingsClientsPage() {
  const profile = await getProfile()
  if (!profile || profile.role !== "super_admin") redirect("/settings/account")

  const supabase = await createClient()
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, email, status, assembly_link, onboarding_date, ending_date, billing_amount, autopayment_set_up, stripe_dashboard, listings(id)")
    .order("name")

  return (
    <ClientsSettings
      clients={
        clients?.map((c) => ({
          ...c,
          listingCount: c.listings?.length ?? 0,
        })) ?? []
      }
    />
  )
}
