"use client"

import { useState, useCallback, useMemo, useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Calendar, Users, Mail, ChevronRight, ChevronDown, Archive, CheckCircle2, RotateCcw } from "lucide-react"
import { KanbanBoard, type KanbanColumn } from "@/components/kanban/kanban-board"
import { KanbanCard } from "@/components/kanban/kanban-card"
import { LeadFormDialog } from "./lead-form-dialog"
import { updateLeadStage, archiveLead, completeLead, unarchiveLead, uncompleteLead } from "./actions"
import type { Lead, LeadTag } from "@/lib/types"
import { cn } from "@/lib/utils"

export const STAGE_COLUMNS = [
  // Active Pipeline
  { id: "inquiry", label: "Inquiry", color: "#818cf8", bgColor: "hsl(235 85% 97%)", darkBgColor: "hsl(235 25% 14%)" },
  { id: "follow_up", label: "Follow-up", color: "#60a5fa", bgColor: "hsl(217 91% 97%)", darkBgColor: "hsl(217 25% 14%)" },
  { id: "audit", label: "Audit", color: "#38bdf8", bgColor: "hsl(199 89% 97%)", darkBgColor: "hsl(199 25% 14%)" },
  { id: "meeting", label: "Meeting", color: "#2dd4bf", bgColor: "hsl(172 66% 97%)", darkBgColor: "hsl(172 20% 13%)" },
  // Closing
  { id: "proposal_sent", label: "Proposal Sent", color: "#f59e0b", bgColor: "hsl(38 92% 97%)", darkBgColor: "hsl(38 30% 12%)" },
  { id: "proposal_signed", label: "Proposal Signed", color: "#f97316", bgColor: "hsl(25 95% 97%)", darkBgColor: "hsl(25 30% 12%)" },
  { id: "retainer_paid", label: "Retainer Paid", color: "#22c55e", bgColor: "hsl(142 71% 97%)", darkBgColor: "hsl(142 20% 12%)" },
  // Post-Sale
  { id: "planning", label: "Planning", color: "#a78bfa", bgColor: "hsl(257 90% 97%)", darkBgColor: "hsl(257 25% 14%)" },
]

const COLUMN_IDS = STAGE_COLUMNS.map((c) => c.id)

type ProfileOption = {
  id: string
  full_name: string | null
  email: string
  avatar_url: string | null
}

type Props = {
  leads: Lead[]
  tags: LeadTag[]
  profiles: ProfileOption[]
}

type OptimisticAction =
  | { type: "move"; itemId: string; newStage: string; newIndex: number }
  | { type: "archive"; itemId: string }
  | { type: "complete"; itemId: string }
  | { type: "unarchive"; itemId: string }
  | { type: "uncomplete"; itemId: string }

function buildColumns(items: Lead[]): KanbanColumn<Lead>[] {
  return STAGE_COLUMNS.map((col) => ({
    ...col,
    items: items
      .filter((i) => i.stage === col.id && !i.is_archived && !i.is_completed)
      .sort((a, b) => a.sort_order - b.sort_order),
  }))
}

type SectionType = "completed" | "archived"

