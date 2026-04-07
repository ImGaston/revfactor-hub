import { createClient } from "@/lib/supabase/server"

export type Profile = {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
  created_at: string
  updated_at: string
}

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()

  return data
}
