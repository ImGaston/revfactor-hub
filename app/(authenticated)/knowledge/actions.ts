"use server"

import { revalidatePath } from "next/cache"
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

  const { error } = await supabase
    .from("knowledge_articles")
    .update({
      title: title.trim(),
      excerpt,
      content_html: contentHtml,
      category_id: categoryId || null,
      reading_time_min: readingTime,
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
  const supabase = await createClient()
  const { error } = await supabase
    .from("knowledge_articles")
    .update({
      status: "draft",
      published_at: null,
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
