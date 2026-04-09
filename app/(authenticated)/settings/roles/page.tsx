import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { getAllRolesWithPermissions } from "@/lib/permissions.server"
import { RolesManager } from "./roles-manager"

export default async function RolesSettingsPage() {
  const [profile, canEdit] = await Promise.all([
    getProfile(),
    hasPermission("users", "edit"),
  ])
  if (!profile || !canEdit) redirect("/settings/account")

  const [roles, supabase] = await Promise.all([
    getAllRolesWithPermissions(),
    createClient(),
  ])

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, role")
    .order("created_at")

  return (
    <RolesManager
      roles={roles}
      users={profiles ?? []}
    />
  )
}
