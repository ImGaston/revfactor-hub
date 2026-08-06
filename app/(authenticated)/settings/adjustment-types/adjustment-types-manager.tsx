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
  type AdjustmentTypeSetting,
} from "@/lib/adjustments"
import { toggleAdjustmentTypeGroup } from "./actions"
import { cn } from "@/lib/utils"

const GRID_COLS = "grid-cols-[minmax(180px,1fr)_120px_120px]"

type Group = "internal" | "hostpricing"

export function AdjustmentTypesManager({
  settings,
}: {
  settings: AdjustmentTypeSetting[]
}) {
  // Optimistic overrides win over server data until refresh
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const router = useRouter()

  const byType = new Map(settings.map((s) => [s.type, s]))

  function isEnabled(type: string, group: Group) {
    const key = `${type}:${group}`
    if (key in overrides) return overrides[key]
    const row = byType.get(type)
    if (!row) return true // no row yet: enabled for both (matches DB defaults)
    return group === "internal" ? row.internal_enabled : row.hostpricing_enabled
  }

  async function handleToggle(type: string, group: Group, enabled: boolean) {
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

  const internalCount = ADJUSTMENT_TYPES.filter((t) =>
    isEnabled(t.value, "internal")
  ).length
  const hostpricingCount = ADJUSTMENT_TYPES.filter((t) =>
    isEnabled(t.value, "hostpricing")
  ).length

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Choose which adjustment types each group can pick when creating a
        ticket.
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
                RevFactor {internalCount}/{ADJUSTMENT_TYPES.length} ·
                HostPricing {hostpricingCount}/{ADJUSTMENT_TYPES.length}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[440px] space-y-0.5">
              {/* Header row */}
              <div className={cn("grid items-center gap-1 px-3 py-1.5", GRID_COLS)}>
                <span className="text-xs font-medium text-muted-foreground">
                  Type
                </span>
                <span className="text-[10px] font-medium text-center uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                  RevFactor
                </span>
                <span className="text-[10px] font-medium text-center uppercase tracking-wide text-violet-600 dark:text-violet-400">
                  HostPricing
                </span>
              </div>

              {ADJUSTMENT_TYPES.map((t) => {
                const internal = isEnabled(t.value, "internal")
                const hostpricing = isEnabled(t.value, "hostpricing")
                const hiddenForAll = !internal && !hostpricing

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
                    <div className="flex justify-center">
                      <Checkbox
                        checked={internal}
                        onCheckedChange={(checked) =>
                          handleToggle(t.value, "internal", checked === true)
                        }
                        aria-label={`${t.label} visible to RevFactor`}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Checkbox
                        checked={hostpricing}
                        onCheckedChange={(checked) =>
                          handleToggle(t.value, "hostpricing", checked === true)
                        }
                        aria-label={`${t.label} visible to HostPricing`}
                      />
                    </div>
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
