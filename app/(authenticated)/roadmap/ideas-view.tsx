"use client"

import { useState, useMemo } from "react"
import { IdeasToolbar, type SortMode, type ActiveFilters } from "./ideas-toolbar"
import { IdeasCard } from "./ideas-card"
import { PostFormDialog } from "./post-form-dialog"
import { PostDetailDialog } from "./post-detail-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Post, Board, Tag } from "@/lib/types"

const PAGE_SIZE = 20

type Props = {
  posts: Post[]
  boards: Board[]
  tags: Tag[]
}

export function IdeasView({ posts, boards, tags }: Props) {
  const [sort, setSort] = useState<SortMode>("new")
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState<ActiveFilters>({})
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [detailPost, setDetailPost] = useState<Post | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const filteredPosts = useMemo(() => {
    let result = posts

    // Search
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q)
      )
    }

    // Board filter (from sidebar or filter bar)
    const boardFilter = selectedBoard ?? filters.board_id
    if (boardFilter) {
      result = result.filter((p) => p.board_id === boardFilter)
    }

    // Status filter
    if (filters.status) {
      result = result.filter((p) => p.status === filters.status)
    }

    // Tag filter
    if (filters.tag_id) {
      result = result.filter((p) =>
        p.post_tags?.some((pt) => pt.tags.id === filters.tag_id)
      )
    }

    // Sort
    if (sort === "top") {
      result = [...result].sort(
        (a, b) => (b.upvote_count ?? 0) - (a.upvote_count ?? 0)
      )
    } else if (sort === "new") {
      result = [...result].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    } else if (sort === "trending") {
      const now = Date.now()
      result = [...result].sort((a, b) => {
        const ageA = Math.max(1, (now - new Date(a.created_at).getTime()) / 86400000)
        const ageB = Math.max(1, (now - new Date(b.created_at).getTime()) / 86400000)
        return (b.upvote_count ?? 0) / ageB - (a.upvote_count ?? 0) / ageA
      })
    }

    return result
  }, [posts, search, sort, selectedBoard, filters])

  const visiblePosts = filteredPosts.slice(0, visibleCount)
  const hasMore = visibleCount < filteredPosts.length

  // Count posts per board
  const boardCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of posts) {
      if (p.board_id) {
        counts.set(p.board_id, (counts.get(p.board_id) ?? 0) + 1)
      }
    }
    return counts
  }, [posts])

  function clearFilter(key: keyof ActiveFilters) {
    setFilters((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const activeFilterEntries = Object.entries(filters).filter(
    ([, v]) => v != null
  )

  return (
    <div className="flex gap-6">
      {/* Main feed */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Motivational banner */}
        <button
          onClick={() => setFormOpen(true)}
          className="w-full rounded-lg border bg-gradient-to-r from-rose-50 to-orange-50 dark:from-rose-950/20 dark:to-orange-950/20 p-4 text-left transition-colors hover:from-rose-100 hover:to-orange-100 dark:hover:from-rose-950/30 dark:hover:to-orange-950/30"
        >
          <p className="font-semibold">Have something to say?</p>
          <p className="text-sm text-muted-foreground">
            Tell RevFactor how we could make the product more useful to you.
          </p>
        </button>

        <IdeasToolbar
          sort={sort}
          onSortChange={setSort}
          search={search}
          onSearchChange={setSearch}
          filters={filters}
          onFiltersChange={setFilters}
          boards={boards}
          tags={tags}
          onCreatePost={() => setFormOpen(true)}
        />

        {/* Active filter chips */}
        {activeFilterEntries.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {filters.status && (
              <Badge
                variant="secondary"
                className="gap-1 cursor-pointer"
                onClick={() => clearFilter("status")}
              >
                Status: {filters.status}
                <span className="ml-1">&times;</span>
              </Badge>
            )}
            {filters.board_id && (
              <Badge
                variant="secondary"
                className="gap-1 cursor-pointer"
                onClick={() => clearFilter("board_id")}
              >
                Board:{" "}
                {boards.find((b) => b.id === filters.board_id)?.name ?? "—"}
                <span className="ml-1">&times;</span>
              </Badge>
            )}
            {filters.tag_id && (
              <Badge
                variant="secondary"
                className="gap-1 cursor-pointer"
                onClick={() => clearFilter("tag_id")}
              >
                Tag: {tags.find((t) => t.id === filters.tag_id)?.name ?? "—"}
                <span className="ml-1">&times;</span>
              </Badge>
            )}
          </div>
        )}

        {/* Post list */}
        <div className="space-y-3">
          {visiblePosts.map((post) => (
            <IdeasCard
              key={post.id}
              post={post}
              boards={boards}
              onClick={() => setDetailPost(post)}
            />
          ))}
          {visiblePosts.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No ideas found.
            </p>
          )}
        </div>

        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            >
              Load more
            </Button>
          </div>
        )}
      </div>

      {/* Boards sidebar (desktop only) */}
      <div className="hidden lg:block w-56 shrink-0 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2">
          Boards
        </p>
        <button
          onClick={() => setSelectedBoard(null)}
          className={cn(
            "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
            !selectedBoard && "bg-accent font-medium"
          )}
        >
          <span>View all posts</span>
          <span className="text-xs text-muted-foreground">{posts.length}</span>
        </button>
        {boards.map((board) => (
          <button
            key={board.id}
            onClick={() =>
              setSelectedBoard(
                selectedBoard === board.id ? null : board.id
              )
            }
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
              selectedBoard === board.id && "bg-accent font-medium"
            )}
          >
            <span>
              {board.icon} {board.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {boardCounts.get(board.id) ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Dialogs */}
      <PostFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultStatus="backlog"
        boards={boards}
        tags={tags}
      />
      {detailPost && (
        <PostDetailDialog
          post={detailPost}
          boards={boards}
          tags={tags}
          open={!!detailPost}
          onOpenChange={(open) => {
            if (!open) setDetailPost(null)
          }}
        />
      )}
    </div>
  )
}
