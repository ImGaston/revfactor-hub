"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hasPermission } from "@/lib/permissions.server"
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
  // profiles needs the FK hint: the reactions junction adds a second
  // comment→profiles path and PostgREST would 300 on the bare embed
  const { data, error } = await supabase
    .from("task_comments")
    .select(
      "*, profiles!task_comments_author_id_fkey(full_name, email, avatar_url), task_comment_reactions(emoji, user_id)"
    )
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })

  if (error) return { error: error.message, comments: [] }
  return { comments: data ?? [] }
}

export async function createTaskComment(
  taskId: string,
  content: string,
  parentId?: string | null
) {
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
    parent_id: parentId ?? null,
  })

  if (error) return { error: error.message }
  revalidatePath("/tasks")
  return { success: true }
}

export async function toggleTaskCommentReaction(commentId: string, emoji: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: removed, error: deleteError } = await supabase
    .from("task_comment_reactions")
    .delete()
    .eq("comment_id", commentId)
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .select("emoji")

  if (deleteError) return { error: deleteError.message }

  if (!removed || removed.length === 0) {
    const { error } = await supabase.from("task_comment_reactions").insert({
      comment_id: commentId,
      user_id: user.id,
      emoji,
    })
    if (error) return { error: error.message }
  }

  revalidatePath("/tasks")
  return { success: true }
}

// "Create task" on a task comment: spins the comment off into its own task
// and links it back via linked_task_id.
export async function createTaskFromTaskComment(commentId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("tasks", "create")))
    return { error: "You don't have permission to create tasks" }

  // tasks needs the FK hint: task_comments now has two FKs to tasks
  // (task_id and linked_task_id)
  const { data: comment, error: fetchError } = await supabase
    .from("task_comments")
    .select("id, content, linked_task_id, tasks!task_comments_task_id_fkey(id, title, client_id)")
    .eq("id", commentId)
    .single()

  if (fetchError || !comment) return { error: fetchError?.message ?? "Comment not found" }
  if (comment.linked_task_id) return { error: "This comment already has a task" }

  const sourceTask = Array.isArray(comment.tasks) ? comment.tasks[0] : comment.tasks
  const title =
    comment.content.length > 80 ? `${comment.content.slice(0, 80)}…` : comment.content

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      title,
      description: `${comment.content}\n\nFrom a comment on task: ${sourceTask?.title ?? "unknown"}`,
      client_id: sourceTask?.client_id ?? null,
      status: "todo",
      sort_order: 0,
      tags: [],
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  // linked_task_id is set with the admin client: the comment UPDATE policy is
  // author-only, but any task creator may link a task to someone else's comment.
  // Guarded by the tasks:create check above.
  const { error: linkError } = await createAdminClient()
    .from("task_comments")
    .update({ linked_task_id: task.id })
    .eq("id", commentId)
  if (linkError) return { error: linkError.message }

  revalidatePath("/tasks")
  return { success: true, taskId: task.id }
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
