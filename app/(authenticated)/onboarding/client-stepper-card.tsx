"use client"

import { useOptimistic, useState, useTransition } from "react"
import { MessageSquare } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
  commentCount?: number
}

type Props = {
  client: ClientRow
  templates: OnboardingTemplate[]
  progress: OnboardingProgress[]
  currentUserId: string | null
}

type OptimisticProgress = {
  templateId: string
  isCompleted: boolean
  completedByName: string | null
  completedAt: string | null
}

export function ClientStepperCard({ client, templates, progress, currentUserId }: Props) {
  const [, startTransition] = useTransition()
  const [commentCount, setCommentCount] = useState(client.commentCount ?? 0)

  // Build initial progress map
  const initialSteps: OptimisticProgress[] = templates.map((t) => {
    const p = progress.find((pr) => pr.template_id === t.id)
    const profileData = p?.profiles
    const resolvedProfile = Array.isArray(profileData)
      ? profileData[0]
      : profileData
    return {
      templateId: t.id,
      isCompleted: p?.is_completed ?? false,
      completedByName: resolvedProfile?.full_name ?? null,
      completedAt: p?.completed_at ?? null,
    }
  })

  const [optimisticSteps, addOptimistic] = useOptimistic(
    initialSteps,
    (
      state: OptimisticProgress[],
      update: { templateId: string; isCompleted: boolean }
    ) =>
      state.map((s) =>
        s.templateId === update.templateId
          ? {
              ...s,
              isCompleted: update.isCompleted,
              completedAt: update.isCompleted
                ? new Date().toISOString()
                : null,
              completedByName: update.isCompleted ? "You" : null,
            }
          : s
      )
  )

  const completedCount = optimisticSteps.filter((s) => s.isCompleted).length
  const totalCount = optimisticSteps.length
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  function handleToggle(templateId: string, currentCompleted: boolean) {
    const newValue = !currentCompleted
    startTransition(async () => {
      addOptimistic({ templateId, isCompleted: newValue })
      await toggleOnboardingStep(client.id, templateId, newValue)
    })
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold truncate">{client.name}</CardTitle>
            {client.email && (
              <p className="text-xs text-muted-foreground truncate">
                {client.email}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Comments"
                >
                  <MessageSquare className="size-3" />
                  {commentCount}
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Comments — {client.name}</DialogTitle>
                </DialogHeader>
                <OnboardingComments
                  clientId={client.id}
                  currentUserId={currentUserId}
                  onCountChange={setCommentCount}
                />
              </DialogContent>
            </Dialog>
            <Badge variant={pct === 100 ? "default" : "secondary"} className="text-[10px]">
              {completedCount}/{totalCount} &mdash; {pct}%
            </Badge>
          </div>
        </div>
        <div className="mt-1.5 h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        <div className="divide-y">
          {templates.map((t, idx) => {
            const step = optimisticSteps.find(
              (s) => s.templateId === t.id
            )
            const isCompleted = step?.isCompleted ?? false

            return (
              <label
                key={t.id}
                className="flex items-center gap-2.5 py-1.5 cursor-pointer hover:bg-muted/50 -mx-1 px-1 rounded-sm transition-colors"
              >
                <Checkbox
                  checked={isCompleted}
                  onCheckedChange={() =>
                    handleToggle(t.id, isCompleted)
                  }
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <span
                    className={`text-sm leading-tight ${
                      isCompleted
                        ? "line-through text-muted-foreground"
                        : ""
                    }`}
                  >
                    <span className="text-xs text-muted-foreground mr-1">{idx + 1}.</span>
                    {t.step_name}
                  </span>
                  {t.description && !isCompleted && (
                    <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                      {t.description}
                    </p>
                  )}
                </div>
              </label>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
