"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { SquareCheckBig, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { CommentActionBar } from "@/components/comments/comment-action-bar"
import { ReactionChips } from "@/components/comments/reaction-chips"
import {
  createTaskComment,
  createTaskFromTaskComment,
  deleteTaskComment,
  listTaskComments,
  toggleTaskCommentReaction,
} from "./actions"
import type { TaskComment } from "@/lib/types"

type TaskCommentsProps = {
  taskId: string
  currentUserId: string | null
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

export function TaskComments({ taskId, currentUserId }: TaskCommentsProps) {
  const [comments, setComments] = useState<TaskComment[]>([])
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [, startTransition] = useTransition()
  const [submitting, setSubmitting] = useState(false)
  const [replyTarget, setReplyTarget] = useState<string | null>(null)
  const [replyText, setReplyText] = useState("")
  const [postingReply, setPostingReply] = useState(false)

  async function refresh() {
    const { comments } = await listTaskComments(taskId)
    setComments(comments as TaskComment[])
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setSubmitting(true)
    const result = await createTaskComment(taskId, content)
    setSubmitting(false)
    if (!result.error) {
      setContent("")
      refresh()
    }
  }

  async function handleReply(parentId: string) {
    setPostingReply(true)
    const result = await createTaskComment(taskId, replyText, parentId)
    setPostingReply(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    setReplyText("")
    setReplyTarget(null)
    refresh()
  }

  async function handleReact(commentId: string, emoji: string) {
    const result = await toggleTaskCommentReaction(commentId, emoji)
    if (result?.error) toast.error(result.error)
    else refresh()
  }

  async function handleCreateTask(commentId: string) {
    const result = await createTaskFromTaskComment(commentId)
    if (result?.error) {
      toast.error(result.error)
      return
    }
    toast.success("Task created — linked to this comment")
    refresh()
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text)
    toast.success("Copied")
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteTaskComment(id)
      setComments((prev) => prev.filter((c) => c.id !== id))
    })
  }

  const topLevel = comments.filter((c) => !c.parent_id)
  const repliesByParent = new Map<string, TaskComment[]>()
  for (const c of comments) {
    if (!c.parent_id) continue
    const list = repliesByParent.get(c.parent_id) ?? []
    list.push(c)
    repliesByParent.set(c.parent_id, list)
  }

  function renderComment(c: TaskComment, compact = false) {
    const name = c.profiles?.full_name || c.profiles?.email || "Unknown"
    const canDelete = currentUserId === c.author_id
    return (
      <div
        key={c.id}
        className="group/comment relative -mx-2 flex gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/60"
      >
        <CommentActionBar
          onReact={(emoji) => handleReact(c.id, emoji)}
          onReply={
            compact
              ? undefined
              : () => setReplyTarget(replyTarget === c.id ? null : c.id)
          }
          onCreateTask={
            compact || c.linked_task_id ? undefined : () => handleCreateTask(c.id)
          }
          onCopy={() => handleCopy(c.content)}
        />
        <Avatar className={`${compact ? "size-6" : "size-7"} shrink-0`}>
          {c.profiles?.avatar_url && (
            <AvatarImage src={c.profiles.avatar_url} alt={name} />
          )}
          <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
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
          <p className="mt-1 text-sm whitespace-pre-wrap break-words">{c.content}</p>
          {c.linked_task_id && (
            <Link
              href="/tasks"
              className="mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <SquareCheckBig className="size-3" />
              Task created
            </Link>
          )}
          <ReactionChips
            reactions={c.task_comment_reactions ?? []}
            currentUserId={currentUserId}
            onToggle={(emoji) => handleReact(c.id, emoji)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Comments</div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : topLevel.length === 0 ? (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        ) : (
          topLevel.map((c) => {
            const replies = repliesByParent.get(c.id) ?? []
            return (
              <div key={c.id} className="space-y-2">
                {renderComment(c)}
                {(replies.length > 0 || replyTarget === c.id) && (
                  <div className="ml-9 space-y-2 border-l-2 pl-3">
                    {replies.map((r) => renderComment(r, true))}
                    {replyTarget === c.id && (
                      <div className="flex gap-2">
                        <Textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Reply in thread…"
                          rows={2}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={() => handleReply(c.id)}
                          disabled={postingReply || !replyText.trim()}
                          className="self-end"
                        >
                          Post
                        </Button>
                      </div>
                    )}
                  </div>
                )}
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
