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
  onboarding_date: string | null
  commentCount: number
}

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fetch onboarding clients
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, email, status, onboarding_date")
    .eq("status", "onboarding")
    .order("name")

  const rawClients = (clients ?? []) as Omit<ClientRow, "commentCount">[]

  // Fetch comment counts per client
  const clientIdsForComments = rawClients.map((c) => c.id)
  const commentCounts = new Map<string, number>()
  if (clientIdsForComments.length > 0) {
    const { data: commentRows } = await supabase
      .from("onboarding_comments")
      .select("client_id")
      .in("client_id", clientIdsForComments)
    for (const row of (commentRows ?? []) as { client_id: string }[]) {
      commentCounts.set(row.client_id, (commentCounts.get(row.client_id) ?? 0) + 1)
    }
  }

  const onboardingClients: ClientRow[] = rawClients.map((c) => ({
    ...c,
    commentCount: commentCounts.get(c.id) ?? 0,
  }))

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
      currentUserId={user?.id ?? null}
    />
  )
}
