"use client"

import { useMemo, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertTriangle, BarChart3, CheckCircle, FileEdit, RefreshCcw } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  const indexedArticles = useMemo(
    () => articles.filter((article) => article.agent_index_status === "indexed"),
    [articles]
  )
  const staleArticles = useMemo(
    () =>
      articles.filter(
        (article) =>
          article.agent_enabled &&
          article.agent_index_status !== "indexed" &&
          article.agent_index_status !== "failed"
      ),
    [articles]
  )
  const failedArticles = useMemo(
    () => articles.filter((article) => article.agent_index_status === "failed"),
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

      <TabsContent value="insights" className="mt-6 flex flex-col gap-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle /> Indexed
              </CardTitle>
              <CardDescription>Available to hybrid retrieval</CardDescription>
            </CardHeader>
            <CardContent className="font-mono text-3xl">
              {indexedArticles.length}
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCcw /> Needs indexing
              </CardTitle>
              <CardDescription>Approved but not current</CardDescription>
            </CardHeader>
            <CardContent className="font-mono text-3xl">
              {staleArticles.length}
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle /> Failed
              </CardTitle>
              <CardDescription>Requires publisher review</CardDescription>
            </CardHeader>
            <CardContent className="font-mono text-3xl">
              {failedArticles.length}
            </CardContent>
          </Card>
        </div>

        {(staleArticles.length > 0 || failedArticles.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>Indexing attention</CardTitle>
              <CardDescription>
                Open an article to inspect its passages or retry indexing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ArticleList
                articles={[...failedArticles, ...staleArticles]}
                emptyMessage="All agent-enabled Knowledge is indexed"
              />
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  )
}
