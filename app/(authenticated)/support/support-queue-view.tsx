"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Inbox } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ownerLabel, ticketPropertyLabel, timeAgo } from "@/lib/support-display"
import {
  SUPPORT_PRIORITY_BADGE,
  SUPPORT_SENTIMENT_BADGE,
  SUPPORT_STATUS_BADGE,
  SUPPORT_VERDICT_BADGE,
  bucketSupportTickets,
  dueState,
  isDoneNotTold,
  nextDueAt,
  relativeDueLabel,
  supportCategoryLabel,
  supportTicketPath,
  supportRequestTypeLabel,
  supportStatusLabel,
  ticketRef,
  type SupportQueue,
  type SupportStats,
  type SupportTicket,
} from "@/lib/support-tickets"
import { cn } from "@/lib/utils"

type SectionKey = keyof SupportQueue

const SECTIONS: {
  key: SectionKey
  title: string
  description: string
  hideWhenEmpty?: boolean
  tone?: "alert"
  collapsedLimit?: number
}[] = [
  {
    key: "triage",
    title: "Needs triage",
    description: "The bot wasn't sure. A person confirms the category and property.",
    hideWhenEmpty: true,
  },
  {
    key: "overdue",
    title: "Overdue",
    description: "A promise passed its date, the client waited over 24h, or a change is live but the client wasn't told.",
    hideWhenEmpty: true,
    tone: "alert",
  },
  { key: "verify", title: "Ready to verify", description: "Answered. Check it before it counts as done." },
  { key: "onUs", title: "Waiting on us", description: "Open and in progress, next due first." },
  { key: "onClient", title: "Waiting on client", description: "We asked the client for something." },
  {
    key: "closed",
    title: "Recently closed",
    description: "Resolved or dismissed in the last 30 days.",
    collapsedLimit: 5,
  },
]

const ALL = "all"
const UNASSIGNED = "unassigned"

export function SupportQueueView({
  tickets,
  stats,
  nowIso,
}: {
  tickets: SupportTicket[]
  stats: SupportStats
  nowIso: string
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso])
  const [clientFilter, setClientFilter] = useState(ALL)
  const [ownerFilter, setOwnerFilter] = useState(ALL)

  const clientOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const t of tickets) if (t.clients?.name) byId.set(t.client_id, t.clients.name)
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [tickets])

  const ownerOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const t of tickets) if (t.assignee_id) byId.set(t.assignee_id, ownerLabel(t.assignee))
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [tickets])

  const queue = useMemo(() => {
    const visible = tickets.filter(
      (t) =>
        (clientFilter === ALL || t.client_id === clientFilter) &&
        (ownerFilter === ALL ||
          (ownerFilter === UNASSIGNED ? !t.assignee_id : t.assignee_id === ownerFilter))
    )
    return bucketSupportTickets(visible, now)
  }, [tickets, clientFilter, ownerFilter, now])

  const promiseRate =
    stats.promiseOnTimeRate === null ? "—" : `${Math.round(stats.promiseOnTimeRate * 100)}%`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
          <p className="text-sm text-muted-foreground">
            Every client ask, tracked until it&apos;s answered, verified, and confirmed back to the client.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-48" aria-label="Filter by client">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All clients</SelectItem>
              {clientOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-40" aria-label="Filter by owner">
              <SelectValue placeholder="Everyone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Everyone</SelectItem>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {ownerOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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

      {tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          <Inbox className="size-6" />
          <p className="font-medium text-foreground">No tickets yet</p>
          <p className="max-w-md">
            The capture bot opens a ticket for each client ask in Assembly. They&apos;ll show up here as
            messages come in.
          </p>
        </div>
      ) : (
        SECTIONS.map((section) => {
          const items = queue[section.key]
          if (section.hideWhenEmpty && items.length === 0) return null
          return (
            <QueueSection
              key={section.key}
              title={section.title}
              description={section.description}
              tone={section.tone}
              tickets={items}
              now={now}
              collapsedLimit={section.collapsedLimit}
              closed={section.key === "closed"}
            />
          )
        })
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  alert = false,
}: {
  label: string
  value: number | string
  hint: string
  alert?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border bg-card p-3",
        alert && "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
      )}
    >
      <span className={cn("text-xs text-muted-foreground", alert && "text-red-700 dark:text-red-300")}>
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-2xl font-medium tabular-nums",
          alert && "text-red-700 dark:text-red-300"
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

