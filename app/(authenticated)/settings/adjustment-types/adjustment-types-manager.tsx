"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Info, SlidersHorizontal, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ADJUSTMENT_TYPES,
  adjustmentTypeEnabledFor,
  type AdjustmentTypeGroup,
  type AdjustmentTypeSetting,
} from "@/lib/adjustments"
import { toggleAdjustmentTypeGroup } from "./actions"
import { cn } from "@/lib/utils"

const GRID_COLS = "grid-cols-[minmax(180px,1fr)_120px_120px_120px]"

const GROUPS: { value: AdjustmentTypeGroup; label: string; headerClass: string }[] = [
  {
    value: "internal",
    label: "RevFactor",
    headerClass: "text-emerald-600 dark:text-emerald-400",
  },
  {
    value: "hostpricing",
    label: "HostPricing",
    headerClass: "text-violet-600 dark:text-violet-400",
  },
  { value: "agent", label: "Agent", headerClass: "text-sky-600 dark:text-sky-400" },
]

export function AdjustmentTypesManager({
  settings,
}: {
  settings: AdjustmentTypeSetting[]
}) {
  // Optimistic overrides win over server data until refresh
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const router = useRouter()

  const byType = new Map(settings.map((s) => [s.type, s]))

  function isEnabled(type: string, group: AdjustmentTypeGroup) {
    const key = `${type}:${group}`
    if (key in overrides) return overrides[key]
    const row = byType.get(type)
    // No row yet: visible for the human groups, hidden for agents (DB defaults)
    if (!row) return group !== "agent"
    return adjustmentTypeEnabledFor(row, group)
  }

  async function handleToggle(
    type: string,
    group: AdjustmentTypeGroup,
    enabled: boolean
  ) {
    const key = `${type}:${group}`
    setOverrides((prev) => ({ ...prev, [key]: enabled }))
    const result = await toggleAdjustmentTypeGroup(type, group, enabled)
    if (result.error) {
      setOverrides((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      toast.error(result.error)
    } else {
      router.refresh()
    }
  }

  const counts = Object.fromEntries(
    GROUPS.map((g) => [
      g.value,
      ADJUSTMENT_TYPES.filter((t) => isEnabled(t.value, g.value)).length,
    ])
  ) as Record<AdjustmentTypeGroup, number>

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Choose which adjustment types each group can pick when creating a
        ticket. The Agent column lists what an AI agent is allowed to file.
      </p>

      <div className="flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-4 py-3">
        <Info className="size-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <p className="text-sm text-blue-700 dark:text-blue-300">
          The filter applies to who is creating the ticket. Existing tickets
          keep their type either way, and when editing a ticket its current
          type stays selectable.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-muted">
              <SlidersHorizontal className="size-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Adjustment Types</CardTitle>
              <CardDescription>
                {GROUPS.map((g, i) => (
                  <span key={g.value}>
                    {i > 0 && " · "}
                    {g.label} {counts[g.value]}/{ADJUSTMENT_TYPES.length}
                  </span>
                ))}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[560px] space-y-0.5">
              {/* Header row */}
              <div className={cn("grid items-center gap-1 px-3 py-1.5", GRID_COLS)}>
                <span className="text-xs font-medium text-muted-foreground">
                  Type
                </span>
                {GROUPS.map((g) => (
                  <span
                    key={g.value}
                    className={cn(
                      "text-[10px] font-medium text-center uppercase tracking-wide",
                      g.headerClass
                    )}
                  >
                    {g.label}
                  </span>
                ))}
              </div>

              {ADJUSTMENT_TYPES.map((t) => {
                // "Hidden for everyone" is about the human creator groups —
                // agents are opt-in and most types are off for them by design.
                const hiddenForAll =
                  !isEnabled(t.value, "internal") &&
                  !isEnabled(t.value, "hostpricing")

                return (
                  <div
                    key={t.value}
                    className={cn(
                      "grid items-center gap-1 rounded-md px-3 py-2 transition-colors hover:bg-muted/50",
                      GRID_COLS
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {t.label}
                      {hiddenForAll && (
                        <Badge
                          variant="outline"
                          className="gap-1 text-[9px] font-normal text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                        >
                          <TriangleAlert className="size-2.5" />
                          Hidden for everyone
                        </Badge>
                      )}
                    </span>
                    {GROUPS.map((g) => (
                      <div key={g.value} className="flex justify-center">
                        <Checkbox
                          checked={isEnabled(t.value, g.value)}
                          onCheckedChange={(checked) =>
                            handleToggle(t.value, g.value, checked === true)
                          }
                          aria-label={`${t.label} visible to ${g.label}`}
                        />
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
