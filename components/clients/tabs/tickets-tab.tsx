"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"

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
  SUPPORT_CLOSED_STATUSES,
  SUPPORT_PRIORITY_BADGE,
  SUPPORT_STATUS_BADGE,
  SUPPORT_STATUS_LABEL,
  supportCategoryLabel,
  supportTicketPath,
  type SupportPriority,
  type SupportStatus,
} from "@/lib/support-tickets"
import { formatSupportDateTime } from "@/lib/support-display"
import {
  loadClientTicketsAction,
  type ClientTicketRow,
} from "@/app/(authenticated)/clients/[id]/tab-actions"
import { TabError, TabSkeleton, useLazyTabData } from "./lazy-tab"

type Filter = "open" | "closed" | "all"

/** Closed = resolved, dismissed, or merged into another ticket. */
function isClosedTicket(t: Pick<ClientTicketRow, "status" | "merged_into">): boolean {
  return Boolean(t.merged_into) || (SUPPORT_CLOSED_STATUSES as string[]).includes(t.status)
}

export function TicketsTab({ clientId }: { clientId: string }) {
  const load = useCallback(() => loadClientTicketsAction(clientId), [clientId])
  const { state, reload } = useLazyTabData(load)
  const [filter, setFilter] = useState<Filter>("open")

  const rows = useMemo(() => (state.status === "ready" ? state.data : []), [state])
  const counts = useMemo(() => {
    const closed = rows.filter(isClosedTicket).length
    return { open: rows.length - closed, closed, all: rows.length }
  }, [rows])
  const visible = useMemo(
    () =>
      rows.filter((t) =>
        filter === "all" ? true : filter === "closed" ? isClosedTicket(t) : !isClosedTicket(t)
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
            <p className="p-6 text-center text-sm text-muted-foreground">No tickets</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>First response</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-muted-foreground">
                      <Link href={supportTicketPath(t.id)} className="hover:underline">
                        {t.ticket_number}
                      </Link>
                    </TableCell>
                    <TableCell className="min-w-64 whitespace-normal">
                      <Link href={supportTicketPath(t.id)} className="font-medium hover:underline">
                        {t.summary}
                      </Link>
                    </TableCell>
                    <TableCell>{supportCategoryLabel(t.category)}</TableCell>
                    <TableCell>
                      <Badge className={SUPPORT_PRIORITY_BADGE[t.priority as SupportPriority] ?? ""}>
                        {t.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={SUPPORT_STATUS_BADGE[t.status as SupportStatus] ?? ""}>
                        {t.merged_into ? "Merged" : (SUPPORT_STATUS_LABEL[t.status as SupportStatus] ?? t.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatSupportDateTime(t.requested_at)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.first_response_at ? formatSupportDateTime(t.first_response_at) : "—"}
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
