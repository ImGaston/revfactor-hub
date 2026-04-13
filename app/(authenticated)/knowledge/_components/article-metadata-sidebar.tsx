"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  Calendar,
  Clock,
  Edit,
  Eye,
  EyeOff,
  Trash2,
  User,
} from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { TagChip } from "./tag-chip"
import { DeleteArticleDialog } from "./delete-article-dialog"
import { publishArticle, unpublishArticle } from "../actions"
import { formatRelativeDate } from "../_lib/utils"
import type { KnowledgeArticle } from "../_lib/types"

type Props = {
  article: KnowledgeArticle
  canEdit?: boolean
  canPublish?: boolean
  canDelete?: boolean
}

export function ArticleMetadataSidebar({
  article,
  canEdit = true,
  canPublish = true,
  canDelete = true,
}: Props) {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)

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
