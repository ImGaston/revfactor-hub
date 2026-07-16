import Link from "next/link"
import { SlidersHorizontal } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  STATUS_BADGE,
  adjustmentStatusLabel,
  adjustmentTypeLabel,
} from "@/lib/adjustments"

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
