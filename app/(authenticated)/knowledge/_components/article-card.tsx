"use client"

import Link from "next/link"
import { Clock, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { TagChip } from "./tag-chip"
import { formatRelativeDate } from "../_lib/utils"
import type { KnowledgeArticle } from "../_lib/types"

export function ArticleCard({ article }: { article: KnowledgeArticle }) {
  return (
    <Link
      href={`/knowledge/${article.slug}`}
      className="group block rounded-xl border p-5 transition-all hover:bg-accent/50 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {article.category && (
              <Badge variant="secondary" className="text-xs shrink-0">
                {article.category.name}
              </Badge>
            )}
            {article.status === "draft" && (
              <Badge
                variant="outline"
                className="text-xs text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700 shrink-0"
              >
                Draft
              </Badge>
            )}
          </div>
          <h3 className="mt-2 font-semibold leading-tight group-hover:text-primary transition-colors">
            {article.title}
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
            {article.excerpt}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 flex-wrap">
        {article.tags && article.tags.length > 0 && (
          <div className="flex items-center gap-1.5">
            {article.tags.slice(0, 3).map((tag) => (
              <TagChip key={tag.id} tag={tag} selected size="sm" />
            ))}
            {article.tags.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{article.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <User className="size-3" />
          {article.author.full_name}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {article.reading_time_min} min read
        </span>
        <span>
          {article.published_at
            ? formatRelativeDate(article.published_at)
            : formatRelativeDate(article.updated_at)}
        </span>
      </div>
    </Link>
  )
}
