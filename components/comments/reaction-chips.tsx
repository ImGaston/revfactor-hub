"use client"

import type { CommentReaction } from "@/lib/types"

// Aggregated reaction chips under a comment. Clicking a chip toggles the
// current user's reaction with that emoji.
export function ReactionChips({
  reactions,
  currentUserId,
  onToggle,
}: {
  reactions: CommentReaction[]
  currentUserId: string | null
  onToggle: (emoji: string) => void
}) {
  if (reactions.length === 0) return null

  const byEmoji = new Map<string, { count: number; mine: boolean }>()
  for (const r of reactions) {
    const entry = byEmoji.get(r.emoji) ?? { count: 0, mine: false }
    entry.count += 1
    if (r.user_id === currentUserId) entry.mine = true
    byEmoji.set(r.emoji, entry)
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {[...byEmoji.entries()].map(([emoji, { count, mine }]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
            mine
              ? "border-primary/40 bg-primary/10"
              : "bg-muted/50 hover:bg-accent"
          }`}
          title={mine ? "Remove your reaction" : "React too"}
        >
          <span className="text-sm leading-none">{emoji}</span>
          <span className="text-muted-foreground">{count}</span>
        </button>
      ))}
    </div>
  )
}
