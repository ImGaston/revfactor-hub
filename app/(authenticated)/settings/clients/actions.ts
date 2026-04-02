"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
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
  const { error } = await supabase.from("clients").update(input).eq("id", id)
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
