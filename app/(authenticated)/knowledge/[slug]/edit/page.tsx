import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ArticleForm } from "../../_components/article-form"
import type { KnowledgeArticle, KnowledgeCategory, KnowledgeTag } from "../../_lib/types"

type Props = {
  params: Promise<{ slug: string }>
}

export default async function EditArticlePage({ params }: Props) {
  const { slug } = await params
  const supabase = await createClient()

  // Fetch article by slug with joins
  const { data: raw } = await supabase
    .from("knowledge_articles")
    .select(
      "*, knowledge_article_tags(knowledge_tags(*)), profiles!author_id(id, full_name, avatar_url), knowledge_categories(*)"
    )
    .eq("slug", slug)
    .maybeSingle()

  if (!raw) notFound()

  // Fetch categories + tags for form
  const { data: categoriesRaw } = await supabase
    .from("knowledge_categories")
    .select("*")
    .order("name")

  const { data: tagsRaw } = await supabase
    .from("knowledge_tags")
    .select("*")
    .order("name")

  const categories = (categoriesRaw ?? []) as KnowledgeCategory[]
  const tags = (tagsRaw ?? []) as KnowledgeTag[]

  const profile = raw.profiles as Record<string, unknown> | null
  const category = raw.knowledge_categories as KnowledgeCategory | null
  const tagAssignments = (raw.knowledge_article_tags ?? []) as Array<{
    knowledge_tags: KnowledgeTag
  }>
  const articleTags = tagAssignments
    .map((ta) => ta.knowledge_tags)
    .filter(Boolean)

  const article: KnowledgeArticle = {
    id: raw.id,
    title: raw.title,
    slug: raw.slug,
    excerpt: raw.excerpt || "",
    content_html: raw.content_html || "",
    category_id: raw.category_id,
    category,
    tag_ids: articleTags.map((t) => t.id),
    tags: articleTags,
    author: {
      id: (profile?.id as string) ?? "",
      full_name: (profile?.full_name as string) ?? "Unknown",
      avatar_url: (profile?.avatar_url as string) ?? null,
    },
    author_id: raw.author_id,
    status: raw.status,
    published_at: raw.published_at,
    updated_at: raw.updated_at,
    created_at: raw.created_at,
    reading_time_min: raw.reading_time_min ?? 1,
  }

  // TODO: Permission-gate: redirect if user lacks knowledge:edit
  const canPublish = true

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit Article</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Editing: {article.title}
        </p>
      </div>

      <ArticleForm
        article={article}
        categories={categories}
        tags={tags}
        canPublish={canPublish}
      />
    </div>
  )
}
