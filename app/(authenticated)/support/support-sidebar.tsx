"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { groupTicketsByClient } from "@/lib/support-client-view"
import { ownerLabel } from "@/lib/support-display"
import {
  supportQueueHref,
  supportQueueSearch,
  type SupportClientOption,
  type SupportQueueFilters,
} from "@/lib/support-queue"
import {
  SUPPORT_ACTIVE_STATUSES,
  SUPPORT_CLOSED_STATUSES,
  SUPPORT_PRIORITY_BADGE,
  bucketSupportTickets,
  dueState,
  nextDueAt,
  relativeDueLabel,
  supportTicketPath,
  ticketRef,
  type SupportTicket,
} from "@/lib/support-tickets"
import {
  SUPPORT_STATUS_VIEWS,
  defaultStatusView,
  isStatusView,
  matchesTicketSearch,
  statusViews,
  type SupportStatusView,
} from "@/lib/support-workspace"
import { cn } from "@/lib/utils"
import { SupportViewToggle } from "./support-view-toggle"

const ALL = "all"
const UNASSIGNED = "unassigned"
const VIEW_STORAGE_KEY = "support-status-view"

const ALERT_CHIP = "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
const WARN_CHIP = "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"

export function SupportSidebar({
  tickets,
  clientOptions,
  currentUserId,
  filters: urlFilters,
  selectedId,
  now,
}: {
  tickets: SupportTicket[]
  clientOptions: SupportClientOption[]
  currentUserId: string | null
  filters: SupportQueueFilters
  selectedId: string | null
  now: Date
}) {
  const router = useRouter()
  const pathname = usePathname()
  // A ticket opened from elsewhere (no ?client=) in By client: show its client's tickets
  const openedClientId =
    !urlFilters.clientId && urlFilters.view === "client" && selectedId
      ? (tickets.find((t) => t.id === selectedId)?.client_id ?? null)
      : null
  const filters = useMemo(
    () => (openedClientId ? { ...urlFilters, clientId: openedClientId } : urlFilters),
    [urlFilters, openedClientId]
  )
  const [query, setQuery] = useState("")
  const [owner, setOwner] = useState(ALL)

  // Owner filter first; a picked client narrows everything below it
  const scoped = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (owner === ALL || (owner === UNASSIGNED ? !t.assignee_id : t.assignee_id === owner)) &&
          (!filters.clientId || t.client_id === filters.clientId)
      ),
    [tickets, owner, filters.clientId]
  )
  const views = useMemo(() => statusViews(scoped, currentUserId, now), [scoped, currentUserId, now])
  const [statusView, setStatusView] = useState<SupportStatusView>(() => defaultStatusView(views))
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(VIEW_STORAGE_KEY)
      if (isStatusView(saved)) setStatusView(saved)
    } catch {
      /* storage unavailable */
    }
  }, [])
  const chooseStatusView = (next: SupportStatusView) => {
    setStatusView(next)
    setQuery("")
    try {
      sessionStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      /* storage unavailable */
    }
  }

  const ownerOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const t of tickets) if (t.assignee_id) byId.set(t.assignee_id, ownerLabel(t.assignee))
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [tickets])

  const clientName = filters.clientId
    ? (clientOptions.find((c) => c.id === filters.clientId)?.name ??
      tickets.find((t) => t.client_id === filters.clientId)?.clients?.name ??
      "This client")
    : null
  const byClient = filters.view === "client"
  const searching = query.trim().length > 0

  // The ticket list on screen (also what j / k walk through)
  const visibleTickets = useMemo(() => {
    if (searching) return scoped.filter((t) => matchesTicketSearch(t, query))
    if (byClient && !filters.clientId) return []
    if (byClient) {
      const open = scoped.filter((t) => SUPPORT_ACTIVE_STATUSES.includes(t.status))
      const q = bucketSupportTickets(open, now)
      return [...q.triage, ...q.overdue, ...q.verify, ...q.onUs, ...q.onClient]
    }
    return views[statusView]
  }, [searching, scoped, query, byClient, filters.clientId, views, statusView, now])

  const groups = useMemo(
    () =>
      byClient && !filters.clientId && !searching
        ? groupTicketsByClient(
            scoped.filter((t) => SUPPORT_ACTIVE_STATUSES.includes(t.status)),
            now
          )
        : [],
    [byClient, filters.clientId, searching, scoped, now]
  )
  const matchingClients = useMemo(() => {
    if (!searching || filters.clientId) return []
    const q = query.trim().toLowerCase()
    return clientOptions.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8)
  }, [searching, filters.clientId, query, clientOptions])

  const search = supportQueueSearch(filters)
  const ticketHref = (id: string) => `${supportTicketPath(id)}${search}`
  const pickClient = (clientId: string | null) =>
    router.push(supportQueueHref({ ...filters, clientId, showClosed: false }))
  const setMode = (view: SupportQueueFilters["view"]) =>
    router.replace(`${pathname}${supportQueueSearch({ ...filters, view })}`, { scroll: false })

  // j / k move through the visible tickets
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== "j" && event.key !== "k") return
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=listbox]")) return
      if (!visibleTickets.length) return
      const index = visibleTickets.findIndex((t) => t.id === selectedId)
      const next =
        index === -1 ? 0 : event.key === "j" ? Math.min(index + 1, visibleTickets.length - 1) : Math.max(index - 1, 0)
      const ticket = visibleTickets[next]
      if (ticket && ticket.id !== selectedId) {
        event.preventDefault()
        router.push(ticketHref(ticket.id))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // ticketHref only depends on `search`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTickets, selectedId, router, search])

  const closedForClient = filters.clientId
    ? tickets.filter((t) => t.client_id === filters.clientId && SUPPORT_CLOSED_STATUSES.includes(t.status)).length
    : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <SupportViewToggle value={filters.view} onChange={setMode} />
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label="Filter by owner">
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
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={filters.clientId ? "Search this client's tickets" : "Client, #ticket, owner"}
            aria-label="Search tickets"
            className="pl-8"
          />
        </div>
        {filters.clientId && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <Link
              href={supportQueueHref({ ...filters, clientId: null, showClosed: false })}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              All clients
            </Link>
            <Link
              href={supportQueueHref({ ...filters, showClosed: false })}
              className="truncate font-medium hover:underline"
              aria-current={!selectedId ? "page" : undefined}
            >
              {clientName}
            </Link>
          </div>
        )}
        {!byClient && !searching && (
          <nav aria-label="Queues" className="grid grid-cols-2 gap-1 lg:grid-cols-1">
            {SUPPORT_STATUS_VIEWS.map((v) => {
              const count = views[v.key].length
              const active = statusView === v.key
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => chooseStatusView(v.key)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2 py-1 text-left text-sm hover:bg-accent",
                    active && "bg-accent font-medium",
                    "tone" in v && v.tone === "danger" && count > 0 && "text-red-700 dark:text-red-300",
                    "tone" in v && v.tone === "warning" && count > 0 && "text-amber-700 dark:text-amber-300"
                  )}
                >
                  <span>{v.label}</span>
                  <span className="font-mono text-xs tabular-nums">{count}</span>
                </button>
              )
            })}
          </nav>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {matchingClients.length > 0 && (
          <div className="space-y-1 pb-2">
            <p className="px-1 text-xs text-muted-foreground">Clients</p>
            {matchingClients.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setQuery("")
                  pickClient(c.id)
                }}
                className="flex w-full items-center justify-between rounded-md bg-background px-2.5 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">{c.name}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{c.openCount} open</span>
              </button>
            ))}
          </div>
        )}

        {groups.length > 0 && (
          <ul className="space-y-1" aria-label="Clients with open tickets">
            {groups.map((g) => (
              <li key={g.clientId}>
                <button
                  type="button"
                  onClick={() => pickClient(g.clientId)}
                  className="block w-full space-y-1 rounded-md border border-transparent bg-background px-2.5 py-2 text-left text-sm hover:border-border"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{g.clientName}</span>
                    <span className="font-mono text-xs tabular-nums">{g.open} open</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    {g.overdue > 0 && <Badge className={cn("h-5 px-1.5 text-[11px]", ALERT_CHIP)}>{g.overdue} overdue</Badge>}
                    {g.triage > 0 && <Badge className={cn("h-5 px-1.5 text-[11px]", WARN_CHIP)}>{g.triage} triage</Badge>}
                    {g.awaitingClient > 0 && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                        {g.awaitingClient} waiting on them
                      </Badge>
                    )}
                    <span className="ml-auto truncate text-xs text-muted-foreground">{g.owners.join(", ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {(searching || !byClient || filters.clientId) && (
          <ul className="space-y-1" aria-label="Tickets">
            {visibleTickets.length === 0 ? (
              <li className="p-4 text-center text-sm text-muted-foreground">
                {searching ? "No tickets match" : filters.clientId ? "No open tickets for this client" : "Nothing here"}
              </li>
            ) : (
              visibleTickets.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  href={ticketHref(t.id)}
                  selected={t.id === selectedId}
                  showClient={!filters.clientId}
                  now={now}
                />
              ))
            )}
          </ul>
        )}

        {byClient && !filters.clientId && !searching && groups.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">No open tickets</p>
        )}

        {filters.clientId && !searching && (
          <Link
            href={supportQueueHref({ ...filters, showClosed: true })}
            className="block px-2 py-2 text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Closed tickets{closedForClient ? ` (${closedForClient} in the last 30 days)` : ""}
          </Link>
        )}
      </div>
    </div>
  )
}

