"use client"

import { useState } from "react"
import {
  TrendingUp,
  Clock,
  Flame,
  Search,
  SlidersHorizontal,
  Plus,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { Board, Tag } from "@/lib/types"

export type SortMode = "top" | "new" | "trending"

export type ActiveFilters = {
  status?: string
  board_id?: string
  tag_id?: string
}

const SORT_OPTIONS: { id: SortMode; label: string; icon: React.ReactNode }[] = [
  { id: "top", label: "Top", icon: <TrendingUp className="size-3.5" /> },
  { id: "new", label: "New", icon: <Clock className="size-3.5" /> },
  { id: "trending", label: "Trending", icon: <Flame className="size-3.5" /> },
]

const STATUS_OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "next", label: "Next" },
  { value: "in_progress", label: "In Progress" },
  { value: "limited_release", label: "Limited Release" },
  { value: "completed", label: "Completed" },
]

type Props = {
  sort: SortMode
  onSortChange: (sort: SortMode) => void
  search: string
  onSearchChange: (search: string) => void
  filters: ActiveFilters
  onFiltersChange: (filters: ActiveFilters) => void
  boards: Board[]
  tags: Tag[]
  onCreatePost: () => void
}

export function IdeasToolbar({
  sort,
  onSortChange,
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  boards,
  tags,
  onCreatePost,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Sort pills */}
      <div className="flex items-center gap-1 rounded-lg border p-0.5">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onSortChange(opt.id)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              sort === opt.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {searchOpen ? (
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search ideas..."
            className="h-8 pl-8 pr-8 text-sm"
            autoFocus
          />
          <button
            onClick={() => {
              setSearchOpen(false)
              onSearchChange("")
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2"
          >
            <X className="size-3.5 text-muted-foreground" />
          </button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="size-3.5" />
          Search
        </Button>
      )}

      {/* Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 h-8">
            <SlidersHorizontal className="size-3.5" />
            Filter
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground px-1">
              Status
            </p>
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    status:
                      filters.status === s.value ? undefined : s.value,
                  })
                }
                className={cn(
                  "flex w-full items-center rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent",
                  filters.status === s.value && "bg-accent font-medium"
                )}
              >
                {s.label}
              </button>
            ))}

            <div className="border-t my-1" />

            <p className="text-xs font-medium text-muted-foreground px-1">
              Board
            </p>
            {boards.map((b) => (
              <button
                key={b.id}
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    board_id:
                      filters.board_id === b.id ? undefined : b.id,
                  })
                }
                className={cn(
                  "flex w-full items-center rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent",
                  filters.board_id === b.id && "bg-accent font-medium"
                )}
              >
                {b.icon} {b.name}
              </button>
            ))}

            <div className="border-t my-1" />

            <p className="text-xs font-medium text-muted-foreground px-1">
              Tag
            </p>
            {tags.map((t) => (
              <button
                key={t.id}
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    tag_id:
                      filters.tag_id === t.id ? undefined : t.id,
                  })
                }
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent",
                  filters.tag_id === t.id && "bg-accent font-medium"
                )}
              >
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                {t.name}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Create button */}
      <Button
        size="sm"
        className="gap-1.5 h-8 bg-rose-500 hover:bg-rose-600"
        onClick={onCreatePost}
      >
        <Plus className="size-3.5" />
        Create Post
      </Button>
    </div>
  )
}
