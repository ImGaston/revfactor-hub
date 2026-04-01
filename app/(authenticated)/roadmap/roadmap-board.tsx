"use client"

import { useState, useCallback, useOptimistic, useTransition } from "react"
import { User } from "lucide-react"
import { KanbanBoard, type KanbanColumn } from "@/components/kanban/kanban-board"
import { KanbanCard } from "@/components/kanban/kanban-card"
import { RoadmapDialog } from "./roadmap-dialog"
import { updateRoadmapItemStatus } from "./actions"
import type { RoadmapItem } from "@/lib/types"

const COLUMNS = [
  { id: "proposed", label: "Proposed", color: "#a855f7", bgColor: "hsl(270 76% 96%)" },
  { id: "planned", label: "Planned", color: "#6b7280", bgColor: "hsl(220 14% 96%)" },
  { id: "in_progress", label: "In Progress", color: "#3b82f6", bgColor: "hsl(48 100% 96%)" },
  { id: "done", label: "Done", color: "#22c55e", bgColor: "hsl(142 76% 96%)" },
]

const COLUMN_IDS = COLUMNS.map((c) => c.id)

type RoadmapBoardProps = {
  items: RoadmapItem[]
  owners: string[]
  tags: string[]
}

type OptimisticAction = {
  itemId: string
  newStatus: string
  newIndex: number
}

function buildColumns(items: RoadmapItem[]): KanbanColumn<RoadmapItem>[] {
  return COLUMNS.map((col) => ({
    ...col,
    items: items
      .filter((i) => i.status === col.id)
      .sort((a, b) => a.sort_order - b.sort_order),
  }))
}

export function RoadmapBoard({ items: initialItems, owners, tags }: RoadmapBoardProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogStatus, setDialogStatus] = useState("proposed")
  const [, startTransition] = useTransition()

  const [optimisticItems, applyOptimistic] = useOptimistic(
    initialItems,
    (state: RoadmapItem[], action: OptimisticAction) => {
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

      const reordered = targetItems.map((i, idx) => ({ ...i, sort_order: idx }))
      const otherItems = withoutItem.filter((i) => i.status !== action.newStatus)
      return [...otherItems, ...reordered]
    }
  )

  const columns = buildColumns(optimisticItems)

  const handleMove = useCallback(
    (itemId: string, _from: string, to: string, newIndex: number) => {
      startTransition(async () => {
        applyOptimistic({ itemId, newStatus: to, newIndex })
        await updateRoadmapItemStatus(itemId, to, newIndex)
      })
    },
    [applyOptimistic]
  )

  const handleReorder = useCallback(
    (itemId: string, column: string, newIndex: number) => {
      startTransition(async () => {
        applyOptimistic({ itemId, newStatus: column, newIndex })
        await updateRoadmapItemStatus(itemId, column, newIndex)
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
    setDialogStatus(columnId)
    setDialogOpen(true)
  }

  return (
    <>
      <KanbanBoard
        columns={columns}
        columnIds={COLUMN_IDS}
        onMove={handleMove}
        onReorder={handleReorder}
        onAdd={handleAdd}
        renderCard={(item, columnId) => (
          <KanbanCard
            title={item.title}
            description={item.description}
            accentColor={COLUMNS.find((c) => c.id === columnId)?.color}
            badges={[
              ...(item.tag
                ? [{ label: item.tag, variant: "secondary" as const }]
                : []),
            ]}
            meta={[
              ...(item.owner
                ? [{ icon: <User className="size-3" />, label: item.owner }]
                : []),
            ]}
            columns={COLUMNS}
            currentColumn={columnId}
            onMoveToColumn={(to) => handleClickMove(item.id, to)}
          />
        )}
      />
      <RoadmapDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultStatus={dialogStatus}
        owners={owners}
        tags={tags}
      />
    </>
  )
}
