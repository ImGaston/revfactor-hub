"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import { ExternalLink } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ORIGIN_BADGE,
  OPEN_STATUSES,
  STATUS_BADGE,
  adjustmentOriginLabel,
  adjustmentStatusLabelFor,
  adjustmentTypeLabel,
} from "@/lib/adjustments"
import { formatJourneyDate } from "@/lib/client-journey"
import {
  loadClientAdjustmentsAction,
  type ClientAdjustmentRow,
} from "@/app/(authenticated)/clients/[id]/tab-actions"
import { TabError, TabSkeleton, useLazyTabData } from "./lazy-tab"

type Filter = "open" | "closed" | "all"

function isOpenAdjustment(a: Pick<ClientAdjustmentRow, "status">): boolean {
  return (OPEN_STATUSES as string[]).includes(a.status)
}

function dateRange(a: ClientAdjustmentRow): string {
  if (!a.date_from && !a.date_to) return "—"
  if (a.date_from && a.date_to && a.date_from !== a.date_to) {
    return `${formatJourneyDate(a.date_from)} – ${formatJourneyDate(a.date_to)}`
  }
  return formatJourneyDate(a.date_from ?? a.date_to)
}

function shortDate(value: string | null): string {
  return value ? formatJourneyDate(value) : "—"
}

export function AdjustmentsTab({ clientId }: { clientId: string }) {
  const load = useCallback(() => loadClientAdjustmentsAction(clientId), [clientId])
  const { state, reload } = useLazyTabData(load)
  const [filter, setFilter] = useState<Filter>("open")

  const rows = useMemo(() => (state.status === "ready" ? state.data : []), [state])
  const counts = useMemo(() => {
    const open = rows.filter(isOpenAdjustment).length
    return { open, closed: rows.length - open, all: rows.length }
  }, [rows])
  const visible = useMemo(
    () =>
      rows.filter((a) =>
        filter === "all" ? true : filter === "open" ? isOpenAdjustment(a) : !isOpenAdjustment(a)
      ),
    [rows, filter]
  )

  if (state.status === "loading") return <TabSkeleton />
  if (state.status === "error") return <TabError error={state.error} onRetry={reload} />

  return (
    <div className="space-y-4">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={filter}
        onValueChange={(v) => v && setFilter(v as Filter)}
      >
        <ToggleGroupItem value="open">Open · {counts.open}</ToggleGroupItem>
        <ToggleGroupItem value="closed">Closed · {counts.closed}</ToggleGroupItem>
        <ToggleGroupItem value="all">All · {counts.all}</ToggleGroupItem>
      </ToggleGroup>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {visible.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No adjustments</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Listing</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Resolved</TableHead>
                  <TableHead>Controlled</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="min-w-48 whitespace-normal">
                      <Link href={`/adjustments/${a.id}`} className="font-medium hover:underline">
                        {adjustmentTypeLabel(a.type)}
                        {a.target_value ? (
                          <span className="font-normal text-muted-foreground"> · {a.target_value}</span>
                        ) : null}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {a.scope === "portfolio" ? (
                        <span className="text-muted-foreground">Portfolio</span>
                      ) : (
                        (a.listings?.name ?? "—")
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{dateRange(a)}</TableCell>
                    <TableCell>
                      {ORIGIN_BADGE[a.origin] ? (
                        <Badge className={ORIGIN_BADGE[a.origin]}>{adjustmentOriginLabel(a.origin)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{adjustmentOriginLabel(a.origin)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[a.status] ?? ""}>{adjustmentStatusLabelFor(a)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{shortDate(a.created_at)}</TableCell>
                    <TableCell className="text-muted-foreground">{shortDate(a.resolved_at)}</TableCell>
                    <TableCell className="text-muted-foreground">{shortDate(a.controlled_at)}</TableCell>
                    <TableCell>
                      <Link
                        href={`/a/${a.public_token}`}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Open the share card"
                        title="Open the share card"
                      >
                        <ExternalLink className="size-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
