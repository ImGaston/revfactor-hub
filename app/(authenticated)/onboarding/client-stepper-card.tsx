"use client"

import { useOptimistic, useTransition } from "react"
import { CheckCircle, Circle } from "lucide-react"
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
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{client.name}</CardTitle>
            {client.email && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {client.email}
              </p>
            )}
          </div>
          <Badge variant={pct === 100 ? "default" : "secondary"}>
            {completedCount}/{totalCount} &mdash; {pct}%
          </Badge>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {templates.map((t, idx) => {
            const step = optimisticSteps.find(
              (s) => s.templateId === t.id
            )
            const isCompleted = step?.isCompleted ?? false

            return (
              <div
                key={t.id}
                className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
              >
                {/* Step number / icon */}
                <div className="flex-shrink-0 mt-0.5">
                  {isCompleted ? (
                    <CheckCircle className="size-5 text-primary" />
                  ) : (
                    <Circle className="size-5 text-muted-foreground" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {idx + 1}.
                    </span>
                    <span
                      className={`text-sm font-medium ${
                        isCompleted
                          ? "line-through text-muted-foreground"
                          : ""
                      }`}
                    >
                      {t.step_name}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 ml-5">
                      {t.description}
                    </p>
                  )}
                  {isCompleted && step?.completedByName && (
                    <p className="text-xs text-muted-foreground mt-0.5 ml-5">
                      Completed by {step.completedByName}
                      {step.completedAt &&
                        ` on ${new Date(step.completedAt).toLocaleDateString()}`}
                    </p>
                  )}
                </div>

                {/* Checkbox */}
                <Checkbox
                  checked={isCompleted}
                  onCheckedChange={() =>
                    handleToggle(t.id, isCompleted)
                  }
                  className="mt-0.5"
                />
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
