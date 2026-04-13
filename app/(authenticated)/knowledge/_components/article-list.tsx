"use client"

import { FileText } from "lucide-react"
import { ArticleCard } from "./article-card"
import type { KnowledgeArticle } from "../_lib/types"

type ArticleListProps = {
  articles: KnowledgeArticle[]
  emptyMessage?: string
}

export function ArticleList({
  articles,
  emptyMessage = "No articles found",
}: ArticleListProps) {
  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-4">
          <FileText className="size-8 text-muted-foreground" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} />
      ))}
    </div>
  )
}
