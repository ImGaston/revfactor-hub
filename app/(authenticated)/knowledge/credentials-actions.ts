"use server"

import { revalidatePath } from "next/cache"
import { hasPermission } from "@/lib/permissions.server"
import { createClient } from "@/lib/supabase/server"

export type TeamCredentialInput = {
  name: string
  software: string
  email: string | null
  password: string | null
  notes: string | null
}

export async function createTeamCredential(input: TeamCredentialInput) {
  if (!(await hasPermission("team_credentials", "create"))) {
    return { error: "You don't have permission to add credentials" }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { error } = await supabase.from("team_credentials").insert({
    ...input,
    created_by: user.id,
  })

  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}

export async function updateTeamCredential(
  id: string,
  input: TeamCredentialInput
) {
  if (!(await hasPermission("team_credentials", "edit"))) {
    return { error: "You don't have permission to edit credentials" }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("team_credentials")
    .update(input)
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}

export async function deleteTeamCredential(id: string) {
  if (!(await hasPermission("team_credentials", "delete"))) {
    return { error: "You don't have permission to delete credentials" }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("team_credentials")
    .delete()
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}
