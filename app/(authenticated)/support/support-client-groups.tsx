"use client"

import Link from "next/link"
import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, Inbox } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { timeAgo } from "@/lib/support-display"
import type { SupportClientGroup } from "@/lib/support-client-view"
import { supportQueueHref, type SupportQueueView } from "@/lib/support-queue"
import type { SupportTicket } from "@/lib/support-tickets"
import { cn } from "@/lib/utils"

const ALERT_CHIP = "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
const WARN_CHIP = "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"

/** "By status" (the queue sections) | "By client" (one group per client). */
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
      value={value}
      onValueChange={(next) => {
        if (next === "status" || next === "client") onChange(next)
      }}
      aria-label="Group tickets"
    >
      <ToggleGroupItem value="status" className="px-3">
        By status
      </ToggleGroupItem>
      <ToggleGroupItem value="client" className="px-3">
        By client
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

/**
 * Every client with open tickets, most overdue first. Rows come from the
 * caller (`renderTicket`) so they match the status view exactly.
 */
export function SupportClientGroups({
  groups,
  now,
  renderTicket,
}: {
  groups: SupportClientGroup[]
  now: Date
  renderTicket: (ticket: SupportTicket) => ReactNode
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  function toggle(clientId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        <Inbox className="size-6" />
        <p className="font-medium text-foreground">No open tickets</p>
      </div>
    )
  }

  const ticketCount = groups.reduce((sum, g) => sum + g.open, 0)

  return (
    <section className="space-y-3" aria-label="Open tickets by client">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-medium">By client</h2>
          <span className="text-sm text-muted-foreground">
            {ticketCount} open {ticketCount === 1 ? "ticket" : "tickets"} across {groups.length}{" "}
            {groups.length === 1 ? "client" : "clients"}, most overdue first.
          </span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>
            Expand all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set(groups.map((g) => g.clientId)))}>
            Collapse all
          </Button>
        </div>
      </div>
      {groups.map((group) => (
        <ClientGroup
          key={group.clientId}
          group={group}
          now={now}
          open={!collapsed.has(group.clientId)}
          onToggle={() => toggle(group.clientId)}
          renderTicket={renderTicket}
        />
      ))}
    </section>
  )
}

function ClientGroup({
  group: g,
  now,
  open,
  onToggle,
  renderTicket,
}: {
  group: SupportClientGroup
  now: Date
  open: boolean
  onToggle: () => void
  renderTicket: (ticket: SupportTicket) => ReactNode
}) {
  const bodyId = `support-client-group-${g.clientId}`
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div className={cn("rounded-md border", g.overdue > 0 && "border-l-4 border-l-red-400 dark:border-l-red-800")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? "Collapse" : "Expand"} ${g.clientName}`}
          className="rounded-sm text-muted-foreground hover:text-foreground"
        >
          <Chevron className="size-4" />
        </button>
        <Link
          href={supportQueueHref({ clientId: g.clientId, showClosed: false, view: "client" })}
          className="min-w-0 font-medium wrap-anywhere hover:underline"
          title="Open this client's tickets and context"
        >
          {g.clientName}
        </Link>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="secondary">{g.open} open</Badge>
          {g.overdue > 0 && <Badge className={ALERT_CHIP}>{g.overdue} overdue</Badge>}
          {g.triage > 0 && <Badge className={WARN_CHIP}>{g.triage} needs triage</Badge>}
          {g.awaitingClient > 0 && <Badge variant="outline">{g.awaitingClient} awaiting client</Badge>}
          {g.overduePromises > 0 && (
            <Badge className={ALERT_CHIP}>
              {g.overduePromises} overdue {g.overduePromises === 1 ? "promise" : "promises"}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:ml-auto">
          <span>Oldest ask {timeAgo(g.oldestAskAt, now)}</span>
          <span>{g.owners.join(", ")}</span>
        </div>
      </div>
      {open && (
        <div id={bodyId} className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Ref</TableHead>
                <TableHead>Ask</TableHead>
                <TableHead>Property</TableHead>
                <TableHead className="w-32">Next due</TableHead>
                <TableHead className="w-40">Status</TableHead>
                <TableHead className="w-24">Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{g.tickets.map((t) => renderTicket(t))}</TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
