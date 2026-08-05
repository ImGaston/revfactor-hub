"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, RefreshCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  approveArticleForAgent,
  disableArticleForAgent,
  publishArticle,
  reindexArticleForAgent,
  setArticleAudience,
  unpublishArticle,
} from "../actions"
import type { KnowledgeArticle } from "../_lib/types"

const REVIEW_BADGE: Record<
  KnowledgeArticle["review_status"],
  { label: string; className: string }
> = {
  approved: {
    label: "Approved",
    className:
      "bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-400",
  },
  needs_review: {
    label: "Needs review",
    className:
      "bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-400",
  },
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground border-border",
  },
}

const INDEX_BADGE: Record<
  KnowledgeArticle["agent_index_status"],
  { label: string; className: string }
> = {
  indexed: {
    label: "Indexed",
    className:
      "bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-400",
  },
  pending: {
    label: "Pending",
    className:
      "bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-400",
  },
  indexing: {
    label: "Indexing",
    className:
      "bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-400",
  },
  stale: {
    label: "Stale",
    className:
      "bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-400",
  },
  failed: {
    label: "Failed",
    className:
      "bg-red-500/10 text-red-700 border-red-300 dark:text-red-400",
  },
  not_indexed: {
    label: "Not indexed",
    className: "bg-muted text-muted-foreground border-border",
  },
}

function isLive(article: KnowledgeArticle): boolean {
  return (
    article.status === "published" &&
    article.audience === "client_safe" &&
    article.review_status === "approved" &&
    article.agent_enabled
  )
}

export function AgentGatesTable({
  articles,
  canPublish,
  canEdit,
}: {
  articles: KnowledgeArticle[]
  canPublish: boolean
  canEdit: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  function runAction(
    key: string,
    action: () => Promise<{ error: string | null; indexingError?: string | null }>,
    successMessage: string
  ) {
    setPendingKey(key)
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(successMessage)
        if (result.indexingError) {
          toast.warning(`Indexing issue: ${result.indexingError}`)
        }
        router.refresh()
      }
      setPendingKey(null)
    })
  }

  if (articles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-10 border rounded-lg border-dashed">
        No articles yet.
      </p>
    )
  }

  const liveCount = articles.filter(isLive).length

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        The agent reads articles that pass all four gates: published,
        client-safe, approved, and enabled.{" "}
        <span className="font-medium text-foreground">
          {liveCount} of {articles.length}
        </span>{" "}
        currently live.
      </p>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px]">Article</TableHead>
              <TableHead>Live</TableHead>
              <TableHead>Published</TableHead>
              <TableHead>Client-safe</TableHead>
              <TableHead>Review</TableHead>
              <TableHead>Agent enabled</TableHead>
              <TableHead>Index</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {articles.map((article) => {
              const live = isLive(article)
              const review = REVIEW_BADGE[article.review_status]
              const index = INDEX_BADGE[article.agent_index_status]
              const rowPending = pendingKey?.startsWith(article.id) ?? false
              const showReindex =
                canPublish &&
                article.agent_enabled &&
                article.agent_index_status !== "indexed" &&
                article.agent_index_status !== "indexing"

              return (
                <TableRow key={article.id}>
                  <TableCell className="max-w-[320px]">
                    <Link
                      href={`/knowledge/${article.slug}`}
                      className="text-sm font-medium hover:underline line-clamp-2"
                    >
                      {article.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {article.category?.name ?? "Uncategorized"} ·{" "}
                      {article.article_type.toUpperCase()}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${live ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                    >
                      <span
                        className={`size-2 rounded-full ${live ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                      />
                      {live ? "Live" : "Off"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={article.status === "published"}
                      disabled={!canPublish || (isPending && rowPending)}
                      onCheckedChange={(checked) =>
                        runAction(
                          `${article.id}:published`,
                          () =>
                            checked
                              ? publishArticle(article.id)
                              : unpublishArticle(article.id),
                          checked ? "Article published" : "Article unpublished"
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={article.audience === "client_safe"}
                      disabled={!canEdit || (isPending && rowPending)}
                      onCheckedChange={(checked) =>
                        runAction(
                          `${article.id}:audience`,
                          () =>
                            setArticleAudience(
                              article.id,
                              checked ? "client_safe" : "internal"
                            ),
                          checked
                            ? "Marked as client-safe candidate (review restarts)"
                            : "Marked as internal-only"
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${review.className}`}
                    >
                      {review.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={article.agent_enabled}
                      disabled={!canPublish || (isPending && rowPending)}
                      onCheckedChange={(checked) =>
                        runAction(
                          `${article.id}:enabled`,
                          () =>
                            checked
                              ? approveArticleForAgent(article.id)
                              : disableArticleForAgent(article.id),
                          checked
                            ? "Approved and enabled for the agent"
                            : "Disabled for the agent"
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${index.className}`}
                      >
                        {index.label}
                      </Badge>
                      {showReindex && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          title="Re-index for retrieval"
                          disabled={isPending && rowPending}
                          onClick={() =>
                            runAction(
                              `${article.id}:reindex`,
                              () => reindexArticleForAgent(article.id),
                              "Article re-indexed"
                            )
                          }
                        >
                          {rowPending && pendingKey === `${article.id}:reindex` ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <RefreshCcw className="size-3" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
