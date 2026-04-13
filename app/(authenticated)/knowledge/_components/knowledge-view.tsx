"use client"

import { useMemo, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CheckCircle, FileEdit, BarChart3 } from "lucide-react"
import { SearchBar } from "./search-bar"
import { TagFilterBar } from "./tag-filter-bar"
import { CategoryGrid } from "./category-grid"
import { ArticleList } from "./article-list"
import type {
  KnowledgeArticle,
  KnowledgeCategory,
  KnowledgeTag,
} from "../_lib/types"

type Props = {
  articles: KnowledgeArticle[]
  categories: KnowledgeCategory[]
  tags: KnowledgeTag[]
}

export function KnowledgeView({ articles, categories, tags }: Props) {
  const [tab, setTab] = useState("published")
  const [search, setSearch] = useState("")
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])

  const publishedArticles = useMemo(
    () => articles.filter((a) => a.status === "published"),
    [articles]
  )
  const draftArticles = useMemo(
    () => articles.filter((a) => a.status === "draft"),
    [articles]
  )

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  function filterArticles(list: KnowledgeArticle[]): KnowledgeArticle[] {
    let filtered = list

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = filtered.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.excerpt.toLowerCase().includes(q) ||
          a.category?.name.toLowerCase().includes(q) ||
          a.tags?.some((t) => t.name.toLowerCase().includes(q))
      )
    }

    // Tag filter
    if (selectedTagIds.length > 0) {
      filtered = filtered.filter((a) =>
        selectedTagIds.some((tid) => a.tag_ids.includes(tid))
      )
    }

    return filtered
  }

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="published" className="gap-1.5">
          <CheckCircle className="size-4" />
          Published
          <span className="ml-1 text-xs text-muted-foreground">
            ({publishedArticles.length})
          </span>
        </TabsTrigger>
        <TabsTrigger value="drafts" className="gap-1.5">
          <FileEdit className="size-4" />
          Drafts
          <span className="ml-1 text-xs text-muted-foreground">
            ({draftArticles.length})
          </span>
        </TabsTrigger>
        <TabsTrigger value="insights" className="gap-1.5">
          <BarChart3 className="size-4" />
          Insights
        </TabsTrigger>
      </TabsList>

      <TabsContent value="published" className="mt-6 space-y-6">
        <SearchBar value={search} onChange={setSearch} />
        <TagFilterBar
          tags={tags}
          selectedTagIds={selectedTagIds}
          onToggle={toggleTag}
        />
        <div>
          <h3 className="text-lg font-semibold mb-4">Categories</h3>
          <CategoryGrid categories={categories} />
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-4">Articles</h3>
          <ArticleList
            articles={filterArticles(publishedArticles)}
            emptyMessage="No published articles match your search"
          />
        </div>
      </TabsContent>

      <TabsContent value="drafts" className="mt-6 space-y-6">
        <SearchBar value={search} onChange={setSearch} />
        <ArticleList
          articles={filterArticles(draftArticles)}
          emptyMessage="No drafts found"
        />
      </TabsContent>

      <TabsContent value="insights" className="mt-6">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-muted p-4">
            <BarChart3 className="size-8 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium">Coming soon</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Article engagement metrics and reading analytics
          </p>
        </div>
      </TabsContent>
    </Tabs>
  )
}
