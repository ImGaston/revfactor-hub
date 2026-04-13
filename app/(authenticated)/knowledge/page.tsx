import Link from "next/link"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"
import { KnowledgeStatCards } from "./_components/stat-cards"
import { KnowledgeView } from "./_components/knowledge-view"
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
  }

  // TODO: Permission-gate the "Add Article" button using real permissions
  const canCreate = true

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Knowledge</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Internal reference for RevFactor processes and SOPs
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/knowledge/new">
              <Plus className="size-4 mr-2" />
              Add Article
            </Link>
          </Button>
        )}
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
