"use client"

import { Clock, User } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { TagChip } from "./tag-chip"
import { formatRelativeDate } from "../_lib/utils"
import type { KnowledgeArticle } from "../_lib/types"

export function ArticleHeader({ article }: { article: KnowledgeArticle }) {
  const initials = article.author.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {article.category && (
          <Badge variant="secondary">{article.category.name}</Badge>
        )}
        {article.status === "draft" && (
          <Badge
            variant="outline"
            className="text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700"
          >
            Draft
          </Badge>
        )}
      </div>

      <h1 className="text-3xl font-bold tracking-tight">{article.title}</h1>

      {article.tags && article.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {article.tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} selected size="sm" />
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Avatar className="size-6">
            {article.author.avatar_url && (
              <AvatarImage src={article.author.avatar_url} />
            )}
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
          <span>{article.author.full_name}</span>
        </div>
        <span className="flex items-center gap-1">
          <Clock className="size-3.5" />
          {article.reading_time_min} min read
        </span>
        <span>
          {article.published_at
            ? formatRelativeDate(article.published_at)
            : `Updated ${formatRelativeDate(article.updated_at)}`}
        </span>
      </div>
    </div>
  )
}
