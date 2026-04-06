"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

// ─── Leads ──────────────��───────────────────────────────

export async function createLead(formData: FormData) {
  const project_name = formData.get("project_name") as string
  const full_name = formData.get("full_name") as string
  const email = formData.get("email") as string
  const phone = formData.get("phone") as string
  const service_type = formData.get("service_type") as string
  const lead_source = formData.get("lead_source") as string
  const description = formData.get("description") as string
  const scheduled_date = formData.get("scheduled_date") as string
  const timezone = formData.get("timezone") as string
  const location = formData.get("location") as string
  const stage = (formData.get("stage") as string) || "inquiry"
  const tagIds = formData.getAll("tag_ids") as string[]
  const teamIds = formData.getAll("team_ids") as string[]

  if (!project_name) return { error: "Project name is required" }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: maxOrder } = await supabase
    .from("leads")
    .select("sort_order")
    .eq("stage", stage)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single()

  const sortOrder = (maxOrder?.sort_order ?? -1) + 1

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      project_name,
      full_name: full_name || null,
      email: email || null,
      phone: phone || null,
      service_type: service_type || null,
      lead_source: lead_source || null,
      description: description || null,
      scheduled_date: scheduled_date || null,
      timezone: timezone || null,
      location: location || null,
      stage,
      sort_order: sortOrder,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  if (tagIds.length > 0 && lead) {
    const rows = tagIds.map((tag_id) => ({ lead_id: lead.id, tag_id }))
    await supabase.from("lead_tag_assignments").insert(rows)
  }

  if (teamIds.length > 0 && lead) {
    const rows = teamIds.map((profile_id) => ({ lead_id: lead.id, profile_id }))
    await supabase.from("lead_team_assignments").insert(rows)
  }

  revalidatePath("/pipeline")
  return { success: true }
}

export async function updateLead(
  leadId: string,
  data: {
    project_name?: string
    full_name?: string | null
    email?: string | null
    phone?: string | null
    service_type?: string | null
    lead_source?: string | null
    description?: string | null
    scheduled_date?: string | null
    timezone?: string | null
    location?: string | null
    start_date?: string | null
    end_date?: string | null
    contract_sent?: boolean
    contract_signed?: boolean
    client_portal_url?: string | null
    stage?: string
  }
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("leads")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", leadId)

  if (error) return { error: error.message }

  revalidatePath("/pipeline")
  revalidatePath(`/pipeline/${leadId}`)
  return { success: true }
}

export async function updateLeadStage(
  leadId: string,
  newStage: string,
  newSortOrder: number
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("leads")
    .update({
      stage: newStage,
      sort_order: newSortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)

  if (error) return { error: error.message }

  revalidatePath("/pipeline")
  return { success: true }
}

export async function updateLeadTags(leadId: string, tagIds: string[]) {
  const supabase = await createClient()

  await supabase.from("lead_tag_assignments").delete().eq("lead_id", leadId)

  if (tagIds.length > 0) {
    const rows = tagIds.map((tag_id) => ({ lead_id: leadId, tag_id }))
    await supabase.from("lead_tag_assignments").insert(rows)
  }

  revalidatePath("/pipeline")
  revalidatePath(`/pipeline/${leadId}`)
  return { success: true }
}

export async function updateLeadTeam(leadId: string, profileIds: string[]) {
  const supabase = await createClient()

  await supabase.from("lead_team_assignments").delete().eq("lead_id", leadId)

  if (profileIds.length > 0) {
    const rows = profileIds.map((profile_id) => ({ lead_id: leadId, profile_id }))
    await supabase.from("lead_team_assignments").insert(rows)
  }

  revalidatePath("/pipeline")
  revalidatePath(`/pipeline/${leadId}`)
  return { success: true }
}

// ─── Bulk Import ────────────────────────────────────────

export type ImportLeadRow = {
  project_name: string
  full_name?: string
  email?: string
  phone?: string
  service_type?: string
  lead_source?: string
  description?: string
  scheduled_date?: string
  timezone?: string
  location?: string
  stage?: string
}

export async function importLeads(rows: ImportLeadRow[]) {
  if (rows.length === 0) return { error: "No rows to import" }

  const validStages = [
    "inquiry", "follow_up", "audit", "meeting",
    "proposal_sent", "proposal_signed", "retainer_paid",
    "planning", "completed", "archived",
  ]

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const leadsToInsert = rows.map((row, idx) => ({
    project_name: row.project_name,
    full_name: row.full_name || null,
    email: row.email || null,
    phone: row.phone || null,
    service_type: row.service_type || null,
    lead_source: row.lead_source || null,
    description: row.description || null,
    scheduled_date: row.scheduled_date || null,
    timezone: row.timezone || null,
    location: row.location || null,
    stage: validStages.includes(row.stage ?? "") ? row.stage! : "inquiry",
    sort_order: idx,
    created_by: user?.id ?? null,
  }))

  const { error } = await supabase.from("leads").insert(leadsToInsert)

  if (error) return { error: error.message }

  revalidatePath("/pipeline")
  return { success: true, count: leadsToInsert.length }
}

export async function deleteLead(leadId: string) {
  const supabase = await createClient()

  const { error } = await supabase.from("leads").delete().eq("id", leadId)

  if (error) return { error: error.message }

  revalidatePath("/pipeline")
  return { success: true }
}

// ─── Bulk Actions ───────────────────────────────────────

export async function bulkDeleteLeads(leadIds: string[]) {
  if (leadIds.length === 0) return { error: "No leads selected" }

  const supabase = await createClient()

  const { error } = await supabase
    .from("leads")
    .delete()
    .in("id", leadIds)

  if (error) return { error: error.message }

  revalidatePath("/pipeline")
  return { success: true, count: leadIds.length }
}

export async function bulkUpdateLeads(
  leadIds: string[],
  data: {
    stage?: string
    service_type?: string | null
    lead_source?: string | null
    contract_sent?: boolean
    contract_signed?: boolean
  }
) {
  if (leadIds.length === 0) return { error: "No leads selected" }

  const supabase = await createClient()

  const { error } = await supabase
    .from("leads")
    .update({ ...data, updated_at: new Date().toISOString() })
    .in("id", leadIds)

  if (error) return { error: error.message }

  revalidatePath("/pipeline")
  return { success: true, count: leadIds.length }
}

export async function bulkAssignTeam(leadIds: string[], profileIds: string[]) {
  if (leadIds.length === 0) return { error: "No leads selected" }

  const supabase = await createClient()

  // For each lead, delete existing assignments and insert new ones
  for (const leadId of leadIds) {
    await supabase.from("lead_team_assignments").delete().eq("lead_id", leadId)

    if (profileIds.length > 0) {
      const rows = profileIds.map((profile_id) => ({ lead_id: leadId, profile_id }))
      await supabase.from("lead_team_assignments").insert(rows)
    }
  }

  revalidatePath("/pipeline")
  return { success: true, count: leadIds.length }
}
