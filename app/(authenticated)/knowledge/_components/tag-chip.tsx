"use client"

import { cn } from "@/lib/utils"
import { TAG_COLORS } from "../_lib/colors"
import type { KnowledgeTag } from "../_lib/types"

type TagChipProps = {
  tag: KnowledgeTag
  selected?: boolean
  onClick?: () => void
  size?: "sm" | "default"
}

export function TagChip({
  tag,
  selected = false,
  onClick,
  size = "default",
}: TagChipProps) {
  const colorClass = TAG_COLORS[tag.color] ?? TAG_COLORS.blue
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full font-medium transition-all",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-xs",
        selected
          ? colorClass
          : "bg-muted text-muted-foreground hover:bg-muted/80",
        onClick && "cursor-pointer"
      )}
    >
      {tag.name}
    </button>
  )
}
