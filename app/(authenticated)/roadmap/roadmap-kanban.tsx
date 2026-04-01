"use client"

import { useState, useCallback, useOptimistic, useTransition } from "react"
import { MessageSquare, ChevronUp, Calendar } from "lucide-react"
import { KanbanBoard, type KanbanColumn } from "@/components/kanban/kanban-board"
import { KanbanCard } from "@/components/kanban/kanban-card"
import { PostFormDialog } from "./post-form-dialog"
import { PostDetailDialog } from "./post-detail-dialog"
import { updatePostStatus } from "./actions"
import type { Post, Board, Tag } from "@/lib/types"

const COLUMNS = [
  { id: "backlog", label: "Backlog", color: "#E8394D", bgColor: "hsl(0 80% 97%)" },
  { id: "next", label: "Next", color: "#F59E0B", bgColor: "hsl(40 100% 97%)" },
  { id: "in_progress", label: "In Progress", color: "#D97706", bgColor: "hsl(48 100% 97%)" },
  { id: "limited_release", label: "Limited Release", color: "#10B981", bgColor: "hsl(160 60% 97%)" },
  { id: "completed", label: "Completed", color: "#22C55E", bgColor: "hsl(142 76% 96%)" },
]

const COLUMN_IDS = COLUMNS.map((c) => c.id)

type Props = {
  posts: Post[]
  boards: Board[]
  tags: Tag[]
}

type OptimisticAction = {
  itemId: string
  newStatus: string
  newIndex: number
}

function buildColumns(items: Post[]): KanbanColumn<Post>[] {
  return COLUMNS.map((col) => ({
    ...col,
    items: items
      .filter((i) => i.status === col.id)
      .sort((a, b) => a.sort_order - b.sort_order),
  }))
}

export function RoadmapKanban({ posts: initialPosts, boards, tags }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [formStatus, setFormStatus] = useState("backlog")
  const [detailPost, setDetailPost] = useState<Post | null>(null)
  const [, startTransition] = useTransition()

  const [optimisticPosts, applyOptimistic] = useOptimistic(
    initialPosts,
    (state: Post[], action: OptimisticAction) => {
      const item = state.find((i) => i.id === action.itemId)
      if (!item) return state

      const withoutItem = state.filter((i) => i.id !== action.itemId)
      const targetItems = withoutItem
        .filter((i) => i.status === action.newStatus)
        .sort((a, b) => a.sort_order - b.sort_order)

      targetItems.splice(action.newIndex, 0, {
        ...item,
        status: action.newStatus,
      })

      const reordered = targetItems.map((i, idx) => ({
        ...i,
        sort_order: idx,
      }))
      const otherItems = withoutItem.filter(
        (i) => i.status !== action.newStatus
      )
      return [...otherItems, ...reordered]
    }
  )

  const columns = buildColumns(optimisticPosts)

  const handleMove = useCallback(
    (itemId: string, _from: string, to: string, newIndex: number) => {
      startTransition(async () => {
        applyOptimistic({ itemId, newStatus: to, newIndex })
        await updatePostStatus(itemId, to, newIndex)
      })
    },
    [applyOptimistic]
  )

  const handleReorder = useCallback(
    (itemId: string, column: string, newIndex: number) => {
      startTransition(async () => {
        applyOptimistic({ itemId, newStatus: column, newIndex })
        await updatePostStatus(itemId, column, newIndex)
      })
    },
    [applyOptimistic]
  )

  function handleClickMove(itemId: string, toColumn: string) {
    const col = columns.find((c) => c.id === toColumn)
    const newIndex = col ? col.items.length : 0
    handleMove(itemId, "", toColumn, newIndex)
  }

  function handleAdd(columnId: string) {
    setFormStatus(columnId)
    setFormOpen(true)
  }

  function formatEta(eta: string | null) {
    if (!eta) return null
    const d = new Date(eta)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <>
      <KanbanBoard
        columns={columns}
        columnIds={COLUMN_IDS}
        onMove={handleMove}
        onReorder={handleReorder}
        onAdd={handleAdd}
        renderCard={(item, columnId) => {
          const postTags = item.post_tags?.map((pt) => pt.tags) ?? []

          return (
            <KanbanCard
              title={item.title}
              description={item.description}
              accentColor={
                COLUMNS.find((c) => c.id === columnId)?.color
              }
              badges={[
                ...(item.boards
                  ? [
                      {
                        label: `${item.boards.icon} ${item.boards.name}`,
                        variant: "secondary" as const,
                      },
                    ]
                  : []),
                ...postTags.map((t) => ({
                  label: t.name,
                  variant: "outline" as const,
                  color: t.color,
                })),
              ]}
              meta={[
                ...(item.eta
                  ? [
                      {
                        icon: <Calendar className="size-3" />,
                        label: formatEta(item.eta)!,
                      },
                    ]
                  : []),
                ...(item.comment_count
                  ? [
                      {
                        icon: <MessageSquare className="size-3" />,
                        label: String(item.comment_count),
                      },
                    ]
                  : []),
                ...(item.upvote_count
                  ? [
                      {
                        icon: <ChevronUp className="size-3" />,
                        label: String(item.upvote_count),
                      },
                    ]
                  : []),
              ]}
              columns={COLUMNS}
              currentColumn={columnId}
              onMoveToColumn={(to) => handleClickMove(item.id, to)}
              onClick={() => setDetailPost(item)}
            />
          )
        }}
      />
      <PostFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultStatus={formStatus}
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
    </>
  )
}
