"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export async function createTask(formData: FormData) {
  const title = formData.get("title") as string
  const description = formData.get("description") as string
  const clientId = formData.get("client_id") as string
  const owner = formData.get("owner") as string
  const tags = JSON.parse(
    (formData.get("tags") as string) || "[]"
  ) as string[]
  const status = (formData.get("status") as string) || "todo"
  const listingIds = JSON.parse(
    (formData.get("listing_ids") as string) || "[]"
  ) as string[]

  if (!title) return { error: "Title is required" }

  const supabase = await createClient()

  // Get max sort_order for the column
  const { data: maxOrder } = await supabase
    .from("tasks")
    .select("sort_order")
    .eq("status", status)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single()

  const sortOrder = (maxOrder?.sort_order ?? -1) + 1

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      title,
      description: description || null,
      client_id: clientId || null,
      owner: owner || null,
      tags,
      status,
      sort_order: sortOrder,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  // Insert task_listings
  if (listingIds.length > 0 && task) {
    await supabase.from("task_listings").insert(
      listingIds.map((lid) => ({ task_id: task.id, listing_id: lid }))
    )
  }

  revalidatePath("/tasks")
  return { success: true }
}

export async function updateTaskStatus(
  taskId: string,
  newStatus: string,
  newSortOrder: number
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("tasks")
    .update({ status: newStatus, sort_order: newSortOrder, updated_at: new Date().toISOString() })
    .eq("id", taskId)

  if (error) return { error: error.message }

  revalidatePath("/tasks")
  return { success: true }
}

export async function updateTask(taskId: string, formData: FormData) {
  const title = formData.get("title") as string
  const description = formData.get("description") as string
  const clientId = formData.get("client_id") as string
  const owner = formData.get("owner") as string
  const tags = JSON.parse(
    (formData.get("tags") as string) || "[]"
  ) as string[]
  const status = formData.get("status") as string
  const listingIds = JSON.parse(
    (formData.get("listing_ids") as string) || "[]"
  ) as string[]

  if (!title) return { error: "Title is required" }

  const supabase = await createClient()

  const { error } = await supabase
    .from("tasks")
    .update({
      title,
      description: description || null,
      client_id: clientId || null,
      owner: owner || null,
      tags,
      status: status || "todo",
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)

  if (error) return { error: error.message }

  // Replace task_listings
  await supabase.from("task_listings").delete().eq("task_id", taskId)
  if (listingIds.length > 0) {
    await supabase.from("task_listings").insert(
      listingIds.map((lid) => ({ task_id: taskId, listing_id: lid }))
    )
  }

  revalidatePath("/tasks")
  return { success: true }
}

export async function archiveTask(taskId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("tasks")
    .update({ is_archived: true, archived_at: new Date().toISOString() })
    .eq("id", taskId)
  if (error) return { error: error.message }
  revalidatePath("/tasks")
  return { success: true }
}

export async function unarchiveTask(taskId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("tasks")
    .update({ is_archived: false, archived_at: null })
    .eq("id", taskId)
  if (error) return { error: error.message }
  revalidatePath("/tasks")
  return { success: true }
}

export async function listTaskComments(taskId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("task_comments")
    .select("*, profiles(full_name, email, avatar_url)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })

  if (error) return { error: error.message, comments: [] }
  return { comments: data ?? [] }
}

export async function createTaskComment(taskId: string, content: string) {
  const trimmed = content.trim()
  if (!trimmed) return { error: "Comment is empty" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { error } = await supabase.from("task_comments").insert({
    task_id: taskId,
    author_id: user.id,
    content: trimmed,
  })

  if (error) return { error: error.message }
  revalidatePath("/tasks")
  return { success: true }
}

export async function deleteTaskComment(commentId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("task_comments").delete().eq("id", commentId)
  if (error) return { error: error.message }
  revalidatePath("/tasks")
  return { success: true }
}

export async function deleteTask(taskId: string) {
  const supabase = await createClient()

  const { error } = await supabase.from("tasks").delete().eq("id", taskId)

  if (error) return { error: error.message }

  revalidatePath("/tasks")
  return { success: true }
}
