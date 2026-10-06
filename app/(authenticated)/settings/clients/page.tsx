import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { isAssemblyConfigured } from "@/lib/assembly"
import { ClientsSettings } from "./clients-settings"

export default async function SettingsClientsPage() {
  const [profile, canEdit, canViewChurn, canEditChurn] = await Promise.all([
    getProfile(),
    hasPermission("clients", "edit"),
    hasPermission("churn", "view"),
    hasPermission("churn", "edit"),
  ])
  if (!profile || !canEdit) redirect("/settings/account")

  const supabase = await createClient()
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, email, status, assembly_link, assembly_client_id, assembly_company_id, onboarding_date, ending_date, ending_reason_tags, ending_note, billing_amount, autopayment_set_up, stripe_dashboard, pms_name, has_vrbo, billing_entity, listings(id)")
    .order("name")

  const isSuperAdmin = profile.role === "super_admin"

  return (
    <ClientsSettings
      clients={
        clients?.map((c) => ({
          ...c,
          // Churn access is operational; financial fields stay super-admin-only.
          ending_reason_tags: canViewChurn ? (c.ending_reason_tags ?? []) : [],
          ending_note: canViewChurn ? c.ending_note : null,
          billing_amount: isSuperAdmin ? c.billing_amount : null,
          autopayment_set_up: isSuperAdmin ? c.autopayment_set_up : false,
          stripe_dashboard: isSuperAdmin ? c.stripe_dashboard : null,
          listingCount: c.listings?.length ?? 0,
        })) ?? []
      }
      assemblyConfigured={isAssemblyConfigured()}
      isSuperAdmin={isSuperAdmin}
      canEditChurn={canViewChurn && canEditChurn}
    />
  )
}
