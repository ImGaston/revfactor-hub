import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { isAssemblyConfigured } from "@/lib/assembly"
import { ClientsSettings } from "./clients-settings"

export default async function SettingsClientsPage() {
  const [profile, canEdit] = await Promise.all([
    getProfile(),
    hasPermission("clients", "edit"),
  ])
  if (!profile || !canEdit) redirect("/settings/account")

  const supabase = await createClient()
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, email, status, assembly_link, assembly_client_id, assembly_company_id, onboarding_date, ending_date, ending_reason_tags, ending_note, billing_amount, autopayment_set_up, stripe_dashboard, pms_name, has_vrbo, listings(id)")
    .order("name")

  const isSuperAdmin = profile.role === "super_admin"

  return (
    <ClientsSettings
      clients={
        clients?.map((c) => ({
          ...c,
          // Churn reason data is super_admin-only, like billing_amount.
          ending_reason_tags: isSuperAdmin ? (c.ending_reason_tags ?? []) : [],
          ending_note: isSuperAdmin ? c.ending_note : null,
          listingCount: c.listings?.length ?? 0,
        })) ?? []
      }
      assemblyConfigured={isAssemblyConfigured()}
      isSuperAdmin={isSuperAdmin}
    />
  )
}
