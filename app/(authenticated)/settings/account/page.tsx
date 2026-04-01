import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { AvatarUpload } from "./avatar-upload"
import { ProfileForm } from "./profile-form"
import { PasswordForm } from "./password-form"

export default async function AccountSettingsPage() {
  const profile = await getProfile()

  if (!profile) redirect("/login")

  const initials = (profile.full_name || profile.email)
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile and preferences.
        </p>
      </div>

      {/* Avatar */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Photo</h2>
        <AvatarUpload
          userId={profile.id}
          currentUrl={profile.avatar_url}
          initials={initials}
        />
      </section>

      <Separator />

      {/* Profile Info */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Profile</h2>
          <Badge variant="secondary" className="text-[10px]">
            {profile.role === "super_admin" ? "Super Admin" : "Admin"}
          </Badge>
        </div>
        <ProfileForm fullName={profile.full_name} email={profile.email} />
      </section>

      <Separator />

      {/* Password */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Password</h2>
        <p className="text-xs text-muted-foreground">
          Change the password you use to sign in.
        </p>
        <PasswordForm />
      </section>

      <Separator />

      {/* Preferences (future) */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Preferences</h2>
        <p className="text-xs text-muted-foreground">
          Notification settings and display preferences coming soon.
        </p>
      </section>

      {/* Session info */}
      <section className="space-y-1 pb-8">
        <p className="text-xs text-muted-foreground">
          Signed in as {profile.email}
        </p>
        <p className="text-xs text-muted-foreground">
          Account created{" "}
          {new Date(profile.created_at).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </section>
    </div>
  )
}
