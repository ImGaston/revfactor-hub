"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { getCategoryIcon } from "../_lib/utils"
import type { KnowledgeCategory } from "../_lib/types"

export function CategoryCard({ category }: { category: KnowledgeCategory }) {
  const Icon = getCategoryIcon(category.icon)

  return (
    <Link
      href={`/knowledge/category/${category.slug}`}
      className={cn(
        "group flex flex-col gap-2 sm:gap-3 rounded-xl border p-3 sm:p-5 transition-all hover:shadow-md",
        category.color,
        category.dark_color
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "rounded-lg bg-white/60 p-2 sm:p-2.5 dark:bg-white/10",
          )}
        >
          <Icon className={cn("size-4 sm:size-5", category.accent_color)} />
        </div>
        <Badge variant="secondary" className="text-xs shrink-0">
          {category.article_count ?? 0}{" "}
          {category.article_count === 1 ? "article" : "articles"}
        </Badge>
      </div>
      <div className="min-w-0">
        <h3 className="text-sm sm:text-base font-semibold">{category.name}</h3>
        <p className="mt-1 hidden text-sm text-muted-foreground line-clamp-2 sm:block">
          {category.description}
        </p>
      </div>
    </Link>
  )
}
