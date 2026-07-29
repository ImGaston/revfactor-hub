"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TiptapEditor } from "./editor/tiptap-editor"
import { TagChip } from "./tag-chip"
import { createArticle, updateArticle, publishArticle } from "../actions"
import { htmlToExcerpt } from "../_lib/utils"
import type {
  KnowledgeArticle,
  KnowledgeArticleType,
  KnowledgeAudience,
  KnowledgeCategory,
  KnowledgeTag,
} from "../_lib/types"

type Props = {
  article?: KnowledgeArticle
  categories: KnowledgeCategory[]
  tags: KnowledgeTag[]
  canPublish?: boolean
  initialType?: KnowledgeArticleType
}

export function ArticleForm({
  article,
  categories,
  tags,
  canPublish = true,
  initialType = "guide",
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
  const [articleType, setArticleType] = useState(
    article?.article_type ?? initialType
  )
  const [audience, setAudience] = useState(article?.audience ?? "internal")
  const [canonicalQuestion, setCanonicalQuestion] = useState(
    article?.canonical_question ?? ""
  )
  const [approvedAnswer, setApprovedAnswer] = useState(
    article?.approved_answer ?? ""
  )
  const [escalationGuidance, setEscalationGuidance] = useState(
    article?.escalation_guidance ?? ""
  )
  const [sourceNotes, setSourceNotes] = useState(article?.source_notes ?? "")
  const [reviewDueAt, setReviewDueAt] = useState(article?.review_due_at ?? "")

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
      formData.set("article_type", articleType)
      formData.set("audience", audience)
      formData.set("canonical_question", canonicalQuestion)
      formData.set("approved_answer", approvedAnswer)
      formData.set("escalation_guidance", escalationGuidance)
      formData.set("source_notes", sourceNotes)
      formData.set("review_due_at", reviewDueAt)
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
              <SelectGroup>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectGroup>
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

      <Card>
        <CardHeader>
          <CardTitle>Agent answer card</CardTitle>
          <CardDescription>
            Store the exact short answer the agent may use, plus when it must
            escalate. Internal publication alone does not enable agent use.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Format</FieldLabel>
                <Select
                  value={articleType}
                  onValueChange={(value) =>
                    setArticleType(value as KnowledgeArticleType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="faq">Common question / FAQ</SelectItem>
                      <SelectItem value="policy">Policy</SelectItem>
                      <SelectItem value="sop">SOP</SelectItem>
                      <SelectItem value="guide">Guide</SelectItem>
                      <SelectItem value="template">Template</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Audience</FieldLabel>
                <Select
                  value={audience}
                  onValueChange={(value) =>
                    setAudience(value as KnowledgeAudience)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="internal">Internal only</SelectItem>
                      <SelectItem value="client_safe">
                        Client-safe candidate
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Client-safe candidates still require a publisher’s approval.
                </FieldDescription>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="canonical-question">
                Common client question
              </FieldLabel>
              <Input
                id="canonical-question"
                value={canonicalQuestion}
                onChange={(event) => setCanonicalQuestion(event.target.value)}
                placeholder="How do OTA markups work?"
              />
              <FieldDescription>
                Use the wording clients naturally use. Search matches this
                question as well as the article.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="approved-answer">
                Approved short answer
              </FieldLabel>
              <Textarea
                id="approved-answer"
                value={approvedAnswer}
                onChange={(event) => setApprovedAnswer(event.target.value)}
                placeholder="Write the concise client-ready answer. Keep assumptions and exceptions explicit."
                rows={5}
              />
              <FieldDescription>
                Required before the article can be enabled for Agent Studio.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="escalation-guidance">
                Escalate when
              </FieldLabel>
              <Textarea
                id="escalation-guidance"
                value={escalationGuidance}
                onChange={(event) =>
                  setEscalationGuidance(event.target.value)
                }
                placeholder="Example: the client disputes a contract term, requests a fee change, or the OTA/PMS configuration is unclear."
                rows={3}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="source-notes">
                  Source or verification notes
                </FieldLabel>
                <Textarea
                  id="source-notes"
                  value={sourceNotes}
                  onChange={(event) => setSourceNotes(event.target.value)}
                  placeholder="Where did this policy come from?"
                  rows={3}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="review-due-at">Review due</FieldLabel>
                <Input
                  id="review-due-at"
                  type="date"
                  value={reviewDueAt}
                  onChange={(event) => setReviewDueAt(event.target.value)}
                />
                <FieldDescription>
                  Use for pricing rules or policies that may change.
                </FieldDescription>
              </Field>
            </div>

            {article?.agent_enabled && (
              <FieldDescription>
                Saving changes disables this answer in Agent Studio until a
                publisher reviews and approves it again.
              </FieldDescription>
            )}
          </FieldGroup>
        </CardContent>
      </Card>

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
