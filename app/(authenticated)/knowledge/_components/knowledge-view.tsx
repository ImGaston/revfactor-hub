"use client"

import { useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle,
  KeyRound,
  RefreshCcw,
  Workflow,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SearchBar } from "./search-bar"
import { TagFilterBar } from "./tag-filter-bar"
import { CategoryGrid } from "./category-grid"
import { ArticleList } from "./article-list"
import { AgentPipelinePanel } from "./agent-pipeline-panel"
import { TeamCredentials } from "./team-credentials"
import type {
  KnowledgeArticle,
  KnowledgeCategory,
  KnowledgeTag,
} from "../_lib/types"
import type { AgentFlowSummary } from "@/lib/agent-flows"
import type { TeamCredential } from "@/lib/types"
import { AgentFlowsPanel } from "./agent-flows-panel"

const TAB_VALUES = [
  "team",
  "agent",
  "credentials",
  "insights",
  "agent-flows",
] as const

type TabValue = (typeof TAB_VALUES)[number]

type StatusFilter = "all" | "published" | "draft"

type Props = {
  articles: KnowledgeArticle[]
  categories: KnowledgeCategory[]
  tags: KnowledgeTag[]
  flows: AgentFlowSummary[]
  canCreateFlows: boolean
  credentials: TeamCredential[]
  canViewCredentials: boolean
  canManageCredentials: { create: boolean; edit: boolean; delete: boolean }
}

export function KnowledgeView({
  articles,
  categories,
  tags,
  flows,
  canCreateFlows,
  credentials,
  canViewCredentials,
  canManageCredentials,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function resolveTab(param: string | null): TabValue {
    // Legacy deep links from the old tab structure
    if (param === "published" || param === "drafts") return "team"
    if (param && (TAB_VALUES as readonly string[]).includes(param)) {
      if (param === "credentials" && !canViewCredentials) return "team"
      return param as TabValue
    }
    return "team"
  }

  const [tab, setTab] = useState<TabValue>(() =>
    resolveTab(searchParams.get("tab"))
  )
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [search, setSearch] = useState("")
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])

  function handleTabChange(value: string) {
    const next = resolveTab(value)
    setTab(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next === "team") params.delete("tab")
    else params.set("tab", next)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const publishedArticles = useMemo(
    () => articles.filter((a) => a.status === "published"),
    [articles]
  )
  const draftArticles = useMemo(
    () => articles.filter((a) => a.status === "draft"),
    [articles]
  )
  const agentArticles = useMemo(
    () =>
      articles.filter((a) => a.audience === "client_safe" || a.agent_enabled),
    [articles]
  )
  const indexedArticles = useMemo(
    () =>
      articles.filter((article) => article.agent_index_status === "indexed"),
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
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    )
  }

  function applySearch(list: KnowledgeArticle[]): KnowledgeArticle[] {
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.excerpt.toLowerCase().includes(q) ||
        a.category?.name.toLowerCase().includes(q) ||
        a.tags?.some((t) => t.name.toLowerCase().includes(q))
    )
  }

  function filterArticles(list: KnowledgeArticle[]): KnowledgeArticle[] {
    let filtered = applySearch(list)

    // Tag filter
    if (selectedTagIds.length > 0) {
      filtered = filtered.filter((a) =>
        selectedTagIds.some((tid) => a.tag_ids.includes(tid))
      )
    }

    return filtered
  }

  const teamArticles =
    statusFilter === "published"
      ? publishedArticles
      : statusFilter === "draft"
        ? draftArticles
        : articles

  const statusPills: Array<{ value: StatusFilter; label: string; count: number }> = [
    { value: "all", label: "All", count: articles.length },
    { value: "published", label: "Published", count: publishedArticles.length },
    { value: "draft", label: "Drafts", count: draftArticles.length },
  ]

  return (
    <Tabs value={tab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="team" className="gap-1.5">
          <BookOpen className="size-4" />
          Team
          <span className="ml-1 text-xs text-muted-foreground">
            ({articles.length})
          </span>
        </TabsTrigger>
        <TabsTrigger value="agent" className="gap-1.5">
          <Bot className="size-4" />
          Agent
          <span className="ml-1 text-xs text-muted-foreground">
            ({agentArticles.length})
          </span>
        </TabsTrigger>
        {canViewCredentials && (
          <TabsTrigger value="credentials" className="gap-1.5">
            <KeyRound className="size-4" />
            Credentials
            <span className="ml-1 text-xs text-muted-foreground">
              ({credentials.length})
            </span>
          </TabsTrigger>
        )}
        <TabsTrigger value="insights" className="gap-1.5">
          <BarChart3 className="size-4" />
          Insights
        </TabsTrigger>
        <TabsTrigger value="agent-flows" className="gap-1.5">
          <Workflow className="size-4" />
          Agent Flows
          <span className="ml-1 text-xs text-muted-foreground">
            ({flows.length})
          </span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="team" className="mt-6 space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px]">
            <SearchBar value={search} onChange={setSearch} />
          </div>
          <div className="flex items-center gap-1">
            {statusPills.map((pill) => (
              <Button
                key={pill.value}
                variant={statusFilter === pill.value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter(pill.value)}
              >
                {pill.label}
                <span className="ml-1 text-xs text-muted-foreground">
                  ({pill.count})
                </span>
              </Button>
            ))}
          </div>
        </div>
        <TagFilterBar
          tags={tags}
          selectedTagIds={selectedTagIds}
          onToggle={toggleTag}
        />
        <div>
          <h3 className="mb-4 text-lg font-semibold">Categories</h3>
          <CategoryGrid categories={categories} />
        </div>
        <div>
          <h3 className="mb-4 text-lg font-semibold">Articles</h3>
          <ArticleList
            articles={filterArticles(teamArticles)}
            emptyMessage="No articles match your search"
          />
        </div>
      </TabsContent>

      <TabsContent value="agent" className="mt-6 space-y-6">
        <SearchBar value={search} onChange={setSearch} />
        <AgentPipelinePanel articles={applySearch(agentArticles)} />
      </TabsContent>

      {canViewCredentials && (
        <TabsContent value="credentials" className="mt-6">
          <TeamCredentials
            credentials={credentials}
            canCreate={canManageCredentials.create}
            canEdit={canManageCredentials.edit}
            canDelete={canManageCredentials.delete}
          />
        </TabsContent>
      )}

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

      <TabsContent value="agent-flows" className="mt-6">
        <AgentFlowsPanel flows={flows} canCreate={canCreateFlows} />
      </TabsContent>
    </Tabs>
  )
}
