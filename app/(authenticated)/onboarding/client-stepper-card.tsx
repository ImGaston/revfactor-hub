"use client"

import { useOptimistic, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { toggleOnboardingStep } from "./actions"
import type { OnboardingTemplate, OnboardingProgress } from "@/lib/types"

type ClientRow = {
  id: string
  name: string
  email: string | null
}

type Props = {
  client: ClientRow
  templates: OnboardingTemplate[]
  progress: OnboardingProgress[]
}

type OptimisticProgress = {
  templateId: string
  isCompleted: boolean
  completedByName: string | null
  completedAt: string | null
}

export function ClientStepperCard({ client, templates, progress }: Props) {
  const [, startTransition] = useTransition()

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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">{client.name}</CardTitle>
            {client.email && (
              <p className="text-xs text-muted-foreground">
                {client.email}
              </p>
            )}
          </div>
          <Badge variant={pct === 100 ? "default" : "secondary"} className="text-[10px]">
            {completedCount}/{totalCount} &mdash; {pct}%
          </Badge>
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
