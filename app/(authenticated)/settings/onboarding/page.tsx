import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"
import { OnboardingSettings } from "./onboarding-settings"

export default async function OnboardingSettingsPage() {
  const profile = await getProfile()
  if (!profile || profile.role !== "super_admin") redirect("/settings/account")

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
