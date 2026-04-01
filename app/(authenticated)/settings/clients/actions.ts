"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

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
