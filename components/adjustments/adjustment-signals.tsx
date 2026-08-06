import { Badge } from "@/components/ui/badge"
import {
  ADJUSTMENT_SIGNAL_FIELDS,
  suggestedActionLabel,
} from "@/lib/adjustments"
import type { AdjustmentSignals as AdjustmentSignalsType } from "@/lib/types"

// Report signals + suggested pricing actions attached to a HostPricing review
// ticket. Rendered on the internal detail and the authed share card — never on
// the unauthenticated /a/<token> shell (client-performance data).
export function AdjustmentSignals({
  signals,
  suggestedActions,
}: {
  signals: AdjustmentSignalsType | null | undefined
  suggestedActions: string[] | null | undefined
}) {
  const entries = ADJUSTMENT_SIGNAL_FIELDS.filter((f) => signals?.[f.key])
  const actions = suggestedActions ?? []
  if (entries.length === 0 && actions.length === 0) return null

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      {entries.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Report signals</p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {entries.map((field) => (
              <div key={field.key} className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">{field.label}:</dt>
                <dd className="min-w-0">{signals?.[field.key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Suggested:</span>
          {actions.map((action) => (
            <Badge key={action} variant="outline">
              {suggestedActionLabel(action)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
