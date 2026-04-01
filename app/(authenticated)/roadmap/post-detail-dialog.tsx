"use client"

import { useState, useEffect, useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronUp,
  Calendar,
  Trash2,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { CommentThread } from "./comment-thread"
import { CommentForm } from "./comment-form"
import { toggleUpvote, updatePost, deletePost } from "./actions"
import { createClient } from "@/lib/supabase/client"
import Markdown from "react-markdown"
import { cn } from "@/lib/utils"
import type { Post, Board, Tag, Comment as CommentType } from "@/lib/types"

const STATUS_OPTIONS = [
  { value: "backlog", label: "Backlog", color: "#E8394D" },
  { value: "next", label: "Next", color: "#F59E0B" },
  { value: "in_progress", label: "In Progress", color: "#D97706" },
  { value: "limited_release", label: "Limited Release", color: "#10B981" },
  { value: "completed", label: "Completed", color: "#22C55E" },
]

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
  tags: Tag[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PostDetailDialog({
  post,
  boards,
  tags,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter()
  const [comments, setComments] = useState<CommentType[]>([])
  const [loadingComments, setLoadingComments] = useState(true)
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

  // Fetch comments on open
  useEffect(() => {
    if (!open) return
    setLoadingComments(true)
    const supabase = createClient()

    async function fetchComments() {
      const { data } = await supabase
        .from("comments")
        .select(
          "*, profiles:author_id(full_name, avatar_url, email)"
        )
        .eq("post_id", post.id)
        .order("created_at", { ascending: true })

      setComments((data ?? []) as CommentType[])
      setLoadingComments(false)
    }

    fetchComments()
  }, [open, post.id])

  // Build threaded comments
  const rootComments = comments.filter((c) => !c.parent_comment_id)
  const repliesMap = new Map<string, CommentType[]>()
  for (const c of comments) {
    if (c.parent_comment_id) {
      const arr = repliesMap.get(c.parent_comment_id) ?? []
      arr.push(c)
      repliesMap.set(c.parent_comment_id, arr)
    }
  }

  function handleUpvote() {
    startTransition(async () => {
      applyOptimistic("toggle")
      await toggleUpvote(post.id)
    })
  }

  async function handleStatusChange(newStatus: string) {
    await updatePost(post.id, { status: newStatus })
    router.refresh()
  }

  async function handleDelete() {
    await deletePost(post.id)
    onOpenChange(false)
    router.refresh()
  }

  function handleCommentAdded() {
    const supabase = createClient()
    supabase
      .from("comments")
      .select("*, profiles:author_id(full_name, avatar_url, email)")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setComments((data ?? []) as CommentType[])
      })
  }

  const postTags = post.post_tags?.map((pt) => pt.tags) ?? []
  const board = boards.find((b) => b.id === post.board_id)

  const metadataSidebar = (
    <>
      {/* Upvote */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Upvotes
        </p>
        <button
          onClick={handleUpvote}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors w-full justify-center",
            optimistic.has_upvoted
              ? "border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-700 dark:bg-blue-950/30"
              : "hover:bg-accent"
          )}
        >
          <ChevronUp className="size-4" />
          {formatCompact(optimistic.upvote_count)}
        </button>
      </div>

      <Separator />

      {/* Status */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Status
        </p>
        <Select
          value={post.status}
          onValueChange={handleStatusChange}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Board */}
      {board && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Board
          </p>
          <Badge variant="secondary" className="text-xs">
            {board.icon} {board.name}
          </Badge>
        </div>
      )}

      {/* Tags */}
      {postTags.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Tags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {postTags.map((t) => (
              <span
                key={t.id}
                className="flex items-center gap-1 text-xs"
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
      )}

      {/* ETA */}
      {post.eta && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            ETA
          </p>
          <span className="flex items-center gap-1 text-xs">
            <Calendar className="size-3" />
            {new Date(post.eta).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      )}

      {/* Date */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Created
        </p>
        <span className="text-xs text-muted-foreground">
          {relativeTime(post.created_at)}
        </span>
      </div>

      <Separator />

      {/* Delete */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:text-destructive gap-1.5"
          >
            <Trash2 className="size-3.5" />
            Delete post
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. All comments and upvotes
              will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-4xl !w-[calc(100%-2rem)] sm:!w-full sm:!max-w-4xl !p-0 !gap-0 !h-[90vh] sm:!h-auto sm:!max-h-[85vh] !rounded-2xl sm:!rounded-4xl">
        {/* Mobile: single column scrollable */}
        <div className="flex flex-col sm:hidden h-full overflow-y-auto">
          {/* Title */}
          <div className="p-5 pb-0">
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold leading-tight pr-8">
                {post.title}
              </DialogTitle>
            </DialogHeader>
          </div>

          {/* Description */}
          <div className="px-5 pt-3">
            {post.description ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{post.description}</Markdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description provided.
              </p>
            )}
          </div>

          {/* Metadata section inline */}
          <div className="px-5 pt-4 space-y-3">
            {metadataSidebar}
          </div>

          <div className="px-5 pt-4">
            <Separator />
          </div>

          {/* Comments */}
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Comments</h3>
              <Badge variant="secondary" className="text-[10px]">
                {comments.length}
              </Badge>
            </div>

            <CommentForm
              postId={post.id}
              onCommentAdded={handleCommentAdded}
            />

            {loadingComments ? (
              <p className="text-sm text-muted-foreground">
                Loading comments...
              </p>
            ) : rootComments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No comments yet. Be the first!
              </p>
            ) : (
              <div className="space-y-3">
                {rootComments.map((comment) => (
                  <CommentThread
                    key={comment.id}
                    comment={comment}
                    replies={repliesMap.get(comment.id) ?? []}
                    postId={post.id}
                    onCommentAdded={handleCommentAdded}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Desktop: two-panel layout */}
        <div className="hidden sm:flex h-full max-h-[85vh]">
          {/* Left panel — content */}
          <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold leading-tight pr-8">
                {post.title}
              </DialogTitle>
            </DialogHeader>

            {/* Description */}
            {post.description ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{post.description}</Markdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description provided.
              </p>
            )}

            <Separator />

            {/* Comments section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Comments</h3>
                <Badge variant="secondary" className="text-[10px]">
                  {comments.length}
                </Badge>
              </div>

              <CommentForm
                postId={post.id}
                onCommentAdded={handleCommentAdded}
              />

              {loadingComments ? (
                <p className="text-sm text-muted-foreground">
                  Loading comments...
                </p>
              ) : rootComments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No comments yet. Be the first!
                </p>
              ) : (
                <div className="space-y-3">
                  {rootComments.map((comment) => (
                    <CommentThread
                      key={comment.id}
                      comment={comment}
                      replies={repliesMap.get(comment.id) ?? []}
                      postId={post.id}
                      onCommentAdded={handleCommentAdded}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right panel — metadata sidebar */}
          <div className="w-72 shrink-0 border-l bg-muted/30 p-5 space-y-4 overflow-y-auto rounded-r-[inherit]">
            {metadataSidebar}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
