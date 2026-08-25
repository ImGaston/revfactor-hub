"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import { hasPermission } from "@/lib/permissions.server"
import {
  isAssemblyConfigured,
  searchAssemblyClientByEmail,
  assemblyClientMessagesUrl,
  assemblyCompanyMessagesUrl,
} from "@/lib/assembly"

type ClientInput = {
  name: string
  email: string | null
  status: string
  assembly_link: string | null
  onboarding_date: string | null
  ending_date: string | null
  billing_amount: number | null
  autopayment_set_up: boolean
  stripe_dashboard: string | null
  ending_reason_tags?: string[]
  ending_note?: string | null
}

type AssemblyOnboardingImportInput = {
  email: string
  primaryListings: number
  childListings: number
}

function validListingCount(value: number, minimum: number) {
  return Number.isInteger(value) && value >= minimum && value <= 5
}

export async function importAssemblyClientForOnboardingAction(
  input: AssemblyOnboardingImportInput
) {
  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes("@")) {
    return { error: "Enter a valid Assembly client email" }
  }
  if (!validListingCount(input.primaryListings, 1)) {
    return { error: "Primary listings must be between 1 and 5" }
  }
  if (!validListingCount(input.childListings, 0)) {
    return { error: "Child listings must be between 0 and 5" }
  }
  if (!isAssemblyConfigured()) {
    return { error: "Assembly API key is not configured" }
  }

  const [canCreateClient, canCreateOnboarding] = await Promise.all([
    hasPermission("clients", "create"),
    hasPermission("onboarding", "create"),
  ])
  if (!canCreateClient || !canCreateOnboarding) {
    return { error: "You do not have permission to import onboarding clients" }
  }

  const assemblyClient = await searchAssemblyClientByEmail(email)
  if (!assemblyClient) {
    return { error: `No Assembly client found with email ${email}` }
  }

  const assemblyCompanyId = assemblyClient.companyIds?.[0] ?? null
  const assemblyLink = assemblyCompanyId
    ? assemblyCompanyMessagesUrl(assemblyCompanyId)
    : assemblyClientMessagesUrl(assemblyClient.id)
  const displayName =
    [assemblyClient.givenName, assemblyClient.familyName]
      .filter(Boolean)
      .join(" ") || email
  const supabase = await createClient()

  const clientFields =
    "id, name, email, status, assembly_client_id, assembly_company_id"
  let existingClient = null

  const { data: clientByAssembly, error: assemblyLookupError } = await supabase
    .from("clients")
    .select(clientFields)
    .eq("assembly_client_id", assemblyClient.id)
    .maybeSingle()
  if (assemblyLookupError) return { error: assemblyLookupError.message }
  existingClient = clientByAssembly

  if (!existingClient && assemblyCompanyId) {
    const { data, error } = await supabase
      .from("clients")
      .select(clientFields)
      .eq("assembly_company_id", assemblyCompanyId)
      .maybeSingle()
    if (error) return { error: error.message }
    existingClient = data
  }

  if (!existingClient) {
    const { data, error } = await supabase
      .from("clients")
      .select(clientFields)
      .eq("email", email)
      .maybeSingle()
    if (error) return { error: error.message }
    existingClient = data
  }

  let client = existingClient
  let createdClient = false
  if (client) {
    const { data, error } = await supabase
      .from("clients")
      .update({
        email,
        assembly_client_id: assemblyClient.id,
        assembly_company_id: assemblyCompanyId,
        assembly_link: assemblyLink,
        status: client.status === "active" ? "active" : "onboarding",
      })
      .eq("id", client.id)
      .select(clientFields)
      .single()
    if (error) return { error: error.message }
    client = data
  } else {
    const { data, error } = await supabase
      .from("clients")
      .insert({
        name: displayName,
        email,
        status: "onboarding",
        onboarding_date: new Date().toISOString().slice(0, 10),
        assembly_client_id: assemblyClient.id,
        assembly_company_id: assemblyCompanyId,
        assembly_link: assemblyLink,
      })
      .select(clientFields)
      .single()
    if (error) return { error: error.message }
    client = data
    createdClient = true
  }

  const { data: existingRun, error: runLookupError } = await supabase
    .from("onboarding_runs")
    .select("id, external_key, status")
    .eq("client_id", client.id)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (runLookupError) return { error: runLookupError.message }

  let run = existingRun
  let createdRun = false
  if (!run) {
    const { data, error } = await supabase
      .from("onboarding_runs")
      .insert({
        client_id: client.id,
        external_key: `assembly-manual:${assemblyClient.id}`,
        run_type: "initial",
        assembly_company_id: assemblyCompanyId,
        assembly_client_id: assemblyClient.id,
        primary_listing_entitlement: input.primaryListings,
        child_listing_entitlement: input.childListings,
      })
      .select("id, external_key, status")
      .single()
    if (error) return { error: error.message }
    run = data
    createdRun = true
  }

  revalidatePath("/settings/clients")
  revalidatePath("/clients")
  revalidatePath("/onboarding")

  return {
    error: null,
    clientId: client.id,
    clientName: client.name,
    runId: run.id,
    createdClient,
    createdRun,
  }
}

