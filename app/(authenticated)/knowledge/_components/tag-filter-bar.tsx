"use client"

import { cn } from "@/lib/utils"
import { TagChip } from "./tag-chip"
import type { KnowledgeTag } from "../_lib/types"

type TagFilterBarProps = {
  tags: KnowledgeTag[]
  selectedTagIds: string[]
  onToggle: (tagId: string) => void
}

export function TagFilterBar({
  tags,
  selectedTagIds,
  onToggle,
}: TagFilterBarProps) {
  const allSelected = selectedTagIds.length === 0

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <button
        type="button"
        onClick={() => {
          // Clear all selections → "All"
          for (const id of selectedTagIds) onToggle(id)
        }}
        className={cn(
          "inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium transition-all",
          allSelected
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        )}
      >
        All
      </button>
      {tags.map((tag) => (
        <TagChip
          key={tag.id}
          tag={tag}
          selected={selectedTagIds.includes(tag.id)}
          onClick={() => onToggle(tag.id)}
        />
      ))}
    </div>
  )
}
