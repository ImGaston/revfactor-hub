import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { ArticleList } from "../../_components/article-list"
import { getCategoryIcon } from "../../_lib/utils"
import type { KnowledgeArticle, KnowledgeCategory, KnowledgeTag } from "../../_lib/types"

type Props = {
  params: Promise<{ slug: string }>
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params
  const supabase = await createClient()

  // Fetch category
  const { data: category } = await supabase
    .from("knowledge_categories")
    .select("*")
    .eq("slug", slug)
    .maybeSingle()

  if (!category) notFound()

  const cat = category as KnowledgeCategory

  // Fetch published articles in this category
  const { data: articlesRaw } = await supabase
    .from("knowledge_articles")
    .select(
      "*, knowledge_article_tags(knowledge_tags(*)), profiles!author_id(id, full_name, avatar_url)"
    )
    .eq("category_id", cat.id)
    .eq("status", "published")
    .order("published_at", { ascending: false })

  const articles: KnowledgeArticle[] = (articlesRaw ?? []).map(
    (a: Record<string, unknown>) => {
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
        category: cat,
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
    }
  )

  const Icon = getCategoryIcon(cat.icon)

  return (
    <div className="space-y-6">
      {/* Category hero */}
      <div
        className={cn(
          "rounded-xl border p-6",
          cat.color,
          cat.dark_color
        )}
      >
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-white/60 p-3 dark:bg-white/10">
            <Icon className={cn("size-6", cat.accent_color)} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {cat.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {cat.description}
            </p>
            <Badge variant="secondary" className="mt-3">
              {articles.length}{" "}
              {articles.length === 1 ? "article" : "articles"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Articles */}
      <ArticleList
        articles={articles}
        emptyMessage="No articles in this category yet"
      />
    </div>
  )
}
