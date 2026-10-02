"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ownerLabel } from "@/lib/support-display"
import {
  SUPPORT_PRIORITY_BADGE,
  dueState,
  nextDueAt,
  relativeDueLabel,
  supportTicketPath,
  ticketRef,
  type SupportTicket,
} from "@/lib/support-tickets"
import {
  SUPPORT_QUEUE_VIEWS,
  defaultQueueView,
  matchesTicketSearch,
  type SupportQueueView,
} from "@/lib/support-workflow"
import { cn } from "@/lib/utils"

const VIEW_STORAGE_KEY = "support-queue-view"

export function TicketList({
  views,
  selectedId,
  now,
}: {
  views: Record<SupportQueueView, SupportTicket[]>
  selectedId: string | null
  now: Date
}) {
  const router = useRouter()
  const [view, setView] = useState<SupportQueueView>(() => defaultQueueView(views))
  const [query, setQuery] = useState("")

  // Remember the last view for this browser tab (a convenience only)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(VIEW_STORAGE_KEY)
      if (saved && SUPPORT_QUEUE_VIEWS.some((v) => v.key === saved)) setView(saved as SupportQueueView)
    } catch {
      /* storage unavailable */
    }
  }, [])
  const chooseView = (next: SupportQueueView) => {
    setView(next)
    try {
      sessionStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      /* storage unavailable */
    }
  }

  // Search looks across every queue; otherwise the chosen view
  const visible = useMemo(() => {
    if (!query.trim()) return views[view]
    const all = new Map<string, SupportTicket>()
    for (const list of Object.values(views)) for (const t of list) all.set(t.id, t)
    return [...all.values()].filter((t) => matchesTicketSearch(t, query))
  }, [views, view, query])

  // j / k move through the visible list
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== "j" && event.key !== "k") return
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return
      if (!visible.length) return
      const index = visible.findIndex((t) => t.id === selectedId)
      const next =
        index === -1 ? 0 : event.key === "j" ? Math.min(index + 1, visible.length - 1) : Math.max(index - 1, 0)
      if (visible[next] && visible[next].id !== selectedId) {
        event.preventDefault()
        router.push(supportTicketPath(visible[next].id))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [visible, selectedId, router])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Client, #ticket, owner"
            aria-label="Search tickets"
            className="pl-8"
          />
        </div>
        <nav aria-label="Queues" className="grid grid-cols-2 gap-1 lg:grid-cols-1">
          {SUPPORT_QUEUE_VIEWS.map((v) => {
            const count = views[v.key].length
            const active = !query.trim() && view === v.key
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => {
                  setQuery("")
                  chooseView(v.key)
                }}
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
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" aria-label="Tickets">
        {visible.length === 0 ? (
          <li className="p-4 text-center text-sm text-muted-foreground">
            {query.trim() ? "No tickets match" : "Nothing here"}
          </li>
        ) : (
          visible.map((t) => <TicketRow key={t.id} ticket={t} selected={t.id === selectedId} now={now} />)
        )}
      </ul>
    </div>
  )
}

function TicketRow({ ticket: t, selected, now }: { ticket: SupportTicket; selected: boolean; now: Date }) {
  const closed = t.status === "resolved" || t.status === "dismissed"
  const due = nextDueAt(t)
  const state = dueState(due, now)
  return (
    <li>
      <Link
        href={supportTicketPath(t.id)}
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
              "font-mono text-xs tabular-nums text-muted-foreground",
              !closed && state === "overdue" && "font-medium text-red-700 dark:text-red-300",
              !closed && state === "due_soon" && "text-amber-700 dark:text-amber-300"
            )}
          >
            {closed ? (t.status === "resolved" ? "Resolved" : "Dismissed") : relativeDueLabel(due, now)}
          </span>
        </span>
        <span className="block truncate font-medium">{t.clients?.name ?? "Unknown client"}</span>
        <span className="line-clamp-2 block text-muted-foreground">{t.summary}</span>
        <span className="flex flex-wrap items-center gap-1 pt-0.5">
          {(t.priority === "urgent" || t.priority === "high") && (
            <Badge className={cn("h-5 px-1.5 text-[11px]", SUPPORT_PRIORITY_BADGE[t.priority])}>
              {t.priority === "urgent" ? "Urgent" : "High"}
            </Badge>
          )}
          {t.client_chase_count > 0 && (
            <Badge className={cn("h-5 px-1.5 text-[11px]", SUPPORT_PRIORITY_BADGE.urgent)}>
              Chased ×{t.client_chase_count}
            </Badge>
          )}
          {t.request_type === "check_in" && (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
              Check-in
            </Badge>
          )}
          {!closed && t.suggested_reply_generated_at && (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
              Draft
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{ownerLabel(t.assignee)}</span>
        </span>
      </Link>
    </li>
  )
}
