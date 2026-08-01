"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  Calendar,
  Clock,
  Edit,
  Eye,
  EyeOff,
  RefreshCcw,
  Trash2,
  User,
} from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { TagChip } from "./tag-chip"
import { DeleteArticleDialog } from "./delete-article-dialog"
import {
  approveArticleForAgent,
  disableArticleForAgent,
  publishArticle,
  reindexArticleForAgent,
  unpublishArticle,
} from "../actions"
import { formatRelativeDate } from "../_lib/utils"
import type { KnowledgeArticle } from "../_lib/types"

type Props = {
  article: KnowledgeArticle
  canEdit?: boolean
  canPublish?: boolean
  canDelete?: boolean
  indexedChunks?: Array<{ id: string; heading: string; content: string }>
}

export function ArticleMetadataSidebar({
  article,
  canEdit = true,
  canPublish = true,
  canDelete = true,
  indexedChunks = [],
}: Props) {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isIndexing, startIndexing] = useTransition()

  async function handlePublish() {
    const result = await publishArticle(article.id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Article published")
      router.refresh()
    }
  }

  async function handleUnpublish() {
    const result = await unpublishArticle(article.id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Article moved to drafts")
      router.refresh()
    }
  }

  async function handleAgentApproval() {
    const result = await approveArticleForAgent(article.id)
    if (result.error) {
      toast.error(result.error)
    } else {
      if (result.indexingError) {
        toast.warning(
          `Approved for Agent Studio, but indexing failed: ${result.indexingError}`
        )
      } else {
        toast.success(
          `Approved and indexed ${result.indexedChunks} searchable passage${result.indexedChunks === 1 ? "" : "s"}`
        )
      }
      router.refresh()
    }
  }

  function handleReindex() {
    startIndexing(async () => {
      const result = await reindexArticleForAgent(article.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(
          `Indexed ${result.chunkCount} searchable passage${result.chunkCount === 1 ? "" : "s"}`
        )
        router.refresh()
      }
    })
  }

  async function handleDisableAgent() {
    const result = await disableArticleForAgent(article.id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Removed from Agent Studio")
      router.refresh()
    }
  }

  const initials = article.author.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="space-y-6">
      {/* Author */}
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <User className="size-4" />
          Author
        </h4>
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            {article.author.avatar_url && (
              <AvatarImage src={article.author.avatar_url} />
            )}
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <span className="text-sm">{article.author.full_name}</span>
        </div>
      </div>

      <Separator />

      {/* Category */}
      {article.category && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Category</h4>
          <Link href={`/knowledge/category/${article.category.slug}`}>
            <Badge variant="secondary">{article.category.name}</Badge>
          </Link>
        </div>
      )}

      {/* Tags */}
      {article.tags && article.tags.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Tags</h4>
          <div className="flex flex-wrap gap-1.5">
            {article.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} selected size="sm" />
            ))}
          </div>
        </div>
      )}

      <Separator />

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Agent readiness</h4>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{article.article_type.toUpperCase()}</Badge>
          <Badge variant={article.agent_enabled ? "default" : "secondary"}>
            {article.agent_enabled
              ? "Agent enabled"
              : article.review_status === "needs_review"
                ? "Needs review"
                : article.review_status === "approved"
                  ? "Approved · disabled"
                  : "Not reviewed"}
          </Badge>
          <Badge variant="outline">
            {article.audience === "client_safe"
              ? "Client-safe candidate"
              : "Internal only"}
          </Badge>
          {article.agent_enabled && (
            <Badge
              variant={
                article.agent_index_status === "indexed"
                  ? "default"
                  : article.agent_index_status === "failed"
                    ? "destructive"
                    : "secondary"
              }
            >
              {article.agent_index_status.replaceAll("_", " ")}
            </Badge>
          )}
        </div>
        {article.agent_index_status === "indexed" && (
          <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>
              <dt>Passages</dt>
              <dd className="mt-0.5 font-mono text-foreground">
                {article.agent_chunk_count}
              </dd>
            </div>
            <div>
              <dt>Index cost</dt>
              <dd className="mt-0.5 font-mono text-foreground">
                ${article.agent_index_cost_usd.toFixed(6)}
              </dd>
            </div>
          </dl>
        )}
        {article.agent_index_error && (
          <p className="text-xs text-destructive wrap-anywhere">
            {article.agent_index_error}
          </p>
        )}
      </div>

      {indexedChunks.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">Indexed passages</h4>
            {indexedChunks.map((chunk) => (
              <div key={chunk.id} className="rounded-xl border p-2.5">
                <p className="text-xs font-medium">{chunk.heading}</p>
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground wrap-anywhere">
                  {chunk.content}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <Separator />

      {/* Dates */}
      <div className="space-y-2 text-sm">
        {article.published_at && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="size-3.5" />
            <span>Published {formatRelativeDate(article.published_at)}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="size-3.5" />
          <span>Updated {formatRelativeDate(article.updated_at)}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="size-3.5" />
          <span>{article.reading_time_min} min read</span>
        </div>
      </div>

      <Separator />

      {/* Actions */}
      <div className="space-y-2">
        {canEdit && (
          <Button variant="outline" size="sm" className="w-full gap-2" asChild>
            <Link href={`/knowledge/${article.slug}/edit`}>
              <Edit className="size-4" />
              Edit
            </Link>
          </Button>
        )}
        {canPublish && article.status === "draft" && (
          <Button
            variant="default"
            size="sm"
            className="w-full gap-2"
            onClick={handlePublish}
          >
            <Eye className="size-4" />
            Publish
          </Button>
        )}
        {canPublish && article.status === "published" && (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={handleUnpublish}
          >
            <EyeOff className="size-4" />
            Unpublish
          </Button>
        )}
        {canPublish &&
          article.status === "published" &&
          article.audience === "client_safe" &&
          !article.agent_enabled && (
            <Button
              variant="default"
              size="sm"
              className="w-full"
              onClick={handleAgentApproval}
            >
              Approve for Agent Studio
            </Button>
          )}
        {canPublish && article.agent_enabled && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleReindex}
            disabled={isIndexing}
          >
            {isIndexing ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCcw data-icon="inline-start" />
            )}
            {article.agent_index_status === "indexed"
              ? "Re-index Knowledge"
              : "Index Knowledge"}
          </Button>
        )}
        {canPublish && article.agent_enabled && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleDisableAgent}
          >
            Remove from Agent Studio
          </Button>
        )}
        {canDelete && (
          <Button
            variant="destructive"
            size="sm"
            className="w-full gap-2"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        )}
      </div>

      <DeleteArticleDialog
        articleId={article.id}
        articleTitle={article.title}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  )
}
