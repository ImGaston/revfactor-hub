import { Badge } from "@/components/ui/badge"
import {
  STATUS_BADGE_CLASS,
  STATUS_BADGE_VARIANT,
  isTestStatus,
  statusLabel,
} from "@/lib/status"
import { cn } from "@/lib/utils"

/**
 * The one client/listing status badge. Keeps the historical solid/secondary/
 * outline variants for the real statuses and tints `test` so internal test
 * data is recognizable at a glance everywhere it stays visible.
 */
export function StatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  return (
    <Badge
      variant={STATUS_BADGE_VARIANT[status] ?? "outline"}
      className={cn(isTestStatus(status) && STATUS_BADGE_CLASS.test, className)}
    >
      {statusLabel(status)}
    </Badge>
  )
}
