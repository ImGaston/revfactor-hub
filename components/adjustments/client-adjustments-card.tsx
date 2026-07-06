import Link from "next/link"
import { SlidersHorizontal } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { adjustmentStatusLabel, adjustmentTypeLabel } from "@/lib/adjustments"

// Minimal per-client changelog row — only what the QBR glance needs
export type ClientAdjustmentItem = {
  id: string
  public_token: string
  scope: string
  type: string
  target_value: string | null
  status: string
  created_at: string
  controlled_at: string | null
  listings: { name: string } | null
}

const STATUS_BADGE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  in_progress: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  controlled: "bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  issue: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  rejected: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
}

export function ClientAdjustmentsCard({
  adjustments,
}: {
  adjustments: ClientAdjustmentItem[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SlidersHorizontal className="size-4" />
          Adjustments
          <Badge variant="secondary">{adjustments.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No adjustments yet.</p>
        ) : (
          <ul className="divide-y">
            {adjustments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-20 shrink-0 text-muted-foreground">
                  {new Date(a.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <Link
                  href={`/a/${a.public_token}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {adjustmentTypeLabel(a.type)}
                  {a.target_value ? ` ${a.target_value}` : ""}
                  <span className="ml-1 font-normal text-muted-foreground">
                    · {a.scope === "portfolio" ? "portfolio" : a.listings?.name}
                  </span>
                </Link>
                <Badge className={STATUS_BADGE[a.status]}>
                  {adjustmentStatusLabel(a.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
