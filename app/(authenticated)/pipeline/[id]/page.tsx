import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { LeadDetail } from "./lead-detail"
import type { Lead, LeadTag } from "@/lib/types"

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: lead } = await supabase
    .from("leads")
    .select(
      "*, lead_tag_assignments(lead_tags(*)), lead_team_assignments(profile_id, role, profiles(full_name, email, avatar_url))"
    )
    .eq("id", id)
    .single()

  if (!lead) notFound()

  const { data: tags } = await supabase
    .from("lead_tags")
    .select("*")
    .order("name")

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .order("full_name")

  return (
    <LeadDetail
      lead={lead as Lead}
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
  )
}
