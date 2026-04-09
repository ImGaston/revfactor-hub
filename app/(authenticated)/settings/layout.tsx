import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { getRolePermissions } from "@/lib/permissions.server"
import { buildPermissionMap } from "@/lib/permissions"
import { SettingsNav } from "./settings-nav"

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await getProfile()

  if (!profile) redirect("/login")

  const isSuperAdmin = profile.role === "super_admin"

  // Build permission map for the nav tabs
  let permissions: Record<string, boolean> = {}
  if (isSuperAdmin) {
    // super_admin has all permissions
    permissions = Object.fromEntries(
      ["users:view", "users:edit", "clients:edit", "listings:edit", "settings:edit", "onboarding:edit"].map(
        (k) => [k, true]
      )
    )
  } else {
    const rolePerms = await getRolePermissions(profile.role)
    permissions = buildPermissionMap(rolePerms)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and preferences.
        </p>
      </div>
      <SettingsNav permissions={permissions} />
      {children}
    </div>
  )
}
