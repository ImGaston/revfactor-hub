"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { SupportQueueView } from "@/lib/support-queue"

/** "By client" (one row per client, the default) | "By status" (the queue views). */
export function SupportViewToggle({
  value,
  onChange,
}: {
  value: SupportQueueView
  onChange: (view: SupportQueueView) => void
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(next) => {
        if (next === "status" || next === "client") onChange(next)
      }}
      aria-label="Group tickets"
    >
      <ToggleGroupItem value="client" className="px-3">
        By client
      </ToggleGroupItem>
      <ToggleGroupItem value="status" className="px-3">
        By status
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
