import { redirect } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"
import { BoardsTagsAdmin } from "./boards-tags-admin"

export default async function BoardsTagsPage() {
  const profile = await getProfile()
  if (!profile || profile.role !== "super_admin") redirect("/settings/account")

  const supabase = await createClient()

  const { data: boards } = await supabase
    .from("boards")
    .select("*")
    .order("sort_order")

  const { data: tags } = await supabase
    .from("tags")
    .select("*")
    .order("name")

  return (
    <BoardsTagsAdmin boards={boards ?? []} tags={tags ?? []} />
  )
}
