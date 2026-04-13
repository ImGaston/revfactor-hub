"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TiptapEditor } from "./editor/tiptap-editor"
import { TagChip } from "./tag-chip"
import { createArticle, updateArticle, publishArticle } from "../actions"
import { htmlToExcerpt } from "../_lib/utils"
import type { KnowledgeArticle, KnowledgeCategory, KnowledgeTag } from "../_lib/types"

type Props = {
  article?: KnowledgeArticle
  categories: KnowledgeCategory[]
  tags: KnowledgeTag[]
  canPublish?: boolean
}

export function ArticleForm({
  article,
  categories,
  tags,
  canPublish = true,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [title, setTitle] = useState(article?.title ?? "")
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "")
  const [categoryId, setCategoryId] = useState(article?.category_id ?? "")
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(
    new Set(article?.tag_ids ?? [])
  )
  const [contentHtml, setContentHtml] = useState(article?.content_html ?? "")

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  function handleSubmit(publish: boolean) {
    startTransition(async () => {
      const formData = new FormData()
      formData.set("title", title)
      formData.set(
        "excerpt",
        excerpt || htmlToExcerpt(contentHtml)
      )
      formData.set("category_id", categoryId)
      formData.set("content_html", contentHtml)
      for (const tagId of selectedTagIds) {
        formData.append("tag_ids", tagId)
      }

      if (article) {
        const result = await updateArticle(article.id, formData)
        if (result.error) {
          toast.error(result.error)
          return
        }
        if (publish) {
          await publishArticle(article.id)
        }
        toast.success(publish ? "Article published" : "Article saved")
        router.push(`/knowledge/${article.slug}`)
        router.refresh()
      } else {
        if (publish) formData.set("publish", "true")
        const result = await createArticle(formData)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success(publish ? "Article published" : "Draft saved")
        if (result.slug) {
          router.push(`/knowledge/${result.slug}`)
        } else {
          router.push("/knowledge")
        }
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="article-title">Title</Label>
        <Input
          id="article-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Article title..."
          className="text-lg font-semibold"
        />
      </div>

      {/* Excerpt */}
      <div className="space-y-2">
        <Label htmlFor="article-excerpt">
          Excerpt{" "}
          <span className="text-muted-foreground font-normal">
            (auto-generated if empty)
          </span>
        </Label>
        <Textarea
          id="article-excerpt"
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          placeholder="Brief summary of the article..."
          className="resize-none"
          rows={2}
        />
      </div>

      {/* Category & Tags row */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Tags</Label>
          <div className="flex flex-wrap gap-1.5 min-h-9 items-center rounded-xl border px-3 py-2">
            {tags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                selected={selectedTagIds.has(tag.id)}
                onClick={() => toggleTag(tag.id)}
                size="sm"
              />
            ))}
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="space-y-2">
        <Label>Content</Label>
        <TiptapEditor content={contentHtml} onChange={setContentHtml} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t">
        <Button
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline"
          onClick={() => handleSubmit(false)}
          disabled={isPending}
        >
          {isPending ? "Saving..." : "Save as Draft"}
        </Button>
        {canPublish && (
          <Button onClick={() => handleSubmit(true)} disabled={isPending}>
            {isPending
              ? "Publishing..."
              : article?.status === "published"
                ? "Save Changes"
                : "Publish"}
          </Button>
        )}
      </div>
    </div>
  )
}