export function PipelineKanban({ leads: initialLeads, tags, profiles }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [formStage, setFormStage] = useState("inquiry")
  const [, startTransition] = useTransition()
  const router = useRouter()

  // Track expanded collapsed sections per column
  const [expandedSections, setExpandedSections] = useState<
    Record<string, Set<SectionType>>
  >({})

  const [optimisticLeads, applyOptimistic] = useOptimistic(
    initialLeads,
    (state: Lead[], action: OptimisticAction) => {
      if (action.type === "archive") {
        return state.map((i) =>
          i.id === action.itemId
            ? { ...i, is_archived: true, is_completed: false, archived_at: new Date().toISOString(), completed_at: null }
            : i
        )
      }
      if (action.type === "complete") {
        return state.map((i) =>
          i.id === action.itemId
            ? { ...i, is_completed: true, is_archived: false, completed_at: new Date().toISOString(), archived_at: null }
            : i
        )
      }
      if (action.type === "unarchive") {
        return state.map((i) =>
          i.id === action.itemId
            ? { ...i, is_archived: false, archived_at: null }
            : i
        )
      }
      if (action.type === "uncomplete") {
        return state.map((i) =>
          i.id === action.itemId
            ? { ...i, is_completed: false, completed_at: null }
            : i
        )
      }

      // type === "move"
      const item = state.find((i) => i.id === action.itemId)
      if (!item) return state

      const withoutItem = state.filter((i) => i.id !== action.itemId)
      const targetItems = withoutItem
        .filter((i) => i.stage === action.newStage && !i.is_archived && !i.is_completed)
        .sort((a, b) => a.sort_order - b.sort_order)

      targetItems.splice(action.newIndex, 0, {
        ...item,
        stage: action.newStage as Lead["stage"],
      })

      const reordered = targetItems.map((i, idx) => ({
        ...i,
        sort_order: idx,
      }))
      const otherItems = withoutItem.filter(
        (i) => i.stage !== action.newStage || i.is_archived || i.is_completed
      )
      return [...otherItems, ...reordered]
    }
  )

  const columns = buildColumns(optimisticLeads)

  // Compute archived/completed leads grouped by stage
  const archivedByStage = useMemo(() => {
    const map: Record<string, Lead[]> = {}
    for (const l of optimisticLeads) {
      if (l.is_archived) {
        map[l.stage] = [...(map[l.stage] ?? []), l]
      }
    }
    return map
  }, [optimisticLeads])

  const completedByStage = useMemo(() => {
    const map: Record<string, Lead[]> = {}
    for (const l of optimisticLeads) {
      if (l.is_completed) {
        map[l.stage] = [...(map[l.stage] ?? []), l]
      }
    }
    return map
  }, [optimisticLeads])

  function toggleSection(columnId: string, section: SectionType) {
    setExpandedSections((prev) => {
      const current = prev[columnId] ?? new Set()
      const next = new Set(current)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return { ...prev, [columnId]: next }
    })
  }

  const handleMove = useCallback(
    (itemId: string, _from: string, to: string, newIndex: number) => {
      startTransition(async () => {
        applyOptimistic({ type: "move", itemId, newStage: to, newIndex })
        await updateLeadStage(itemId, to, newIndex)
      })
    },
    [applyOptimistic]
  )

  const handleReorder = useCallback(
    (itemId: string, column: string, newIndex: number) => {
      startTransition(async () => {
        applyOptimistic({ type: "move", itemId, newStage: column, newIndex })
        await updateLeadStage(itemId, column, newIndex)
      })
    },
    [applyOptimistic]
  )

  function handleClickMove(itemId: string, toColumn: string) {
    const col = columns.find((c) => c.id === toColumn)
    const newIndex = col ? col.items.length : 0
    handleMove(itemId, "", toColumn, newIndex)
  }

  function handleArchive(itemId: string) {
    startTransition(async () => {
      applyOptimistic({ type: "archive", itemId })
      await archiveLead(itemId)
    })
  }

  function handleComplete(itemId: string) {
    startTransition(async () => {
      applyOptimistic({ type: "complete", itemId })
      await completeLead(itemId)
    })
  }

  function handleUnarchive(itemId: string) {
    startTransition(async () => {
      applyOptimistic({ type: "unarchive", itemId })
      await unarchiveLead(itemId)
    })
  }

  function handleUncomplete(itemId: string) {
    startTransition(async () => {
      applyOptimistic({ type: "uncomplete", itemId })
      await uncompleteLead(itemId)
    })
  }

  function handleAdd(columnId: string) {
    setFormStage(columnId)
    setFormOpen(true)
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return null
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  function renderLeadCard(item: Lead, columnId: string, options?: { dimmed?: boolean; onUnarchive?: () => void; onUncomplete?: () => void }) {
    const leadTags = item.lead_tag_assignments?.map((a) => a.lead_tags) ?? []
    const teamCount = item.lead_team_assignments?.length ?? 0

    return (
      <div className={cn(options?.dimmed && "opacity-50")}>
        <KanbanCard
          title={item.project_name}
          subtitle={item.full_name}
          description={item.description}
          accentColor={STAGE_COLUMNS.find((c) => c.id === columnId)?.color}
          statusIndicator={
            item.is_archived ? (
              <Archive className="size-3 text-muted-foreground shrink-0" />
            ) : item.is_completed ? (
              <CheckCircle2 className="size-3 text-green-500 shrink-0" />
            ) : undefined
          }
          badges={[
            ...(item.service_type
              ? [{ label: item.service_type, variant: "secondary" as const }]
              : []),
            ...leadTags.map((t) => ({
              label: t.name,
              variant: "outline" as const,
              color: t.color,
            })),
          ]}
          meta={[
            ...(item.email
              ? [{ icon: <Mail className="size-3" />, label: item.email }]
              : []),
            ...(item.scheduled_date
              ? [{ icon: <Calendar className="size-3" />, label: formatDate(item.scheduled_date)! }]
              : []),
            ...(teamCount > 0
              ? [{ icon: <Users className="size-3" />, label: String(teamCount) }]
              : []),
          ]}
          columns={STAGE_COLUMNS}
          currentColumn={columnId}
          onMoveToColumn={(to) => handleClickMove(item.id, to)}
          onClick={() => router.push(`/pipeline/${item.id}`)}
          onArchive={
            options?.onUnarchive
              ? undefined
              : item.is_archived
                ? undefined
                : () => handleArchive(item.id)
          }
          onComplete={
            options?.onUncomplete
              ? undefined
              : item.is_completed
                ? undefined
                : () => handleComplete(item.id)
          }
        />
      </div>
    )
  }

  return (
    <>
      <KanbanBoard
        columns={columns}
        columnIds={COLUMN_IDS}
        onMove={handleMove}
        onReorder={handleReorder}
        onAdd={handleAdd}
        renderCard={(item, columnId) => renderLeadCard(item, columnId, {
          dimmed: false,
        })}
        renderColumnFooter={(columnId) => {
          const completed = completedByStage[columnId] ?? []
          const archived = archivedByStage[columnId] ?? []
          if (completed.length === 0 && archived.length === 0) return null

          const expanded = expandedSections[columnId] ?? new Set()

          return (
            <div className="border-t px-2 pb-2">
              {/* Completed section */}
              {completed.length > 0 && (
                <div className="mt-1.5">
                  <button
                    className="flex w-full items-center gap-1 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
                    onClick={() => toggleSection(columnId, "completed")}
                  >
                    {expanded.has("completed") ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    <CheckCircle2 className="size-3 text-green-500" />
                    <span>Completed</span>
                    <span className="ml-auto tabular-nums">{completed.length}</span>
                  </button>
                  {expanded.has("completed") && (
                    <div className="mt-1 space-y-1.5">
                      {completed.map((item) => (
                        <div key={item.id} className="relative">
                          {renderLeadCard(item, columnId, { dimmed: true })}
                          <button
                            className="absolute top-1 right-8 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                            style={{ opacity: 1 }}
                            title="Reopen"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleUncomplete(item.id)
                            }}
                          >
                            <RotateCcw className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Archived section */}
              {archived.length > 0 && (
                <div className="mt-1.5">
                  <button
                    className="flex w-full items-center gap-1 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
                    onClick={() => toggleSection(columnId, "archived")}
                  >
                    {expanded.has("archived") ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    <Archive className="size-3" />
                    <span>Archived</span>
                    <span className="ml-auto tabular-nums">{archived.length}</span>
                  </button>
                  {expanded.has("archived") && (
                    <div className="mt-1 space-y-1.5">
                      {archived.map((item) => (
                        <div key={item.id} className="relative">
                          {renderLeadCard(item, columnId, { dimmed: true })}
                          <button
                            className="absolute top-1 right-8 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            title="Unarchive"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleUnarchive(item.id)
                            }}
                          >
                            <RotateCcw className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        }}
      />
      <LeadFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultStage={formStage}
        tags={tags}
        profiles={profiles}
      />
    </>
  )
}
