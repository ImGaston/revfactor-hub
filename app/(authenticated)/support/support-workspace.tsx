"use client"

import { usePathname } from "next/navigation"
import { useMemo } from "react"
import { Inbox, Keyboard, Radio } from "lucide-react"

import { timeAgo } from "@/lib/support-display"
import type { SupportStats, SupportTicket } from "@/lib/support-tickets"
import { queueViews } from "@/lib/support-workflow"
import { cn } from "@/lib/utils"
import { TicketList } from "./ticket-list"

export function SupportWorkspace({
  tickets,
  stats,
  currentUserId,
  lastCaptureAt,
  nowIso,
  children,
}: {
  tickets: SupportTicket[]
  stats: SupportStats
  currentUserId: string | null
  lastCaptureAt: string | null
  nowIso: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const selectedId = pathname.startsWith("/support/") ? pathname.split("/")[2] : null
  const now = useMemo(() => new Date(nowIso), [nowIso])
  const views = useMemo(() => queueViews(tickets, currentUserId, now), [tickets, currentUserId, now])

  return (
    <div className="-m-6 flex h-[calc(100svh-var(--topbar-h))] min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "min-h-0 w-full flex-col border-r bg-muted/30 lg:flex lg:w-80 lg:shrink-0",
            selectedId ? "hidden" : "flex"
          )}
        >
          <TicketList views={views} selectedId={selectedId} now={now} />
        </aside>
        <section className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", !selectedId && "hidden lg:block")}>
          {selectedId ? children : <SupportOverview stats={stats} empty={tickets.length === 0} triage={views.triage.length} />}
        </section>
      </div>
      <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Radio className="size-3.5" aria-hidden />
          {lastCaptureAt ? `Capture bot: last message ${timeAgo(lastCaptureAt, now)}` : "Capture bot: no messages yet"}
        </span>
        <span>
          On us {stats.onUs} · Overdue {stats.overdue} · Triage {views.triage.length} · To verify {stats.toVerify}
        </span>
        <span className="ml-auto hidden items-center gap-1.5 lg:flex">
          <Keyboard className="size-3.5" aria-hidden />j / k next or previous ticket
        </span>
      </footer>
    </div>
  )
}

function SupportOverview({ stats, empty, triage }: { stats: SupportStats; empty: boolean; triage: number }) {
  const promiseRate = stats.promiseOnTimeRate === null ? "—" : `${Math.round(stats.promiseOnTimeRate * 100)}%`
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
        <p className="text-sm text-muted-foreground">
          Every client ask, tracked until it&apos;s answered, verified, and confirmed back to the client.
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
        <Stat label="Backlog open" value={stats.backlogOpen} hint={`${stats.backlogCleared} cleared so far`} />
      </div>
      {empty ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          <Inbox className="size-6" aria-hidden />
          <p className="font-medium text-foreground">No tickets yet</p>
          <p className="max-w-md">The capture bot opens a ticket for each client ask in Assembly.</p>
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {triage > 0
            ? `Start with Needs triage (${triage}): pick the property and an owner, then accept each ticket into the queue.`
            : "Pick a ticket from the list to work it."}{" "}
          Use j and k to move between tickets.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, hint, alert = false }: { label: string; value: number | string; hint: string; alert?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border bg-card p-3",
        alert && "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
      )}
    >
      <span className={cn("text-xs text-muted-foreground", alert && "text-red-700 dark:text-red-300")}>{label}</span>
      <span className={cn("font-mono text-2xl font-medium tabular-nums", alert && "text-red-700 dark:text-red-300")}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}
