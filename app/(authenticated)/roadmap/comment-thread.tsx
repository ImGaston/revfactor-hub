"use client"

import { useState, useTransition } from "react"
import { ThumbsUp, ThumbsDown, Reply, Trash2 } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { CommentForm } from "./comment-form"
import { toggleCommentReaction, deleteComment } from "./actions"
import { cn } from "@/lib/utils"
import type { Comment } from "@/lib/types"

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days < 1) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(months / 12)
  return `${years}y ago`
}

type Props = {
  comment: Comment
  replies: Comment[]
  postId: string
  onCommentAdded: () => void
  depth?: number
}

export function CommentThread({
  comment,
  replies,
  postId,
  onCommentAdded,
  depth = 0,
}: Props) {
  const [showReply, setShowReply] = useState(false)
  const [, startTransition] = useTransition()

  const profile = comment.profiles
  const displayName =
    profile && !Array.isArray(profile)
      ? profile.full_name ?? profile.email
      : "User"
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  function handleReaction(reaction: "like" | "dislike") {
    startTransition(async () => {
      await toggleCommentReaction(comment.id, reaction)
      onCommentAdded() // re-fetch
    })
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteComment(comment.id)
      onCommentAdded()
    })
  }

  return (
    <div className={cn("space-y-2", depth > 0 && "ml-6 pl-3 border-l")}>
      <div className="space-y-1">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Avatar className="size-6">
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
          <span className="text-xs font-medium">{displayName}</span>
          <span className="text-[10px] text-muted-foreground">
            {relativeTime(comment.created_at)}
          </span>
        </div>

        {/* Content */}
        <p className="text-sm whitespace-pre-wrap pl-8">{comment.content}</p>

        {/* Actions */}
        <div className="flex items-center gap-1 pl-8">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] gap-0.5"
            onClick={() => handleReaction("like")}
          >
            <ThumbsUp className="size-3" />
            {comment.like_count ? comment.like_count : ""}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] gap-0.5"
            onClick={() => handleReaction("dislike")}
          >
            <ThumbsDown className="size-3" />
            {comment.dislike_count ? comment.dislike_count : ""}
          </Button>
          {depth === 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px] gap-0.5"
              onClick={() => setShowReply(!showReply)}
            >
              <Reply className="size-3" />
              Reply
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] gap-0.5 text-destructive hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {/* Reply form */}
      {showReply && (
        <div className="ml-8">
          <CommentForm
            postId={postId}
            parentCommentId={comment.id}
            onCommentAdded={() => {
              setShowReply(false)
              onCommentAdded()
            }}
            compact
          />
        </div>
      )}

      {/* Nested replies */}
      {replies.map((reply) => (
        <CommentThread
          key={reply.id}
          comment={reply}
          replies={[]}
          postId={postId}
          onCommentAdded={onCommentAdded}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}
