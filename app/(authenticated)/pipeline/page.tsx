import { createClient } from "@/lib/supabase/server"
import { PipelineTabs } from "./pipeline-tabs"
import type { Lead, LeadTag } from "@/lib/types"

export default async function PipelinePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fetch leads with joined tags and team assignments
  const { data: leadsRaw } = await supabase
    .from("leads")
    .select(
      "*, lead_tag_assignments(lead_tags(*)), lead_team_assignments(profile_id, role, profiles(full_name, email, avatar_url))"
    )
    .order("sort_order")

  // Fetch all available lead tags
  const { data: tags } = await supabase
    .from("lead_tags")
    .select("*")
    .order("name")

  // Fetch all profiles (for team assignment dropdowns)
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .order("full_name")

  const leads: Lead[] = (leadsRaw ?? []) as Lead[]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Track leads through your sales funnel from inquiry to close.
        </p>
      </div>
      <PipelineTabs
        leads={leads}
        tags={(tags ?? []) as LeadTag[]}
        profiles={
          (profiles ?? []) as {
            id: string
            full_name: string | null
            email: string
            avatar_url: string | null
          }[]
        }
      />
    </div>
  )
}
