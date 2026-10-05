"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useOptimistic, useState, useTransition } from "react"
import { Check, ChevronDown, ChevronRight, ChevronsUpDown, Inbox } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
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
import { groupTicketsByClient, type SupportClientContext } from "@/lib/support-client-view"
import { ownerLabel, ticketPropertyLabel, timeAgo } from "@/lib/support-display"
import {
  supportQueueHref,
  type SupportClientOption,
  type SupportQueueFilters,
} from "@/lib/support-queue"
import {
  SUPPORT_ACTIVE_STATUSES,
  SUPPORT_CLOSED_STATUSES,
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
import { SupportClientContextPanel } from "./support-client-context"
import { SupportClientGroups, SupportViewToggle } from "./support-client-groups"

type SectionKey = Exclude<keyof SupportQueue, "closed">

// Open-ticket sections. The closed section depends on the client filter and
// renders separately below them.
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
]

const ALL = "all"
const UNASSIGNED = "unassigned"

export type SupportClosedView = {
  /** From the loader: what closed tickets `tickets` holds. */
  scope: "recent" | "client" | "hidden"
  /** The picked client's closed total (scope `client`), to flag the cap. */
  total: number | null
}

export function SupportQueueView({
  tickets,
  stats,
  nowIso,
  filters,
  clientOptions,
  closed,
  clientContext,
}: {
  tickets: SupportTicket[]
  stats: SupportStats
  nowIso: string
  filters: SupportQueueFilters
  clientOptions: SupportClientOption[]
  closed: SupportClosedView
  /** Set with a client picked: listings, Adjustments, latest messages */
  clientContext: SupportClientContext | null
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso])
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // The controls flip at once; the data swaps when the server render lands
  const [shownFilters, setShownFilters] = useOptimistic(filters)
  const [ownerFilter, setOwnerFilter] = useState(ALL)

  function navigate(next: SupportQueueFilters) {
    startTransition(() => {
      setShownFilters(next)
      router.replace(supportQueueHref(next), { scroll: false })
    })
  }

  const clientName = filters.clientId
    ? (clientOptions.find((c) => c.id === filters.clientId)?.name ?? "this client")
    : null

  const ownerOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const t of tickets) if (t.assignee_id) byId.set(t.assignee_id, ownerLabel(t.assignee))
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [tickets])
  // An owner picked for another client may own nothing here: fall back to everyone
  const owner =
    ownerFilter === ALL || ownerFilter === UNASSIGNED || ownerOptions.some((o) => o.id === ownerFilter)
      ? ownerFilter
      : ALL

  const visible = useMemo(
    () =>
      tickets.filter(
        (t) => owner === ALL || (owner === UNASSIGNED ? !t.assignee_id : t.assignee_id === owner)
      ),
    [tickets, owner]
  )
  const queue = useMemo(() => bucketSupportTickets(visible, now), [visible, now])
  // "By client" groups only apply across clients; a picked client has its own view
  const byClient = filters.view === "client" && !filters.clientId
  const groups = useMemo(() => (byClient ? groupTicketsByClient(visible, now) : []), [byClient, visible, now])

  const openLoaded = tickets.filter((t) => SUPPORT_ACTIVE_STATUSES.includes(t.status)).length
  const closedLoaded = tickets.filter((t) => SUPPORT_CLOSED_STATUSES.includes(t.status)).length

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
          {clientName && (
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{clientName}</span>. The numbers
              below count this client only.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {!shownFilters.clientId && (
            <SupportViewToggle value={shownFilters.view} onChange={(view) => navigate({ ...shownFilters, view })} />
          )}
          {shownFilters.clientId && (
            <div className="flex items-center gap-2">
              <Switch
                id="support-show-closed"
                checked={shownFilters.showClosed}
                onCheckedChange={(checked) => navigate({ ...shownFilters, showClosed: checked })}
              />
              <Label htmlFor="support-show-closed" className="font-normal">
                Show closed
              </Label>
            </div>
          )}
          <ClientPicker
            options={clientOptions}
            selectedId={shownFilters.clientId}
            onSelect={(clientId) =>
              // Keep the closed toggle while moving between clients
              navigate({ ...shownFilters, clientId, showClosed: clientId !== null && shownFilters.showClosed })
            }
          />
          <Select value={owner} onValueChange={setOwnerFilter}>
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

      <div
        className={cn("space-y-6 transition-opacity", isPending && "opacity-60")}
        aria-busy={isPending}
      >
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

        {!clientName && tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
            <Inbox className="size-6" />
            <p className="font-medium text-foreground">No tickets yet</p>
            <p className="max-w-md">
              The capture bot opens a ticket for each client ask in Assembly. They&apos;ll show up here as
              messages come in.
            </p>
          </div>
        ) : (
          <>
            {clientName && clientContext && (
              <SupportClientContextPanel clientName={clientName} tickets={tickets} context={clientContext} now={now} />
            )}
            {clientName && openLoaded === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <Inbox className="size-6" />
                <p className="font-medium text-foreground">No open tickets for {clientName}</p>
              </div>
            ) : byClient ? (
              <SupportClientGroups
                groups={groups}
                now={now}
                renderTicket={(t) => <TicketRow key={t.id} ticket={t} now={now} closed={false} hideClient />}
              />
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
                    closed={false}
                  />
                )
              })
            )}
            {closed.scope === "hidden" ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <span>Closed tickets for {clientName} are hidden.</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate({ ...filters, showClosed: true })}
                >
                  Show closed
                </Button>
              </div>
            ) : (
              <QueueSection
                title={closed.scope === "client" ? "Closed" : "Recently closed"}
                description={
                  closed.scope === "client"
                    ? `Every resolved or dismissed ticket for ${clientName}, newest first. Merged duplicates count as dismissed.`
                    : "Resolved or dismissed in the last 30 days."
                }
                note={
                  closed.scope === "client" && closed.total !== null && closed.total > closedLoaded
                    ? `Showing the newest ${closedLoaded} of ${closed.total}.`
                    : undefined
                }
                tickets={queue.closed}
                now={now}
                collapsedLimit={closed.scope === "client" ? undefined : 5}
                closed
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ClientPicker({
  options,
  selectedId,
  onSelect,
}: {
  options: SupportClientOption[]
  selectedId: string | null
  onSelect: (clientId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((c) => c.id === selectedId)
  const totalOpen = options.reduce((sum, c) => sum + c.openCount, 0)

  function pick(clientId: string | null) {
    setOpen(false)
    if (clientId !== selectedId) onSelect(clientId)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Filter by client"
          className="w-56 justify-between font-normal"
        >
          <span className="truncate">
            {!selectedId ? "All clients" : (selected?.name ?? "Unknown client")}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search clients…" />
          <CommandList>
            <CommandEmpty>No clients found.</CommandEmpty>
            <CommandGroup>
              {/* cmdk filters on `value`, so items carry the client name */}
              <CommandItem value="All clients" onSelect={() => pick(null)} className="[&>svg:last-child]:hidden">
                <Check className={cn("size-3.5", selectedId ? "opacity-0" : "opacity-100")} />
                <span>All clients</span>
                <OpenCount count={totalOpen} />
              </CommandItem>
              {options.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.name}
                  onSelect={() => pick(c.id)}
                  className="[&>svg:last-child]:hidden"
                >
                  <Check className={cn("size-3.5", c.id === selectedId ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{c.name}</span>
                  {c.status !== "active" && (
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">{c.status}</span>
                  )}
                  <OpenCount count={c.openCount} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function OpenCount({ count }: { count: number }) {
  return (
    <span
      className={cn(
        "ml-auto shrink-0 font-mono text-xs font-normal tabular-nums",
        count > 0 ? "text-foreground" : "text-muted-foreground"
      )}
      aria-label={`${count} open`}
      title={`${count} open`}
    >
      {count}
    </span>
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
  note,
  tone,
  tickets,
  now,
  collapsedLimit,
  closed,
}: {
  title: string
  description: string
  /** Extra line under the heading, e.g. that a list is capped */
  note?: string
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
      {note && <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{note}</p>}
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

function TicketRow({
  ticket: t,
  now,
  closed,
  hideClient = false,
}: {
  ticket: SupportTicket
  now: Date
  closed: boolean
  /** Inside a client's group: the property cell drops the client name */
  hideClient?: boolean
}) {
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
        {!hideClient && (
          <Link
            href={supportQueueHref({ clientId: t.client_id, showClosed: false, view: "status" })}
            className="block font-medium hover:underline"
            title="Show this client's tickets"
          >
            {t.clients?.name ?? "Unknown client"}
          </Link>
        )}
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
