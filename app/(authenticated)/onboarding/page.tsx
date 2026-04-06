import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { OnboardingView } from "./onboarding-view"
import type {
  OnboardingTemplate,
  OnboardingProgress,
  OnboardingResource,
} from "@/lib/types"

type ClientRow = {
  id: string
  name: string
  email: string | null
  status: string
}

export default async function OnboardingPage() {
  const supabase = await createClient()

  // Fetch onboarding clients
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, email, status")
    .eq("status", "onboarding")
    .order("name")

  const onboardingClients = (clients ?? []) as ClientRow[]

  // Fetch active templates
  const { data: templates } = await supabase
    .from("onboarding_templates")
    .select("*")
    .eq("is_active", true)
    .order("step_order")

  const activeTemplates = (templates ?? []) as OnboardingTemplate[]

  // Fetch all progress rows for onboarding clients
  const clientIds = onboardingClients.map((c) => c.id)
  let progressRows: OnboardingProgress[] = []

  if (clientIds.length > 0) {
    const { data: progress } = await supabase
      .from("onboarding_progress")
      .select("*, onboarding_templates(*), profiles(full_name, email)")
      .in("client_id", clientIds)

    progressRows = (progress ?? []) as OnboardingProgress[]
  }

  // Auto-initialize missing progress rows via admin client (bypasses RLS)
  if (clientIds.length > 0 && activeTemplates.length > 0) {
    const existingKeys = new Set(
      progressRows.map((p) => `${p.client_id}::${p.template_id}`)
    )

    const missing: { client_id: string; template_id: string }[] = []
    for (const client of onboardingClients) {
      for (const tmpl of activeTemplates) {
        if (!existingKeys.has(`${client.id}::${tmpl.id}`)) {
          missing.push({ client_id: client.id, template_id: tmpl.id })
        }
      }
    }

    if (missing.length > 0) {
      const admin = createAdminClient()
      await admin.from("onboarding_progress").insert(missing)

      // Re-fetch progress after insert
      const { data: refreshed } = await supabase
        .from("onboarding_progress")
        .select("*, onboarding_templates(*), profiles(full_name, email)")
        .in("client_id", clientIds)

      progressRows = (refreshed ?? []) as OnboardingProgress[]
    }
  }

  // Fetch resources
  const { data: resources } = await supabase
    .from("onboarding_resources")
    .select("*")
    .order("sort_order")

  return (
    <OnboardingView
      clients={onboardingClients}
      templates={activeTemplates}
      progress={progressRows}
      resources={(resources ?? []) as OnboardingResource[]}
    />
  )
}
