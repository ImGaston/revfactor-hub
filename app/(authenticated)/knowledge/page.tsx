import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { KnowledgeStatCards } from "./_components/stat-cards"
import { KnowledgeView } from "./_components/knowledge-view"
import { KnowledgeHeaderActions } from "./_components/knowledge-header-actions"
import type {
  KnowledgeArticle,
  KnowledgeCategory,
  KnowledgeTag,
  KnowledgeStats,
} from "./_lib/types"

export default async function KnowledgePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fetch articles with joined tags and author profile
  const { data: articlesRaw } = await supabase
    .from("knowledge_articles")
    .select(
      "*, knowledge_article_tags(knowledge_tags(*)), profiles!author_id(id, full_name, avatar_url)"
    )
    .order("updated_at", { ascending: false })

  // Fetch categories with article counts (from view)
  const { data: categoriesRaw } = await supabase
    .from("knowledge_category_article_counts")
    .select("*")
    .order("name")

  // Fetch all tags
  const { data: tagsRaw } = await supabase
    .from("knowledge_tags")
    .select("*")
    .order("name")

  const categories = (categoriesRaw ?? []) as KnowledgeCategory[]
  const tags = (tagsRaw ?? []) as KnowledgeTag[]

  // Transform articles to match component types
  const articles: KnowledgeArticle[] = (articlesRaw ?? []).map((a: Record<string, unknown>) => {
    const profile = a.profiles as Record<string, unknown> | null
    const tagAssignments = (a.knowledge_article_tags ?? []) as Array<{
      knowledge_tags: KnowledgeTag
    }>
    const articleTags = tagAssignments
      .map((ta) => ta.knowledge_tags)
      .filter(Boolean)

    return {
      id: a.id as string,
      title: a.title as string,
      slug: a.slug as string,
      excerpt: (a.excerpt as string) || "",
      content_html: (a.content_html as string) || "",
      category_id: a.category_id as string | null,
      category: categories.find((c) => c.id === a.category_id) ?? null,
      tag_ids: articleTags.map((t) => t.id),
      tags: articleTags,
      author: {
        id: (profile?.id as string) ?? "",
        full_name: (profile?.full_name as string) ?? "Unknown",
        avatar_url: (profile?.avatar_url as string) ?? null,
      },
      author_id: a.author_id as string,
      status: a.status as "draft" | "published",
      published_at: a.published_at as string | null,
      updated_at: a.updated_at as string,
      created_at: a.created_at as string,
      reading_time_min: (a.reading_time_min as number) ?? 1,
      article_type: (a.article_type as KnowledgeArticle["article_type"]) ?? "guide",
      audience: (a.audience as KnowledgeArticle["audience"]) ?? "internal",
      canonical_question: (a.canonical_question as string) ?? "",
      approved_answer: (a.approved_answer as string) ?? "",
      escalation_guidance: (a.escalation_guidance as string) ?? "",
      source_notes: (a.source_notes as string) ?? "",
      review_status:
        (a.review_status as KnowledgeArticle["review_status"]) ?? "draft",
      agent_enabled: Boolean(a.agent_enabled),
      approved_by: (a.approved_by as string) ?? null,
      approved_at: (a.approved_at as string) ?? null,
      last_reviewed_at: (a.last_reviewed_at as string) ?? null,
      review_due_at: (a.review_due_at as string) ?? null,
    }
  })

  // Compute stats
  const stats: KnowledgeStats = {
    total_published: articles.filter((a) => a.status === "published").length,
    total_drafts: articles.filter((a) => a.status === "draft").length,
    categories_count: categories.length,
    my_drafts: user
      ? articles.filter(
          (a) => a.status === "draft" && a.author_id === user.id
        ).length
      : 0,
    agent_ready: articles.filter((article) => article.agent_enabled).length,
    needs_agent_review: articles.filter(
      (article) => article.review_status === "needs_review"
    ).length,
  }

  const [canCreate, canManageCategories] = await Promise.all([
    hasPermission("knowledge", "create"),
    hasPermission("knowledge", "edit"),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Knowledge</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Internal reference for RevFactor processes and SOPs
          </p>
        </div>
        <KnowledgeHeaderActions
          categories={categories}
          canCreate={canCreate}
          canManageCategories={canManageCategories}
        />
      </div>

      <KnowledgeStatCards stats={stats} />

      <KnowledgeView
        articles={articles}
        categories={categories}
        tags={tags}
      />
    </div>
  )
}
