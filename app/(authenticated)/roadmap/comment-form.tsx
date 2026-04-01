"use client"

import { useState, useTransition } from "react"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { createComment } from "./actions"

type Props = {
  postId: string
  parentCommentId?: string
  onCommentAdded: () => void
  compact?: boolean
}

export function CommentForm({
  postId,
  parentCommentId,
  onCommentAdded,
  compact,
}: Props) {
  const [content, setContent] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!content.trim()) return
    startTransition(async () => {
      const result = await createComment(postId, content, parentCommentId)
      if (result.success) {
        setContent("")
        onCommentAdded()
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex gap-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={compact ? "Write a reply..." : "Write a comment..."}
        rows={compact ? 1 : 2}
        className="resize-none text-sm"
      />
      <Button
        size="icon"
        variant="ghost"
        className="shrink-0 self-end"
        onClick={handleSubmit}
        disabled={isPending || !content.trim()}
      >
        <Send className="size-4" />
      </Button>
    </div>
  )
}
