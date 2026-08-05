"use client"

import { useMemo } from "react"
import {
  AlertTriangle,
  CheckCircle,
  FileEdit,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { ArticleList } from "./article-list"
import type { KnowledgeArticle } from "../_lib/types"

type PipelineGroup = {
  key: string
  title: string
  description: string
  icon: LucideIcon
  iconClass: string
  articles: KnowledgeArticle[]
}

// Bucketed once, first match wins (top → bottom).
function bucketArticles(articles: KnowledgeArticle[]): PipelineGroup[] {
  const groups: Array<Omit<PipelineGroup, "articles"> & { match: (a: KnowledgeArticle) => boolean }> = [
    {
      key: "failed",
      title: "Indexing failed",
      description: "Indexing errored — open the article to retry",
      icon: AlertTriangle,
      iconClass: "text-destructive",
      match: (a) => a.agent_index_status === "failed",
    },
    {
      key: "live",
      title: "Live",
      description: "Approved, enabled, and indexed for retrieval",
      icon: CheckCircle,
      iconClass: "text-emerald-600 dark:text-emerald-400",
      match: (a) => a.agent_enabled && a.agent_index_status === "indexed",
    },
    {
      key: "indexing",
      title: "Enabled — indexing",
      description: "Enabled for the agent but the index is not current",
      icon: RefreshCcw,
      iconClass: "text-amber-600 dark:text-amber-400",
      match: (a) => a.agent_enabled,
    },
    {
      key: "needs-review",
      title: "Needs review",
      description: "Waiting for a publisher to approve the agent answer",
      icon: ShieldCheck,
      iconClass: "text-blue-600 dark:text-blue-400",
      match: (a) => a.review_status === "needs_review",
    },
    {
      key: "approved",
      title: "Approved — not enabled",
      description: "Approved for the agent but not yet enabled",
      icon: Sparkles,
      iconClass: "text-violet-600 dark:text-violet-400",
      match: (a) => a.review_status === "approved" && !a.agent_enabled,
    },
    {
      key: "drafting",
      title: "Drafting",
      description: "Client-safe articles still being drafted",
      icon: FileEdit,
      iconClass: "text-muted-foreground",
      match: () => true,
    },
  ]

  const buckets = groups.map((g) => ({ ...g, articles: [] as KnowledgeArticle[] }))
  for (const article of articles) {
    buckets.find((g) => g.match(article))?.articles.push(article)
  }
  return buckets
}

export function AgentPipelinePanel({
  articles,
}: {
  articles: KnowledgeArticle[]
}) {
  const groups = useMemo(() => bucketArticles(articles), [articles])
  const nonEmpty = groups.filter((g) => g.articles.length > 0)

  if (nonEmpty.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-10 border rounded-lg border-dashed">
        No articles in the agent pipeline yet. Mark an article as client-safe to
        start the review flow.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      {nonEmpty.map((group) => (
        <div key={group.key}>
          <div className="mb-4">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <group.icon className={`size-5 ${group.iconClass}`} />
              {group.title}
              <span className="text-sm font-normal text-muted-foreground">
                ({group.articles.length})
              </span>
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {group.description}
            </p>
          </div>
          <ArticleList articles={group.articles} emptyMessage="" />
        </div>
      ))}
    </div>
  )
}
