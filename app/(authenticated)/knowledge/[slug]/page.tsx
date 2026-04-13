import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Separator } from "@/components/ui/separator"
import { ArticleHeader } from "../_components/article-header"
import { ArticleRenderer } from "../_components/article-renderer"
import { ArticleTableOfContents } from "../_components/article-toc"
import { ArticleMetadataSidebar } from "../_components/article-metadata-sidebar"
import type { KnowledgeArticle, KnowledgeCategory, KnowledgeTag } from "../_lib/types"

type Props = {
  params: Promise<{ slug: string }>
}

export default async function ArticleDetailPage({ params }: Props) {
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

  // TODO: Permission-gate actions using real permissions
  const canEdit = true
  const canPublish = true
  const canDelete = true

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
      {/* Main content */}
      <div className="min-w-0 space-y-6">
        <ArticleHeader article={article} />
        <Separator />
        <ArticleRenderer html={article.content_html} />
      </div>

      {/* Sidebar */}
      <aside className="hidden lg:block">
        <div className="sticky top-6 space-y-6">
          <ArticleTableOfContents html={article.content_html} />
          <Separator />
          <ArticleMetadataSidebar
            article={article}
            canEdit={canEdit}
            canPublish={canPublish}
            canDelete={canDelete}
          />
        </div>
      </aside>
    </div>
  )
}
