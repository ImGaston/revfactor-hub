import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { SettingsNav } from "./settings-nav"

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await getProfile()

  if (!profile) redirect("/login")

  const isSuperAdmin = profile.role === "super_admin"

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          {isSuperAdmin
            ? "Manage your account, team, clients, and listings."
            : "Manage your account and preferences."}
        </p>
      </div>
      <SettingsNav isSuperAdmin={isSuperAdmin} />
      {children}
    </div>
  )
}
