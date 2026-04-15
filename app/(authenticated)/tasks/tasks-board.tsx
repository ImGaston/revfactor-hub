"use client"

import { useState, useCallback, useOptimistic, useTransition } from "react"
import { User, Calendar, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { KanbanBoard, type KanbanColumn } from "@/components/kanban/kanban-board"
import { KanbanCard } from "@/components/kanban/kanban-card"
import { TaskDialog } from "./task-dialog"
import { updateTaskStatus, deleteTask } from "./actions"
import type { Task } from "@/lib/types"
import { resolveProfile } from "@/lib/types"

const COLUMNS = [
  { id: "todo", label: "To Do", color: "#6b7280", bgColor: "hsl(220 14% 96%)", darkBgColor: "hsl(220 10% 14%)" },
  { id: "in_progress", label: "In Progress", color: "#3b82f6", bgColor: "hsl(48 100% 96%)", darkBgColor: "hsl(48 30% 12%)" },
  { id: "waiting", label: "Waiting", color: "#f59e0b", bgColor: "hsl(35 100% 96%)", darkBgColor: "hsl(35 30% 12%)" },
  { id: "done", label: "Done", color: "#22c55e", bgColor: "hsl(142 76% 96%)", darkBgColor: "hsl(142 20% 12%)" },
]

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#6b7280",
}

const COLUMN_IDS = COLUMNS.map((c) => c.id)

export type OwnerOption = { id: string; label: string }

type TasksBoardProps = {
  tasks: Task[]
  clients: { id: string; name: string; listings: { id: string; name: string }[] }[]
  owners: OwnerOption[]
  tags: string[]
}

type OptimisticAction = {
  taskId: string
  newStatus: string
  newIndex: number
}

function buildColumns(tasks: Task[]): KanbanColumn<Task>[] {
  return COLUMNS.map((col) => ({
    ...col,
    items: tasks
      .filter((t) => t.status === col.id)
      .sort((a, b) => a.sort_order - b.sort_order),
  }))
}

export function TasksBoard({ tasks: initialTasks, clients, owners, tags }: TasksBoardProps) {
  const ownerMap = new Map(owners.map((o) => [o.id, o.label]))
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogStatus, setDialogStatus] = useState("todo")
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()

  const [optimisticTasks, applyOptimistic] = useOptimistic(
    initialTasks,
    (state: Task[], action: OptimisticAction) => {
      const task = state.find((t) => t.id === action.taskId)
      if (!task) return state

      // Remove from current position
      const withoutTask = state.filter((t) => t.id !== action.taskId)

      // Get tasks in the target column and insert at the new position
      const targetTasks = withoutTask
        .filter((t) => t.status === action.newStatus)
        .sort((a, b) => a.sort_order - b.sort_order)

      targetTasks.splice(action.newIndex, 0, {
        ...task,
        status: action.newStatus,
      })

      // Re-assign sort_order
      const reordered = targetTasks.map((t, i) => ({ ...t, sort_order: i }))

      // Merge back
      const otherTasks = withoutTask.filter((t) => t.status !== action.newStatus)
      return [...otherTasks, ...reordered]
    }
  )

  const columns = buildColumns(optimisticTasks)

  const handleMove = useCallback(
    (taskId: string, _from: string, to: string, newIndex: number) => {
      startTransition(async () => {
        applyOptimistic({ taskId, newStatus: to, newIndex })
        await updateTaskStatus(taskId, to, newIndex)
      })
    },
    [applyOptimistic]
  )

  const handleReorder = useCallback(
    (taskId: string, column: string, newIndex: number) => {
      startTransition(async () => {
        applyOptimistic({ taskId, newStatus: column, newIndex })
        await updateTaskStatus(taskId, column, newIndex)
      })
    },
    [applyOptimistic]
  )

  function handleClickMove(taskId: string, toColumn: string) {
    const col = columns.find((c) => c.id === toColumn)
    const newIndex = col ? col.items.length : 0
    handleMove(taskId, "", toColumn, newIndex)
  }

  function handleAdd(columnId: string) {
    setEditingTask(null)
    setDialogStatus(columnId)
    setDialogOpen(true)
  }

  function handleEdit(task: Task) {
    setEditingTask(task)
    setDialogStatus(task.status)
    setDialogOpen(true)
  }

  async function handleDelete(taskId: string) {
    await deleteTask(taskId)
    router.refresh()
  }

  return (
    <>
      <KanbanBoard
        columns={columns}
        columnIds={COLUMN_IDS}
        onMove={handleMove}
        onReorder={handleReorder}
        onAdd={handleAdd}
        renderCard={(task, columnId) => {
          const ownerName = resolveProfile(task.profiles)?.full_name || ownerMap.get(task.owner ?? "") || task.owner
          return (
            <KanbanCard
              title={task.title}
              description={task.description}
              subtitle={task.clients?.name}
              accentColor={COLUMNS.find((c) => c.id === columnId)?.color}
              badges={(task.tags ?? []).map((t) => ({
                label: t,
                variant: "secondary" as const,
                color: PRIORITY_COLORS[t.toLowerCase()],
              }))}
              meta={[
                ...(ownerName
                  ? [{ icon: <User className="size-3" />, label: ownerName }]
                  : []),
                ...(task.created_at
                  ? [{ icon: <Calendar className="size-3" />, label: new Date(task.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) }]
                  : []),
              ]}
              columns={COLUMNS}
              currentColumn={columnId}
              onMoveToColumn={(to) => handleClickMove(task.id, to)}
              onClick={() => handleEdit(task)}
              onDelete={() => handleDelete(task.id)}
            />
          )
        }}
      />
      <TaskDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditingTask(null)
        }}
        defaultStatus={dialogStatus}
        clients={clients}
        owners={owners}
        tags={tags}
        task={editingTask}
      />
    </>
  )
}
