import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { Separator } from "@/components/ui/separator"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ArticleHeader } from "../_components/article-header"
import { ArticleRenderer } from "../_components/article-renderer"
import { ArticleTableOfContents } from "../_components/article-toc"
import { ArticleMetadataSidebar } from "../_components/article-metadata-sidebar"
import type {
  KnowledgeArticle,
  KnowledgeCategory,
  KnowledgeTag,
} from "../_lib/types"

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
    article_type: raw.article_type ?? "guide",
    audience: raw.audience ?? "internal",
    canonical_question: raw.canonical_question ?? "",
    approved_answer: raw.approved_answer ?? "",
    escalation_guidance: raw.escalation_guidance ?? "",
    source_notes: raw.source_notes ?? "",
    review_status: raw.review_status ?? "draft",
    agent_enabled: raw.agent_enabled ?? false,
    agent_index_status: raw.agent_index_status ?? "not_indexed",
    agent_indexed_at: raw.agent_indexed_at ?? null,
    agent_index_error: raw.agent_index_error ?? "",
    agent_index_model: raw.agent_index_model ?? "",
    agent_chunk_count: Number(raw.agent_chunk_count ?? 0),
    agent_index_input_tokens: Number(raw.agent_index_input_tokens ?? 0),
    agent_index_cost_usd: Number(raw.agent_index_cost_usd ?? 0),
    approved_by: raw.approved_by ?? null,
    approved_at: raw.approved_at ?? null,
    last_reviewed_at: raw.last_reviewed_at ?? null,
    review_due_at: raw.review_due_at ?? null,
  }

  const [canEdit, canPublish, canDelete] = await Promise.all([
    hasPermission("knowledge", "edit"),
    hasPermission("knowledge", "publish"),
    hasPermission("knowledge", "delete"),
  ])
  const { data: indexedChunks } = article.agent_enabled
    ? await supabase
        .from("knowledge_chunks")
        .select("id, heading, content, chunk_index")
        .eq("article_id", article.id)
        .order("chunk_index")
        .limit(8)
    : { data: [] }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
      {/* Main content */}
      <div className="min-w-0 space-y-6">
        <ArticleHeader article={article} />
        {(article.canonical_question || article.approved_answer) && (
          <Card>
            <CardHeader>
              <CardDescription>Common client question</CardDescription>
              <CardTitle>
                {article.canonical_question || article.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {article.approved_answer ? (
                <p className="text-sm leading-6 whitespace-pre-wrap">
                  {article.approved_answer}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No approved short answer has been written yet.
                </p>
              )}
              {article.escalation_guidance && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Escalate when</p>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {article.escalation_guidance}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        <Separator />
        <ArticleRenderer html={article.content_html} />
      </div>

      {/* Sidebar */}
      <aside className="hidden lg:block">
        <div className="sticky top-[calc(var(--topbar-h)+--spacing(6))] space-y-6">
          <ArticleTableOfContents html={article.content_html} />
          <Separator />
          <ArticleMetadataSidebar
            article={article}
            canEdit={canEdit}
            canPublish={canPublish}
            canDelete={canDelete}
            indexedChunks={(indexedChunks ?? []).map((chunk) => ({
              id: chunk.id,
              heading: chunk.heading ?? "Article",
              content: chunk.content,
            }))}
          />
        </div>
      </aside>
    </div>
  )
}
