"use client"

import { CategoryCard } from "./category-card"
import type { KnowledgeCategory } from "../_lib/types"

export function CategoryGrid({
  categories,
}: {
  categories: KnowledgeCategory[]
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((cat) => (
        <CategoryCard key={cat.id} category={cat} />
      ))}
    </div>
  )
}
