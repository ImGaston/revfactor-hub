"use client"

import { useOptimistic, useTransition } from "react"
import { ChevronUp, MessageSquare, Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { toggleUpvote } from "./actions"
import { cn } from "@/lib/utils"
import type { Post, Board } from "@/lib/types"

const STATUS_STYLES: Record<string, { text: string; bg: string }> = {
  backlog: { text: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30" },
  next: { text: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30" },
  in_progress: {
    text: "text-yellow-700",
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
  },
  limited_release: {
    text: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
  },
  completed: {
    text: "text-green-600",
    bg: "bg-green-50 dark:bg-green-950/30",
  },
}

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  next: "Next",
  in_progress: "In Progress",
  limited_release: "Limited Release",
  completed: "Completed",
}

function formatCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

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
  post: Post
  boards: Board[]
  onClick: () => void
}

export function IdeasCard({ post, boards, onClick }: Props) {
  const [, startTransition] = useTransition()
  const [optimistic, applyOptimistic] = useOptimistic(
    {
      upvote_count: post.upvote_count ?? 0,
      has_upvoted: post.has_upvoted ?? false,
    },
    (state, _action: "toggle") => ({
      upvote_count: state.has_upvoted
        ? state.upvote_count - 1
        : state.upvote_count + 1,
      has_upvoted: !state.has_upvoted,
    })
  )

  const statusStyle = STATUS_STYLES[post.status] ?? STATUS_STYLES.backlog
  const board = boards.find((b) => b.id === post.board_id)
  const postTags = post.post_tags?.map((pt) => pt.tags) ?? []

  function handleUpvote(e: React.MouseEvent) {
    e.stopPropagation()
    startTransition(async () => {
      applyOptimistic("toggle")
      await toggleUpvote(post.id)
    })
  }

  return (
    <div
      className="flex gap-3 rounded-lg border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:bg-accent/20 cursor-pointer"
      onClick={onClick}
    >
      {/* Upvote button */}
      <button
        onClick={handleUpvote}
        className={cn(
          "flex flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0 h-fit",
          optimistic.has_upvoted
            ? "border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-700 dark:bg-blue-950/30"
            : "hover:bg-accent"
        )}
      >
        <ChevronUp className="size-4" />
        {formatCompact(optimistic.upvote_count)}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Status badge */}
        <Badge
          variant="secondary"
          className={cn(
            "text-[10px] font-medium",
            statusStyle.text,
            statusStyle.bg
          )}
        >
          {STATUS_LABELS[post.status] ?? post.status}
        </Badge>

        {/* Title */}
        <p className="font-medium leading-tight">{post.title}</p>

        {/* Description snippet */}
        {post.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {post.description}
          </p>
        )}

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {board && (
            <Badge variant="secondary" className="text-[10px] font-normal">
              {board.icon} {board.name}
            </Badge>
          )}
          <span className="text-[11px] text-muted-foreground">
            {relativeTime(post.created_at)}
          </span>
          {(post.comment_count ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
              <MessageSquare className="size-3" />
              {post.comment_count}
            </span>
          )}
          {post.eta && (
            <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
              <Calendar className="size-3" />
              {new Date(post.eta).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
          {postTags.map((t) => (
            <span
              key={t.id}
              className="flex items-center gap-1 text-[11px] text-muted-foreground"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              {t.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
