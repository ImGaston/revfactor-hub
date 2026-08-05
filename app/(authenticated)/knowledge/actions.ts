"use server"

import { revalidatePath } from "next/cache"
import { hasPermission } from "@/lib/permissions.server"
import { indexKnowledgeArticle } from "@/lib/knowledge-retrieval.server"
import { createClient } from "@/lib/supabase/server"
import { estimateReadingTime, htmlToExcerpt } from "./_lib/utils"

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

export async function createArticle(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated", slug: null }

  const title = formData.get("title") as string
  if (!title || title.trim().length < 3) {
    return { error: "Title must be at least 3 characters", slug: null }
  }

  const contentHtml = (formData.get("content_html") as string) || ""
  const excerpt =
    (formData.get("excerpt") as string) || htmlToExcerpt(contentHtml)
  const categoryId = (formData.get("category_id") as string) || null
  const tagIds = formData.getAll("tag_ids") as string[]
  const publish = formData.get("publish") === "true"
  if (publish && !(await hasPermission("knowledge", "publish"))) {
    return { error: "You do not have permission to publish Knowledge.", slug: null }
  }
  const articleType = String(formData.get("article_type") || "guide")
  const audience = String(formData.get("audience") || "internal")
  const canonicalQuestion =
    String(formData.get("canonical_question") || "").trim() || null
  const approvedAnswer =
    String(formData.get("approved_answer") || "").trim() || null
  const escalationGuidance =
    String(formData.get("escalation_guidance") || "").trim() || null
  const sourceNotes = String(formData.get("source_notes") || "").trim() || null
  const reviewDueAt = String(formData.get("review_due_at") || "").trim() || null
  const slug = generateSlug(title)
  const readingTime = estimateReadingTime(contentHtml)

  // Check slug uniqueness
  const { data: existing } = await supabase
    .from("knowledge_articles")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()

  const finalSlug = existing ? `${slug}-${Date.now()}` : slug
  const status = publish ? "published" : "draft"

  const { data: article, error } = await supabase
    .from("knowledge_articles")
    .insert({
      title: title.trim(),
      slug: finalSlug,
      excerpt,
      content_html: contentHtml,
      category_id: categoryId || null,
      author_id: user.id,
      status,
      published_at: publish ? new Date().toISOString() : null,
      reading_time_min: readingTime,
      article_type: articleType,
      audience,
      canonical_question: canonicalQuestion,
      approved_answer: approvedAnswer,
      escalation_guidance: escalationGuidance,
      source_notes: sourceNotes,
      review_status: audience === "client_safe" ? "needs_review" : "draft",
      agent_enabled: false,
      review_due_at: reviewDueAt,
    })
    .select("id, slug")
    .single()

  if (error) return { error: error.message, slug: null }

  // Insert tag assignments
  if (tagIds.length > 0 && article) {
    const tagRows = tagIds.map((tagId) => ({
      article_id: article.id,
      tag_id: tagId,
    }))
    await supabase.from("knowledge_article_tags").insert(tagRows)
  }

  revalidatePath("/knowledge")
  return { error: null, slug: article.slug }
}