function QueueSection({
  title,
  description,
  tone,
  tickets,
  now,
  collapsedLimit,
  closed,
}: {
  title: string
  description: string
  tone?: "alert"
  tickets: SupportTicket[]
  now: Date
  collapsedLimit?: number
  closed: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const limited = collapsedLimit !== undefined && !expanded
  const visible = limited ? tickets.slice(0, collapsedLimit) : tickets
  const hidden = tickets.length - visible.length

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className={cn("text-lg font-medium", tone === "alert" && "text-red-700 dark:text-red-300")}>
          {title}
        </h2>
        <Badge variant="secondary">{tickets.length}</Badge>
        <span className="text-sm text-muted-foreground">{description}</span>
      </div>
      {tickets.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Nothing here
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Ref</TableHead>
                <TableHead>Ask</TableHead>
                <TableHead>Client · property</TableHead>
                <TableHead className="w-32">{closed ? "Closed" : "Next due"}</TableHead>
                <TableHead className="w-40">Status</TableHead>
                <TableHead className="w-24">Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((t) => (
                <TicketRow key={t.id} ticket={t} now={now} closed={closed} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="size-4" />
          Show {hidden} more
        </button>
      )}
      {collapsedLimit !== undefined && expanded && tickets.length > collapsedLimit && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="size-4" />
          Show fewer
        </button>
      )}
    </section>
  )
}

function TicketRow({ ticket: t, now, closed }: { ticket: SupportTicket; now: Date; closed: boolean }) {
  const due = nextDueAt(t)
  const state = dueState(due, now)
  const doneNotTold = isDoneNotTold(t)
  const href = supportTicketPath(t.id)

  return (
    <TableRow className="cursor-pointer">
      <TableCell className="font-mono text-xs text-muted-foreground">
        <Link href={href} className="hover:underline">
          {ticketRef(t.ticket_number)}
        </Link>
      </TableCell>
      <TableCell className="whitespace-normal">
        <Link href={href} className="block min-w-0 space-y-1">
          <span className="block font-medium wrap-anywhere">{t.summary}</span>
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="font-normal">
              {supportCategoryLabel(t.category)}
            </Badge>
            <Badge variant="secondary" className="font-normal">
              {supportRequestTypeLabel(t.request_type)}
            </Badge>
            {(t.priority === "urgent" || t.priority === "high") && (
              <Badge className={SUPPORT_PRIORITY_BADGE[t.priority]}>
                {t.priority === "urgent" ? "Urgent" : "High"}
              </Badge>
            )}
            {t.client_sentiment !== "neutral" && (
              <Badge className={SUPPORT_SENTIMENT_BADGE[t.client_sentiment]}>
                {t.client_sentiment === "unhappy" ? "Unhappy" : "Concerned"}
              </Badge>
            )}
            {t.client_chase_count > 0 && (
              <Badge className={SUPPORT_PRIORITY_BADGE.urgent}>Chased ×{t.client_chase_count}</Badge>
            )}
            {!closed && t.answer_check_verdict === "fail" && (
              <Badge className={SUPPORT_VERDICT_BADGE.fail}>Answer check failed</Badge>
            )}
            {!closed && doneNotTold && (
              <Badge className={SUPPORT_VERDICT_BADGE.uncertain}>Done, not told</Badge>
            )}
            {t.possible_duplicate_of && <Badge variant="outline">Possible duplicate</Badge>}
            {t.hand_managed && <Badge variant="outline">Hand-managed</Badge>}
            {t.backfilled && <Badge variant="outline">Backlog</Badge>}
            {!closed && t.suggested_reply_generated_at && <Badge variant="outline">Draft reply</Badge>}
          </span>
        </Link>
      </TableCell>
      <TableCell className="whitespace-normal text-sm">
        <span className="block font-medium">{t.clients?.name ?? "Unknown client"}</span>
        <span className="block text-muted-foreground wrap-anywhere">{ticketPropertyLabel(t)}</span>
      </TableCell>
      <TableCell
        className={cn(
          "font-mono text-xs tabular-nums",
          !closed && state === "overdue" && "font-medium text-red-700 dark:text-red-300",
          !closed && state === "due_soon" && "text-amber-700 dark:text-amber-300",
          (closed || state === "none") && "text-muted-foreground"
        )}
      >
        {closed ? timeAgo(t.resolved_at ?? t.updated_at, now) : relativeDueLabel(due, now)}
      </TableCell>
      <TableCell>
        <Badge className={SUPPORT_STATUS_BADGE[t.status]}>{supportStatusLabel(t.status)}</Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{ownerLabel(t.assignee)}</TableCell>
    </TableRow>
  )
}
