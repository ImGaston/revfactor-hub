"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

type CredentialInput = {
  name: string
  software: string
  email: string | null
  password: string | null
  notes: string | null
}

export async function createCredential(clientId: string, input: CredentialInput) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("client_credentials")
    .insert({ ...input, client_id: clientId })

  if (error) return { error: error.message }
  revalidatePath(`/clients/${clientId}`)
  return { error: null }
}

export async function updateCredential(id: string, clientId: string, input: CredentialInput) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("client_credentials")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath(`/clients/${clientId}`)
  return { error: null }
}

export async function deleteCredential(id: string, clientId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("client_credentials")
    .delete()
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath(`/clients/${clientId}`)
  return { error: null }
}
