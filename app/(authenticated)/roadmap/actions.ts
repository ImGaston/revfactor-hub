"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export async function createRoadmapItem(formData: FormData) {
  const title = formData.get("title") as string
  const description = formData.get("description") as string
  const owner = formData.get("owner") as string
  const tag = formData.get("tag") as string
  const status = (formData.get("status") as string) || "proposed"

  if (!title) return { error: "Title is required" }

  const supabase = await createClient()

  const { data: maxOrder } = await supabase
    .from("roadmap_items")
    .select("sort_order")
    .eq("status", status)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single()

  const sortOrder = (maxOrder?.sort_order ?? -1) + 1

  const { error } = await supabase.from("roadmap_items").insert({
    title,
    description: description || null,
    owner: owner || null,
    tag: tag || null,
    status,
    sort_order: sortOrder,
  })

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  return { success: true }
}

export async function updateRoadmapItemStatus(
  itemId: string,
  newStatus: string,
  newSortOrder: number
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("roadmap_items")
    .update({ status: newStatus, sort_order: newSortOrder, updated_at: new Date().toISOString() })
    .eq("id", itemId)

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  return { success: true }
}
