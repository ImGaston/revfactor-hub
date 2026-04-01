"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

// ─── Posts ───────────────────────────────────────────────

export async function createPost(formData: FormData) {
  const title = formData.get("title") as string
  const description = formData.get("description") as string
  const status = (formData.get("status") as string) || "backlog"
  const board_id = formData.get("board_id") as string
  const eta = formData.get("eta") as string
  const tagIds = formData.getAll("tag_ids") as string[]

  if (!title) return { error: "Title is required" }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: maxOrder } = await supabase
    .from("posts")
    .select("sort_order")
    .eq("status", status)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single()

  const sortOrder = (maxOrder?.sort_order ?? -1) + 1

  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      title,
      description: description || null,
      status,
      board_id: board_id || null,
      eta: eta || null,
      author_id: user?.id ?? null,
      sort_order: sortOrder,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  if (tagIds.length > 0 && post) {
    const rows = tagIds.map((tag_id) => ({ post_id: post.id, tag_id }))
    await supabase.from("post_tags").insert(rows)
  }

  revalidatePath("/roadmap")
  return { success: true }
}

export async function updatePost(
  postId: string,
  data: {
    title?: string
    description?: string | null
    status?: string
    board_id?: string | null
    eta?: string | null
  }
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("posts")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", postId)

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  return { success: true }
}

export async function updatePostTags(postId: string, tagIds: string[]) {
  const supabase = await createClient()

  await supabase.from("post_tags").delete().eq("post_id", postId)

  if (tagIds.length > 0) {
    const rows = tagIds.map((tag_id) => ({ post_id: postId, tag_id }))
    await supabase.from("post_tags").insert(rows)
  }

  revalidatePath("/roadmap")
  return { success: true }
}

export async function updatePostStatus(
  postId: string,
  newStatus: string,
  newSortOrder: number
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("posts")
    .update({
      status: newStatus,
      sort_order: newSortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId)

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  return { success: true }
}

export async function deletePost(postId: string) {
  const supabase = await createClient()

  const { error } = await supabase.from("posts").delete().eq("id", postId)

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  return { success: true }
}

// ─── Upvotes ─────────────────────────────────────────────

export async function toggleUpvote(postId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: "Not authenticated" }

  const { data: existing } = await supabase
    .from("post_upvotes")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", user.id)
    .single()

  if (existing) {
    await supabase
      .from("post_upvotes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user.id)
  } else {
    await supabase
      .from("post_upvotes")
      .insert({ post_id: postId, user_id: user.id })
  }

  revalidatePath("/roadmap")
  return { success: true }
}

// ─── Comments ────────────────────────────────────────────

export async function createComment(
  postId: string,
  content: string,
  parentCommentId?: string
) {
  if (!content.trim()) return { error: "Content is required" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: "Not authenticated" }

  const { error } = await supabase.from("comments").insert({
    post_id: postId,
    author_id: user.id,
    content: content.trim(),
    parent_comment_id: parentCommentId || null,
  })

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  return { success: true }
}

export async function deleteComment(commentId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId)

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  return { success: true }
}

export async function toggleCommentReaction(
  commentId: string,
  reaction: "like" | "dislike"
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: "Not authenticated" }

  const { data: existing } = await supabase
    .from("comment_reactions")
    .select("reaction")
    .eq("comment_id", commentId)
    .eq("user_id", user.id)
    .single()

  if (existing) {
    if (existing.reaction === reaction) {
      await supabase
        .from("comment_reactions")
        .delete()
        .eq("comment_id", commentId)
        .eq("user_id", user.id)
    } else {
      await supabase
        .from("comment_reactions")
        .update({ reaction })
        .eq("comment_id", commentId)
        .eq("user_id", user.id)
    }
  } else {
    await supabase
      .from("comment_reactions")
      .insert({ comment_id: commentId, user_id: user.id, reaction })
  }

  revalidatePath("/roadmap")
  return { success: true }
}

// ─── Boards & Tags (admin) ──────────────────────────────

export async function createBoard(formData: FormData) {
  const name = formData.get("name") as string
  const icon = (formData.get("icon") as string) || "📋"
  const description = formData.get("description") as string

  if (!name) return { error: "Name is required" }

  const supabase = await createClient()

  const { data: maxOrder } = await supabase
    .from("boards")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .single()

  const { error } = await supabase.from("boards").insert({
    name,
    icon,
    description: description || null,
    sort_order: (maxOrder?.sort_order ?? -1) + 1,
  })

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  revalidatePath("/settings/boards-tags")
  return { success: true }
}

export async function updateBoard(
  boardId: string,
  data: { name?: string; icon?: string; description?: string | null }
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("boards")
    .update(data)
    .eq("id", boardId)

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  revalidatePath("/settings/boards-tags")
  return { success: true }
}

export async function deleteBoard(boardId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("boards")
    .delete()
    .eq("id", boardId)

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  revalidatePath("/settings/boards-tags")
  return { success: true }
}

export async function createTag(formData: FormData) {
  const name = formData.get("name") as string
  const color = (formData.get("color") as string) || "#6b7280"

  if (!name) return { error: "Name is required" }

  const supabase = await createClient()

  const { error } = await supabase.from("tags").insert({ name, color })

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  revalidatePath("/settings/boards-tags")
  return { success: true }
}

export async function updateTag(
  tagId: string,
  data: { name?: string; color?: string }
) {
  const supabase = await createClient()

  const { error } = await supabase.from("tags").update(data).eq("id", tagId)

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  revalidatePath("/settings/boards-tags")
  return { success: true }
}

export async function deleteTag(tagId: string) {
  const supabase = await createClient()

  const { error } = await supabase.from("tags").delete().eq("id", tagId)

  if (error) return { error: error.message }

  revalidatePath("/roadmap")
  revalidatePath("/settings/boards-tags")
  return { success: true }
}
