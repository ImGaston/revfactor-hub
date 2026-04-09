import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { InviteUserDialog } from "./invite-user-dialog"
import { UsersTable } from "./users-table"

export default async function UsersSettingsPage() {
  const [profile, canView] = await Promise.all([
    getProfile(),
    hasPermission("users", "view"),
  ])
  if (!profile || !canView) redirect("/settings/account")

  const supabase = await createClient()

  const [{ data: profiles }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true }),
    supabase
      .from("roles")
      .select("name, description, is_system")
      .order("is_system", { ascending: false })
      .order("name"),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage team members and their roles.
        </p>
        <InviteUserDialog roles={roles ?? []} />
      </div>

      <UsersTable
        users={profiles ?? []}
        roles={roles ?? []}
        currentUserId={profile.id}
      />
    </div>
  )
}
