import { redirect } from "next/navigation"
import { hasPermission } from "@/lib/permissions.server"
import { getNavConfig } from "@/lib/navigation.server"
import { NavigationManager } from "./navigation-manager"

export default async function NavigationSettingsPage() {
  const canEdit = await hasPermission("settings", "edit")
  if (!canEdit) redirect("/settings/account")

  const config = await getNavConfig()
  return <NavigationManager initialConfig={config} />
}
