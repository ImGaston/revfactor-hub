"use client"

import { useCallback } from "react"
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd"
import { Plus } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type KanbanColumn<T> = {
  id: string
  label: string
  color?: string
  bgColor?: string
  darkBgColor?: string
  items: T[]
}

type KanbanBoardProps<T extends { id: string }> = {
  columns: KanbanColumn<T>[]
  onMove: (itemId: string, fromColumn: string, toColumn: string, newIndex: number) => void
  onReorder: (itemId: string, column: string, newIndex: number) => void
  renderCard: (item: T, columnId: string) => React.ReactNode
  onAdd?: (columnId: string) => void
  columnIds: string[]
  renderColumnFooter?: (columnId: string) => React.ReactNode
}

export function KanbanBoard<T extends { id: string }>({
  columns,
  onMove,
  onReorder,
  renderCard,
  onAdd,
  columnIds,
  renderColumnFooter,
}: KanbanBoardProps<T>) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { source, destination, draggableId } = result
      if (!destination) return
      if (
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      )
        return

      if (source.droppableId !== destination.droppableId) {
        onMove(draggableId, source.droppableId, destination.droppableId, destination.index)
      } else {
        onReorder(draggableId, source.droppableId, destination.index)
      }
    },
    [onMove, onReorder]
  )

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columnIds.map((colId) => {
          const col = columns.find((c) => c.id === colId)
          if (!col) return null
          return (
            <div
              key={col.id}
              className="flex w-72 shrink-0 flex-col rounded-lg border"
              style={{ backgroundColor: (isDark ? col.darkBgColor : col.bgColor) ?? "hsl(var(--muted) / 0.3)" }}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{col.label}</h3>
                  <Badge
                    variant="secondary"
                    className="text-[10px] rounded-full px-1.5 min-w-5 justify-center"
                    style={col.items.length > 0 ? { backgroundColor: col.color, color: "white" } : undefined}
                  >
                    {col.items.length}
                  </Badge>
                </div>
                {onAdd && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => onAdd(col.id)}
                  >
                    <Plus className="size-4" />
                  </Button>
                )}
              </div>
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div className="flex-1 overflow-y-auto overflow-x-hidden">
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        "min-h-[200px] w-full space-y-2 px-2 pb-2",
                        snapshot.isDraggingOver && "bg-accent/30 rounded-b-lg"
                      )}
                    >
                      {col.items.map((item, index) => (
                        <Draggable
                          key={item.id}
                          draggableId={item.id}
                          index={index}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={cn(
                                "w-full min-w-0",
                                snapshot.isDragging && "opacity-90 shadow-lg"
                              )}
                            >
                              {renderCard(item, colId)}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {col.items.length === 0 && !snapshot.isDraggingOver && (
                        <p className="text-center text-xs text-muted-foreground pt-16">
                          No items
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </Droppable>
              {renderColumnFooter?.(col.id)}
            </div>
          )
        })}
      </div>
    </DragDropContext>
  )
}