export async function updateArticle(id: string, formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const title = formData.get("title") as string
  if (!title || title.trim().length < 3) {
    return { error: "Title must be at least 3 characters" }
  }

  const contentHtml = (formData.get("content_html") as string) || ""
  const excerpt =
    (formData.get("excerpt") as string) || htmlToExcerpt(contentHtml)
  const categoryId = (formData.get("category_id") as string) || null
  const tagIds = formData.getAll("tag_ids") as string[]
  const readingTime = estimateReadingTime(contentHtml)
  const articleType = String(formData.get("article_type") || "guide")
  const audience = String(formData.get("audience") || "internal")
  const canonicalQuestion =
    String(formData.get("canonical_question") || "").trim() || null
  const approvedAnswer =
    String(formData.get("approved_answer") || "").trim() || null
  const escalationGuidance =
    String(formData.get("escalation_guidance") || "").trim() || null
  const sourceNotes = String(formData.get("source_notes") || "").trim() || null
  const reviewDueAt = String(formData.get("review_due_at") || "").trim() || null

  const { error } = await supabase
    .from("knowledge_articles")
    .update({
      title: title.trim(),
      excerpt,
      content_html: contentHtml,
      category_id: categoryId || null,
      reading_time_min: readingTime,
      article_type: articleType,
      audience,
      canonical_question: canonicalQuestion,
      approved_answer: approvedAnswer,
      escalation_guidance: escalationGuidance,
      source_notes: sourceNotes,
      review_status: audience === "client_safe" ? "needs_review" : "draft",
      agent_enabled: false,
      approved_by: null,
      approved_at: null,
      review_due_at: reviewDueAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) return { error: error.message }

  // Sync tags: delete existing, insert new
  await supabase.from("knowledge_article_tags").delete().eq("article_id", id)
  if (tagIds.length > 0) {
    const tagRows = tagIds.map((tagId) => ({
      article_id: id,
      tag_id: tagId,
    }))
    await supabase.from("knowledge_article_tags").insert(tagRows)
  }

  revalidatePath("/knowledge")
  return { error: null }
}

export async function deleteArticle(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from("knowledge_articles")
    .delete()
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}

export async function publishArticle(id: string) {
  if (!(await hasPermission("knowledge", "publish"))) {
    return { error: "You do not have permission to publish Knowledge." }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from("knowledge_articles")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}

export async function unpublishArticle(id: string) {
  if (!(await hasPermission("knowledge", "publish"))) {
    return { error: "You do not have permission to unpublish Knowledge." }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from("knowledge_articles")
    .update({
      status: "draft",
      agent_enabled: false,
      published_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}

export async function approveArticleForAgent(id: string) {
  if (!(await hasPermission("knowledge", "publish"))) {
    return { error: "You do not have permission to approve agent knowledge." }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: article } = await supabase
    .from("knowledge_articles")
    .select("status, audience, approved_answer")
    .eq("id", id)
    .maybeSingle()
  if (!article) return { error: "Article not found." }
  if (article.status !== "published") {
    return { error: "Publish the article internally before approving it for the agent." }
  }
  if (article.audience !== "client_safe") {
    return { error: "Set the audience to Client-safe candidate first." }
  }
  if (!article.approved_answer?.trim()) {
    return { error: "Add an approved client answer before enabling this article." }
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from("knowledge_articles")
    .update({
      review_status: "approved",
      agent_enabled: true,
      approved_by: user.id,
      approved_at: now,
      last_reviewed_at: now,
      updated_at: now,
    })
    .eq("id", id)
  if (error) return { error: error.message }

  const indexing = await indexKnowledgeArticle({
    supabase,
    articleId: id,
    userId: user.id,
  })

  revalidatePath("/knowledge")
  return {
    error: null,
    indexingError: indexing.ok ? null : indexing.error,
    indexedChunks: indexing.ok ? indexing.chunkCount : 0,
  }
}

export async function reindexArticleForAgent(id: string) {
  if (!(await hasPermission("knowledge", "publish"))) {
    return { error: "You do not have permission to index agent knowledge." }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const result = await indexKnowledgeArticle({
    supabase,
    articleId: id,
    userId: user.id,
  })
  revalidatePath("/knowledge")

  return result.ok
    ? {
        error: null,
        chunkCount: result.chunkCount,
        inputTokens: result.inputTokens,
        costUsd: result.costUsd,
      }
    : { error: result.error }
}

export async function disableArticleForAgent(id: string) {
  if (!(await hasPermission("knowledge", "publish"))) {
    return { error: "You do not have permission to change agent knowledge." }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from("knowledge_articles")
    .update({
      agent_enabled: false,
      review_status: "needs_review",
      approved_by: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}

export async function setArticleAudience(
  id: string,
  audience: "internal" | "client_safe"
) {
  if (!(await hasPermission("knowledge", "edit"))) {
    return { error: "You do not have permission to edit Knowledge." }
  }
  const supabase = await createClient()

  // Changing audience resets governance, mirroring updateArticle: the agent
  // pipeline restarts from review for the new audience.
  const { error } = await supabase
    .from("knowledge_articles")
    .update({
      audience,
      review_status: audience === "client_safe" ? "needs_review" : "draft",
      agent_enabled: false,
      approved_by: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}

// ── Categories ─────────────────────────────────────────────────────────────

type CategoryInput = {
  name: string
  description?: string
  icon: string
  color: string
  dark_color: string
  accent_color: string
}

export async function createCategory(input: CategoryInput) {
  const supabase = await createClient()
  const name = input.name.trim()
  if (!name || name.length < 2) {
    return { error: "Name must be at least 2 characters" }
  }

  const slug = generateSlug(name)

  const { data: existing } = await supabase
    .from("knowledge_categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()

  const finalSlug = existing ? `${slug}-${Date.now()}` : slug

  const { error } = await supabase.from("knowledge_categories").insert({
    name,
    slug: finalSlug,
    description: input.description?.trim() || null,
    icon: input.icon,
    color: input.color,
    dark_color: input.dark_color,
    accent_color: input.accent_color,
  })

  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}

export async function updateCategory(id: string, input: CategoryInput) {
  const supabase = await createClient()
  const name = input.name.trim()
  if (!name || name.length < 2) {
    return { error: "Name must be at least 2 characters" }
  }

  const { error } = await supabase
    .from("knowledge_categories")
    .update({
      name,
      description: input.description?.trim() || null,
      icon: input.icon,
      color: input.color,
      dark_color: input.dark_color,
      accent_color: input.accent_color,
    })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}

export async function deleteCategory(id: string) {
  const supabase = await createClient()

  // Check if any articles use this category
  const { count } = await supabase
    .from("knowledge_articles")
    .select("*", { count: "exact", head: true })
    .eq("category_id", id)

  if (count && count > 0) {
    return {
      error: `Cannot delete: ${count} article(s) still use this category. Reassign or delete them first.`,
    }
  }

  const { error } = await supabase
    .from("knowledge_categories")
    .delete()
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/knowledge")
  return { error: null }
}

// ── Image upload ───────────────────────────────────────────────────────────

export async function uploadImage(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated", url: null }

  const file = formData.get("file") as File | null
  if (!file) return { error: "No file provided", url: null }

  if (!file.type.startsWith("image/")) {
    return { error: "File must be an image", url: null }
  }

  if (file.size > 5 * 1024 * 1024) {
    return { error: "Image must be under 5MB", url: null }
  }

  const ext = file.name.split(".").pop() || "png"
  const filePath = `${user.id}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from("knowledge-images")
    .upload(filePath, file)

  if (uploadError) return { error: uploadError.message, url: null }

  const {
    data: { publicUrl },
  } = supabase.storage.from("knowledge-images").getPublicUrl(filePath)

  return { error: null, url: publicUrl }
}