function TicketRow({
  ticket: t,
  href,
  selected,
  showClient,
  now,
}: {
  ticket: SupportTicket
  href: string
  selected: boolean
  showClient: boolean
  now: Date
}) {
  const closed = SUPPORT_CLOSED_STATUSES.includes(t.status)
  const due = nextDueAt(t)
  const state = dueState(due, now)
  return (
    <li>
      <Link
        href={href}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "block space-y-0.5 rounded-md border border-transparent bg-background px-2.5 py-2 text-sm hover:border-border",
          selected && "border-primary/40 ring-1 ring-primary/20"
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted-foreground">{ticketRef(t.ticket_number)}</span>
          <span
            className={cn(
              "font-mono text-xs text-muted-foreground tabular-nums",
              !closed && state === "overdue" && "font-medium text-red-700 dark:text-red-300",
              !closed && state === "due_soon" && "text-amber-700 dark:text-amber-300"
            )}
          >
            {closed ? (t.status === "resolved" ? "Resolved" : "Dismissed") : t.status === "new" ? "Triage" : relativeDueLabel(due, now)}
          </span>
        </span>
        {showClient && <span className="block truncate font-medium">{t.clients?.name ?? "Unknown client"}</span>}
        <span className={cn("line-clamp-2 block", showClient ? "text-muted-foreground" : "font-medium")}>{t.summary}</span>
        <span className="flex flex-wrap items-center gap-1 pt-0.5">
          {(t.priority === "urgent" || t.priority === "high") && (
            <Badge className={cn("h-5 px-1.5 text-[11px]", SUPPORT_PRIORITY_BADGE[t.priority])}>
              {t.priority === "urgent" ? "Urgent" : "High"}
            </Badge>
          )}
          {t.status === "answered" && (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
              To verify
            </Badge>
          )}
          {t.client_chase_count > 0 && (
            <Badge className={cn("h-5 px-1.5 text-[11px]", SUPPORT_PRIORITY_BADGE.urgent)}>Chased ×{t.client_chase_count}</Badge>
          )}
          {t.request_type === "check_in" && (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
              Check-in
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{ownerLabel(t.assignee)}</span>
        </span>
      </Link>
    </li>
  )
}
