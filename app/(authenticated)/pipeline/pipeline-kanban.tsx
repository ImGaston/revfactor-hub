"use client"

import { useState, useCallback, useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Calendar, Users, Mail } from "lucide-react"
import { KanbanBoard, type KanbanColumn } from "@/components/kanban/kanban-board"
import { KanbanCard } from "@/components/kanban/kanban-card"
import { LeadFormDialog } from "./lead-form-dialog"
import { updateLeadStage } from "./actions"
import type { Lead, LeadTag } from "@/lib/types"

export const STAGE_COLUMNS = [
  // Active Pipeline
  { id: "inquiry", label: "Inquiry", color: "#818cf8", bgColor: "hsl(235 85% 97%)" },
  { id: "follow_up", label: "Follow-up", color: "#60a5fa", bgColor: "hsl(217 91% 97%)" },
  { id: "audit", label: "Audit", color: "#38bdf8", bgColor: "hsl(199 89% 97%)" },
  { id: "meeting", label: "Meeting", color: "#2dd4bf", bgColor: "hsl(172 66% 97%)" },
  // Closing
  { id: "proposal_sent", label: "Proposal Sent", color: "#f59e0b", bgColor: "hsl(38 92% 97%)" },
  { id: "proposal_signed", label: "Proposal Signed", color: "#f97316", bgColor: "hsl(25 95% 97%)" },
  { id: "retainer_paid", label: "Retainer Paid", color: "#22c55e", bgColor: "hsl(142 71% 97%)" },
  // Post-Sale
  { id: "planning", label: "Planning", color: "#a78bfa", bgColor: "hsl(257 90% 97%)" },
  { id: "completed", label: "Completed", color: "#10b981", bgColor: "hsl(160 60% 97%)" },
  { id: "archived", label: "Archived", color: "#6b7280", bgColor: "hsl(220 9% 97%)" },
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

type OptimisticAction = {
  itemId: string
  newStage: string
  newIndex: number
}

function buildColumns(items: Lead[]): KanbanColumn<Lead>[] {
  return STAGE_COLUMNS.map((col) => ({
    ...col,
    items: items
      .filter((i) => i.stage === col.id)
      .sort((a, b) => a.sort_order - b.sort_order),
  }))
}

export function PipelineKanban({ leads: initialLeads, tags, profiles }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [formStage, setFormStage] = useState("inquiry")
  const [, startTransition] = useTransition()
  const router = useRouter()

  const [optimisticLeads, applyOptimistic] = useOptimistic(
    initialLeads,
    (state: Lead[], action: OptimisticAction) => {
      const item = state.find((i) => i.id === action.itemId)
      if (!item) return state

      const withoutItem = state.filter((i) => i.id !== action.itemId)
      const targetItems = withoutItem
        .filter((i) => i.stage === action.newStage)
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
        (i) => i.stage !== action.newStage
      )
      return [...otherItems, ...reordered]
    }
  )

  const columns = buildColumns(optimisticLeads)

  const handleMove = useCallback(
    (itemId: string, _from: string, to: string, newIndex: number) => {
      startTransition(async () => {
        applyOptimistic({ itemId, newStage: to, newIndex })
        await updateLeadStage(itemId, to, newIndex)
      })
    },
    [applyOptimistic]
  )

  const handleReorder = useCallback(
    (itemId: string, column: string, newIndex: number) => {
      startTransition(async () => {
        applyOptimistic({ itemId, newStage: column, newIndex })
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

  function handleAdd(columnId: string) {
    setFormStage(columnId)
    setFormOpen(true)
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return null
    const d = new Date(dateStr)
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
          const leadTags =
            item.lead_tag_assignments?.map((a) => a.lead_tags) ?? []
          const teamCount = item.lead_team_assignments?.length ?? 0

          return (
            <KanbanCard
              title={item.project_name}
              subtitle={item.full_name}
              description={item.description}
              accentColor={
                STAGE_COLUMNS.find((c) => c.id === columnId)?.color
              }
              badges={[
                ...(item.service_type
                  ? [
                      {
                        label: item.service_type,
                        variant: "secondary" as const,
                      },
                    ]
                  : []),
                ...leadTags.map((t) => ({
                  label: t.name,
                  variant: "outline" as const,
                  color: t.color,
                })),
              ]}
              meta={[
                ...(item.email
                  ? [
                      {
                        icon: <Mail className="size-3" />,
                        label: item.email,
                      },
                    ]
                  : []),
                ...(item.scheduled_date
                  ? [
                      {
                        icon: <Calendar className="size-3" />,
                        label: formatDate(item.scheduled_date)!,
                      },
                    ]
                  : []),
                ...(teamCount > 0
                  ? [
                      {
                        icon: <Users className="size-3" />,
                        label: String(teamCount),
                      },
                    ]
                  : []),
              ]}
              columns={STAGE_COLUMNS}
              currentColumn={columnId}
              onMoveToColumn={(to) => handleClickMove(item.id, to)}
              onClick={() => router.push(`/pipeline/${item.id}`)}
            />
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
