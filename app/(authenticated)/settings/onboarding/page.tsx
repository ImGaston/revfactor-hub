import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"
import { OnboardingSettings } from "./onboarding-settings"

export default async function OnboardingSettingsPage() {
  const [profile, canEdit] = await Promise.all([
    getProfile(),
    hasPermission("onboarding", "edit"),
  ])
  if (!profile || !canEdit) redirect("/settings/account")

  const supabase = await createClient()

  const { data: templates } = await supabase
    .from("onboarding_templates")
    .select("*")
    .order("step_order")

  const { data: resources } = await supabase
    .from("onboarding_resources")
    .select("*")
    .order("sort_order")

  return (
    <OnboardingSettings
      templates={templates ?? []}
      resources={resources ?? []}
    />
  )
}
