import { redirect } from "next/navigation"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { AdjustmentTypesManager } from "./adjustment-types-manager"

export default async function AdjustmentTypesSettingsPage() {
  const canEdit = await hasPermission("settings", "edit")
  if (!canEdit) redirect("/settings/account")

  const supabase = await createClient()
  const { data: settings } = await supabase
    .from("adjustment_type_settings")
    .select("type, internal_enabled, hostpricing_enabled")

  return <AdjustmentTypesManager settings={settings ?? []} />
}
