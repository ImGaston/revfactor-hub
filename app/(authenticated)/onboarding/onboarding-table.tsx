"use client"

import { useState, useTransition, useMemo } from "react"
import { Check, MessageSquare } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { toggleOnboardingStep } from "./actions"
import { OnboardingComments } from "./onboarding-comments"
import type { OnboardingTemplate, OnboardingProgress } from "@/lib/types"

type ClientRow = {
  id: string
  name: string
  email: string | null
  onboarding_date: string | null
  commentCount: number
}

type Props = {
  clients: ClientRow[]
  templates: OnboardingTemplate[]
  progress: OnboardingProgress[]
  currentUserId: string | null
}

function formatDate(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function OnboardingTable({
  clients,
  templates,
  progress,
  currentUserId,
}: Props) {
  const [, startTransition] = useTransition()
  const [optimistic, setOptimistic] = useState<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>()
    for (const p of progress) {
      m.set(`${p.client_id}::${p.template_id}`, p.is_completed)
    }
    return m
  })

  const getCompleted = (clientId: string, templateId: string) =>
    optimistic.get(`${clientId}::${templateId}`) ?? false

  function handleToggle(clientId: string, templateId: string) {
    const key = `${clientId}::${templateId}`
    const current = optimistic.get(key) ?? false
    const newValue = !current
    setOptimistic((prev) => new Map(prev).set(key, newValue))
    startTransition(async () => {
      await toggleOnboardingStep(clientId, templateId, newValue)
    })
  }

  const clientStats = useMemo(() => {
    const stats = new Map<string, { done: number; total: number; pct: number }>()
    for (const c of clients) {
      const total = templates.length
      let done = 0
      for (const t of templates) {
        if (getCompleted(c.id, t.id)) done++
      }
      stats.set(c.id, {
        done,
        total,
        pct: total > 0 ? Math.round((done / total) * 100) : 0,
      })
    }
    return stats
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, templates, optimistic])

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px] sticky left-0 bg-background z-10">
              Client
            </TableHead>
            <TableHead className="w-[120px]">Start date</TableHead>
            <TableHead className="w-[160px]">Progress</TableHead>
            <TableHead className="w-[90px]">Comments</TableHead>
            {templates.map((t) => (
              <TableHead
                key={t.id}
                className="w-[40px] text-center"
                title={t.step_name}
              >
                <div className="truncate text-[11px]" title={t.step_name}>
                  {t.step_name}
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((c) => {
            const stats = clientStats.get(c.id) ?? { done: 0, total: 0, pct: 0 }
            return (
              <TableRow key={c.id}>
                <TableCell className="sticky left-0 bg-background z-10 align-middle">
                  <div className="font-medium truncate">{c.name}</div>
                  {c.email && (
                    <div className="text-xs text-muted-foreground truncate">
                      {c.email}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(c.onboarding_date)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden min-w-[60px]">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${stats.pct}%` }}
                      />
                    </div>
                    <Badge
                      variant={stats.pct === 100 ? "default" : "secondary"}
                      className="text-[10px] shrink-0"
                    >
                      {stats.pct}%
                    </Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {stats.done}/{stats.total}
                  </div>
                </TableCell>
                <TableCell>
                  <Dialog>
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <MessageSquare className="size-3" />
                        {c.commentCount}
                      </button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Comments — {c.name}</DialogTitle>
                      </DialogHeader>
                      <OnboardingComments
                        clientId={c.id}
                        currentUserId={currentUserId}
                      />
                    </DialogContent>
                  </Dialog>
                </TableCell>
                {templates.map((t) => {
                  const isCompleted = getCompleted(c.id, t.id)
                  return (
                    <TableCell key={t.id} className="text-center p-0">
                      <button
                        type="button"
                        onClick={() => handleToggle(c.id, t.id)}
                        className="inline-flex items-center justify-center w-full h-10 hover:bg-muted/50 transition-colors"
                        title={t.step_name}
                      >
                        {isCompleted ? (
                          <div className="inline-flex items-center justify-center size-5 rounded bg-primary text-primary-foreground">
                            <Check className="size-3.5" />
                          </div>
                        ) : (
                          <Checkbox checked={false} className="pointer-events-none" />
                        )}
                      </button>
                    </TableCell>
                  )
                })}
              </TableRow>
            )
          })}
          {clients.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={4 + templates.length}
                className="text-center py-8 text-sm text-muted-foreground"
              >
                No clients match your filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
