"use client"

import { useEffect, useState, useTransition } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  createOnboardingComment,
  deleteOnboardingComment,
  listOnboardingComments,
} from "./actions"
import type { OnboardingComment } from "@/lib/types"

type Props = {
  clientId: string
  currentUserId: string | null
  onCountChange?: (count: number) => void
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function OnboardingComments({ clientId, currentUserId, onCountChange }: Props) {
  const [comments, setComments] = useState<OnboardingComment[]>([])
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [, startTransition] = useTransition()
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    const { comments } = await listOnboardingComments(clientId)
    const rows = comments as OnboardingComment[]
    setComments(rows)
    setLoading(false)
    onCountChange?.(rows.length)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setSubmitting(true)
    const result = await createOnboardingComment(clientId, content)
    setSubmitting(false)
    if (!result.error) {
      setContent("")
      refresh()
    }
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteOnboardingComment(id)
      setComments((prev) => {
        const next = prev.filter((c) => c.id !== id)
        onCountChange?.(next.length)
        return next
      })
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        ) : (
          comments.map((c) => {
            const name = c.profiles?.full_name || c.profiles?.email || "Unknown"
            const canDelete = currentUserId === c.author_id
            return (
              <div key={c.id} className="flex gap-2">
                <Avatar className="size-7 shrink-0">
                  {c.profiles?.avatar_url && (
                    <AvatarImage src={c.profiles.avatar_url} alt={name} />
                  )}
                  <AvatarFallback className="text-[10px]">
                    {initials(name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 rounded-md border bg-muted/30 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-xs font-medium truncate">{name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatTime(c.created_at)}
                      </span>
                    </div>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap break-words">
                    {c.content}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add a comment..."
          rows={2}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={submitting || !content.trim()}
          >
            {submitting ? "Posting..." : "Post"}
          </Button>
        </div>
      </form>
    </div>
  )
}
