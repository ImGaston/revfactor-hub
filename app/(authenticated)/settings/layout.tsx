import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { getRolePermissions } from "@/lib/permissions.server"
import { ACTIONS, RESOURCES, buildPermissionMap } from "@/lib/permissions"
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
    // super_admin has all permissions. Derived from the canonical
    // RESOURCES × ACTIONS grid rather than a hand-written list: the previous
    // hardcoded array silently hid any tab whose permission nobody remembered
    // to add to it.
    permissions = Object.fromEntries(
      RESOURCES.flatMap((r) => ACTIONS.map((a) => [`${r.key}:${a}`, true]))
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
