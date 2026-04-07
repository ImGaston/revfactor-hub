import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"
import { getAllRolesWithPermissions } from "@/lib/permissions.server"
import { RolesManager } from "./roles-manager"

export default async function RolesSettingsPage() {
  const profile = await getProfile()
  if (!profile || profile.role !== "super_admin") redirect("/settings/account")

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
