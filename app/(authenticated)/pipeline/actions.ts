"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import {
  isAssemblyConfigured,
  findOrCreateAssemblyClient,
  getOrCreateMessageChannel,
  sendAssemblyMessage,
  assemblyClientMessagesUrl,
  createAssemblyContract,
} from "@/lib/assembly"

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
  const listing_count = parseInt(formData.get("listing_count") as string) || 0
  const child_listing_count = parseInt(formData.get("child_listing_count") as string) || 0
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
      listing_count,
      child_listing_count,
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
    listing_count?: number
    child_listing_count?: number
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
    "planning",
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

// ─── Archive / Complete ─────────────────────────────────

export async function archiveLead(leadId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("leads")
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      is_completed: false,
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)

  if (error) return { error: error.message }
  revalidatePath("/pipeline")
  revalidatePath(`/pipeline/${leadId}`)
  return { success: true }
}

export async function unarchiveLead(leadId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("leads")
    .update({
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)

  if (error) return { error: error.message }
  revalidatePath("/pipeline")
  revalidatePath(`/pipeline/${leadId}`)
  return { success: true }
}

export async function completeLead(leadId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("leads")
    .update({
      is_completed: true,
      completed_at: new Date().toISOString(),
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)

  if (error) return { error: error.message }
  revalidatePath("/pipeline")
  revalidatePath(`/pipeline/${leadId}`)
  return { success: true }
}

export async function uncompleteLead(leadId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("leads")
    .update({
      is_completed: false,
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)

  if (error) return { error: error.message }
  revalidatePath("/pipeline")
  revalidatePath(`/pipeline/${leadId}`)
  return { success: true }
}

export async function bulkArchiveLeads(leadIds: string[]) {
  if (leadIds.length === 0) return { error: "No leads selected" }
  const supabase = await createClient()
  const { error } = await supabase
    .from("leads")
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      is_completed: false,
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .in("id", leadIds)

  if (error) return { error: error.message }
  revalidatePath("/pipeline")
  return { success: true, count: leadIds.length }
}

export async function bulkCompleteLeads(leadIds: string[]) {
  if (leadIds.length === 0) return { error: "No leads selected" }
  const supabase = await createClient()
  const { error } = await supabase
    .from("leads")
    .update({
      is_completed: true,
      completed_at: new Date().toISOString(),
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .in("id", leadIds)

  if (error) return { error: error.message }
  revalidatePath("/pipeline")
  return { success: true, count: leadIds.length }
}

// ─── Lead Notes ────────────────────────────────────────

export async function createLeadNote(leadId: string, content: string) {
  if (!content.trim()) return { error: "Note content is required" }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data, error } = await supabase
    .from("lead_notes")
    .insert({ lead_id: leadId, author_id: user.id, content: content.trim() })
    .select("*, profiles(full_name, email, avatar_url)")
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/pipeline/${leadId}`)
  return { success: true, note: data }
}

export async function updateLeadNote(noteId: string, content: string) {
  if (!content.trim()) return { error: "Note content is required" }

  const supabase = await createClient()

  const { error } = await supabase
    .from("lead_notes")
    .update({ content: content.trim(), updated_at: new Date().toISOString() })
    .eq("id", noteId)

  if (error) return { error: error.message }

  revalidatePath("/pipeline")
  return { success: true }
}

export async function deleteLeadNote(noteId: string, leadId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("lead_notes")
    .delete()
    .eq("id", noteId)

  if (error) return { error: error.message }

  revalidatePath(`/pipeline/${leadId}`)
  return { success: true }
}

// ─── Assembly: Create Client ────────────────────────────

export async function createAssemblyClientForLead(leadId: string) {
  if (!isAssemblyConfigured()) {
    return { error: "Assembly is not configured" }
  }

  const supabase = await createClient()

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single()

  if (leadError || !lead) return { error: "Lead not found" }
  if (!lead.email) return { error: "Lead has no email address" }
  if (!lead.full_name) return { error: "Lead has no name" }

  const nameParts = lead.full_name.trim().split(/\s+/)
  const givenName = nameParts[0]
  const familyName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : givenName

  try {
    console.log(`[Assembly] Creating client for ${lead.email}`)
    const assemblyClient = await findOrCreateAssemblyClient({
      givenName,
      familyName,
      email: lead.email,
      phone: lead.phone ?? undefined,
      sendInvite: true,
    })
    console.log(`[Assembly] Client created: ${assemblyClient.id} (status: ${assemblyClient.status})`)

    // Save assembly_client_id on the lead
    await supabase
      .from("leads")
      .update({
        assembly_client_id: assemblyClient.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)

    // Create client in Hub database (uses admin client to bypass RLS)
    const assemblyLink = assemblyClientMessagesUrl(assemblyClient.id)
    const admin = createAdminClient()
    const { error: clientError } = await admin
      .from("clients")
      .insert({
        name: lead.full_name,
        email: lead.email,
        status: "onboarding",
        assembly_link: assemblyLink,
        assembly_client_id: assemblyClient.id,
      })

    if (clientError) {
      console.warn(`[Assembly] Hub client insert warning: ${clientError.message}`)
    } else {
      console.log(`[Assembly] Hub client created for ${lead.full_name}`)
    }

    revalidatePath("/pipeline")
    revalidatePath(`/pipeline/${leadId}`)
    revalidatePath("/clients")

    return {
      success: true,
      assemblyClientId: assemblyClient.id,
      inviteUrl: assemblyClient.inviteUrl,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error(`[Assembly] Create client FAILED:`, message)
    return { error: message }
  }
}

// ─── Assembly: Send Contract ────────────────────────────

export async function sendContractToAssembly(leadId: string, contractTemplateId: string) {
  if (!isAssemblyConfigured()) {
    return { error: "Assembly is not configured" }
  }

  if (!contractTemplateId) return { error: "No contract template selected" }

  const supabase = await createClient()

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single()

  if (leadError || !lead) return { error: "Lead not found" }
  if (!lead.assembly_client_id) return { error: "Lead has no Assembly client. Create the client first." }

  const clientId = lead.assembly_client_id

  try {
    // 1. Create the contract (Assembly sends it to the client automatically)
    console.log(`[SendContract] Creating contract with template ${contractTemplateId} for client ${clientId}`)
    const contract = await createAssemblyContract({
      contractTemplateId,
      clientId,
    })
    console.log(`[SendContract] Contract created: ${contract.id} (status: ${contract.status})`)

    // 2. Send welcome message via chat
    console.log(`[SendContract] Sending welcome message`)
    const messageChannel = await getOrCreateMessageChannel(clientId)
    const clientName = lead.full_name ?? "there"
    await sendAssemblyMessage(
      messageChannel.id,
      `Hello ${clientName},\n\nWelcome to your RevFactor Client Portal.\n\nOn the left side, you'll find the Contracts section, where your agreement will be available for review and signature.\n\nWe're here if you need anything, just send a message in this chat.`
    )

    // 3. Mark contract_sent on lead
    await supabase
      .from("leads")
      .update({
        contract_sent: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)

    revalidatePath("/pipeline")
    revalidatePath(`/pipeline/${leadId}`)

    console.log(`[SendContract] Done! Contract ${contract.id} sent.`)
    return {
      success: true,
      contractId: contract.id,
      contractName: contract.name,
      contractStatus: contract.status,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error(`[SendContract] FAILED:`, message)
    return { error: message }
  }
}
