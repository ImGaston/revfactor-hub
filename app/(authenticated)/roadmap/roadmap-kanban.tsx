"use client"

import { useState, useCallback, useOptimistic, useTransition } from "react"
import { MessageSquare, ChevronUp, Calendar, Plus } from "lucide-react"
import {
  KanbanBoard,
  type KanbanColumn,
} from "@/components/kanban/kanban-board"
import { KanbanCard } from "@/components/kanban/kanban-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PostFormDialog } from "./post-form-dialog"
import { PostDetailDialog } from "./post-detail-dialog"
import { updatePostStatus } from "./actions"
import type { Post, Board, RoadmapProject, Tag } from "@/lib/types"

const COLUMNS = [
  {
    id: "backlog",
    label: "Backlog",
    color: "#E8394D",
    bgColor: "hsl(0 80% 97%)",
    darkBgColor: "hsl(0 25% 13%)",
  },
  {
    id: "next",
    label: "Next",
    color: "#F59E0B",
    bgColor: "hsl(40 100% 97%)",
    darkBgColor: "hsl(40 30% 12%)",
  },
  {
    id: "in_progress",
    label: "In Progress",
    color: "#D97706",
    bgColor: "hsl(48 100% 97%)",
    darkBgColor: "hsl(48 30% 12%)",
  },
  {
    id: "limited_release",
    label: "Limited Release",
    color: "#10B981",
    bgColor: "hsl(160 60% 97%)",
    darkBgColor: "hsl(160 20% 12%)",
  },
  {
    id: "completed",
    label: "Completed",
    color: "#22C55E",
    bgColor: "hsl(142 76% 96%)",
    darkBgColor: "hsl(142 20% 12%)",
  },
]

const COLUMN_IDS = COLUMNS.map((c) => c.id)

type Props = {
  posts: Post[]
  projects: RoadmapProject[]
  boards: Board[]
  tags: Tag[]
  selectedProjectId: string
  onSelectedProjectChange: (projectId: string) => void
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

export function RoadmapKanban({
  posts: initialPosts,
  projects,
  boards,
  tags,
  selectedProjectId,
  onSelectedProjectChange,
}: Props) {
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

  const visiblePosts =
    selectedProjectId === "all"
      ? optimisticPosts
      : optimisticPosts.filter((post) => post.project_id === selectedProjectId)
  const columns = buildColumns(visiblePosts)
  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId
  )

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

  function formatDeadline(deadline: string | null) {
    if (!deadline) return null
    const d = new Date(`${deadline}T00:00:00`)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedProjectId}
            onValueChange={onSelectedProjectChange}
          >
            <SelectTrigger
              className="w-64"
              aria-label="Filter tasks by project"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Badge variant="secondary">{visiblePosts.length} tasks</Badge>
          {selectedProject?.deadline && (
            <span className="text-xs text-muted-foreground">
              Project due {formatDeadline(selectedProject.deadline)}
            </span>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => handleAdd("backlog")}
          disabled={projects.length === 0}
        >
          <Plus data-icon="inline-start" />
          New task
        </Button>
      </div>
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
              accentColor={COLUMNS.find((c) => c.id === columnId)?.color}
              badges={[
                ...(item.roadmap_projects
                  ? [
                      {
                        label: item.roadmap_projects.name,
                        variant: "default" as const,
                      },
                    ]
                  : []),
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
                ...(item.deadline
                  ? [
                      {
                        icon: <Calendar className="size-3" />,
                        label: `Due ${formatDeadline(item.deadline)!}`,
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
        defaultProjectId={
          selectedProjectId === "all" ? projects[0]?.id : selectedProjectId
        }
        projects={projects}
        boards={boards}
        tags={tags}
      />
      {detailPost && (
        <PostDetailDialog
          key={detailPost.id}
          post={detailPost}
          projects={projects}
          boards={boards}
          open={!!detailPost}
          onOpenChange={(open) => {
            if (!open) setDetailPost(null)
          }}
        />
      )}
    </div>
  )
}
