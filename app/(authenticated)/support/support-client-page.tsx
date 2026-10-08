"use client"

import Link from "next/link"
import { useMemo } from "react"
import { ArrowLeft } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { SupportClientContext } from "@/lib/support-client-view"
import { ownerLabel, timeAgo } from "@/lib/support-display"
import { supportQueueHref, supportQueueSearch, type SupportQueueFilters } from "@/lib/support-queue"
import {
  SUPPORT_CLOSED_STATUSES,
  SUPPORT_STATUS_BADGE,
  supportStatusLabel,
  supportTicketPath,
  ticketRef,
  type SupportStats,
  type SupportTicket,
} from "@/lib/support-tickets"
import { SupportClientContextPanel } from "./support-client-context"
import { Stat } from "./support-workspace"

/** The main column with a client picked: its stats, context, and (on request) closed history. */
export function SupportClientPage({
  clientName,
  tickets,
  stats,
  context,
  filters,
  closedTotal,
  nowIso,
}: {
  clientName: string
  /** This client's open tickets, plus its closed ones with `?closed=1` */
  tickets: SupportTicket[]
  stats: SupportStats
  context: SupportClientContext
  filters: SupportQueueFilters
  closedTotal: number | null
  nowIso: string
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso])
  const promiseRate = stats.promiseOnTimeRate === null ? "—" : `${Math.round(stats.promiseOnTimeRate * 100)}%`
  const closed = tickets
    .filter((t) => SUPPORT_CLOSED_STATUSES.includes(t.status))
    .sort((a, b) => (b.resolved_at ?? b.updated_at).localeCompare(a.resolved_at ?? a.updated_at))
  const search = supportQueueSearch(filters)

  return (
    <div className="space-y-6 p-6">
      <Link
        href={supportQueueHref({ ...filters, clientId: null, showClosed: false })}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All clients
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{clientName}</h1>
        <p className="text-sm text-muted-foreground">
          The numbers count this client only. Their open tickets are in the list.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <Stat label="On us" value={stats.onUs} hint="we owe the next move" />
        <Stat label="Overdue" value={stats.overdue} hint="promise missed or no reply in 24h" alert={stats.overdue > 0} />
        <Stat label="To verify" value={stats.toVerify} hint="answered, awaiting a check" />
        <Stat label="Done, not told" value={stats.doneNotTold} hint="change live, client not told" alert={stats.doneNotTold > 0} />
        <Stat
          label="Promises on time"
          value={promiseRate}
          hint={`${stats.promisesOnTime30d} of ${stats.promisesClosed30d} kept on time, 30 days`}
        />
        <Stat label="Sent back" value={stats.sentBack30d} hint="answers failed verification, 30 days" />
      </div>

      <SupportClientContextPanel clientName={clientName} tickets={tickets} context={context} now={now} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium">Closed</h2>
          {filters.showClosed ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={supportQueueHref({ ...filters, showClosed: false })} scroll={false}>
                Hide closed
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={supportQueueHref({ ...filters, showClosed: true })} scroll={false}>
                Show closed
              </Link>
            </Button>
          )}
        </div>
        {!filters.showClosed ? (
          <p className="text-sm text-muted-foreground">
            Every resolved or dismissed ticket for {clientName}, newest first. Merged duplicates count as dismissed.
          </p>
        ) : closed.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No closed tickets for {clientName}
          </p>
        ) : (
          <>
            {closedTotal !== null && closedTotal > closed.length && (
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                Showing the newest {closed.length} of {closedTotal}.
              </p>
            )}
            <ul className="divide-y rounded-md border">
              {closed.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`${supportTicketPath(t.id)}${search}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <span className="font-mono text-xs text-muted-foreground">{ticketRef(t.ticket_number)}</span>
                    <span className="min-w-0 flex-1 truncate">{t.summary}</span>
                    <Badge className={SUPPORT_STATUS_BADGE[t.status]}>{supportStatusLabel(t.status)}</Badge>
                    <span className="w-24 text-right font-mono text-xs text-muted-foreground tabular-nums">
                      {timeAgo(t.resolved_at ?? t.updated_at, now)}
                    </span>
                    <span className="w-20 truncate text-right text-xs text-muted-foreground">{ownerLabel(t.assignee)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