export async function createClientAction(input: ClientInput) {
  const supabase = await createClient()
  const { error } = await supabase.from("clients").insert(input)
  if (error) return { error: error.message }
  revalidatePath("/settings/clients")
  revalidatePath("/clients")
  return { error: null }
}

export async function updateClientAction(id: string, input: ClientInput) {
  const supabase = await createClient()

  // Churn fields are super_admin-only: never trust them from other roles.
  const profile = await getProfile()
  if (profile?.role !== "super_admin") {
    delete input.ending_reason_tags
    delete input.ending_note
  }

  if (input.status === "inactive") {
    if (!input.ending_date) {
      input.ending_date = new Date().toISOString().split("T")[0]
    }
  } else {
    const { data: current } = await supabase
      .from("clients")
      .select("status")
      .eq("id", id)
      .single()
    // Reactivated clients are no longer churned — clear churn data for any role.
    // Only on the inactive → active/onboarding transition: ending_date doubles as
    // the planned contract end for active clients and must survive normal edits.
    if (current?.status === "inactive") {
      input.ending_date = null
      input.ending_reason_tags = []
      input.ending_note = null
    }
  }

  const { error } = await supabase.from("clients").update(input).eq("id", id)
  if (error) return { error: error.message }

  if (input.status === "inactive") {
    const { error: listingsError } = await supabase
      .from("listings")
      .update({ status: "inactive" })
      .eq("client_id", id)
    if (listingsError) return { error: listingsError.message }
  }

  revalidatePath("/settings/clients")
  revalidatePath("/clients")
  revalidatePath("/listings")
  revalidatePath("/settings/listings")
  return { error: null }
}

export async function updateClientEmailAction(id: string, email: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("clients").update({ email }).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/settings/clients")
  revalidatePath("/clients")
  return { error: null }
}

export async function deleteClientAction(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("clients").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/settings/clients")
  revalidatePath("/clients")
  return { error: null }
}

export async function linkAssemblyClientAction(clientId: string) {
  if (!isAssemblyConfigured()) {
    return { error: "Assembly API key is not configured" }
  }

  const supabase = await createClient()
  const { data: client, error: fetchError } = await supabase
    .from("clients")
    .select("email")
    .eq("id", clientId)
    .single()

  if (fetchError || !client) return { error: "Client not found" }
  if (!client.email) return { error: "Client has no email — cannot match to Assembly" }

  const assemblyClient = await searchAssemblyClientByEmail(client.email)
  if (!assemblyClient) {
    return { error: `No Assembly client found with email ${client.email}` }
  }

  // Get the first company ID if the client belongs to one
  const assemblyCompanyId = assemblyClient.companyIds?.[0] ?? null

  // Build the assembly_link: company chat if available, otherwise individual
  const assemblyLink = assemblyCompanyId
    ? assemblyCompanyMessagesUrl(assemblyCompanyId)
    : assemblyClientMessagesUrl(assemblyClient.id)

  const { error: updateError } = await supabase
    .from("clients")
    .update({
      assembly_client_id: assemblyClient.id,
      assembly_company_id: assemblyCompanyId,
      assembly_link: assemblyLink,
    })
    .eq("id", clientId)

  if (updateError) return { error: updateError.message }

  revalidatePath("/settings/clients")
  revalidatePath("/clients")
  return { error: null, assemblyClientId: assemblyClient.id }
}

export async function unlinkAssemblyClientAction(clientId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("clients")
    .update({
      assembly_client_id: null,
      assembly_company_id: null,
      assembly_link: null,
    })
    .eq("id", clientId)

  if (error) return { error: error.message }

  revalidatePath("/settings/clients")
  revalidatePath("/clients")
  return { error: null }
}
