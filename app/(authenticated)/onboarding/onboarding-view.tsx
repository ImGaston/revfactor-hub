"use client"

import { useMemo, useState } from "react"
import {
  LayoutGrid,
  Table as TableIcon,
  Search,
  ArrowUp,
  ArrowDown,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ClientStepperCard } from "./client-stepper-card"
import { OnboardingTable } from "./onboarding-table"
import { ResourceCard } from "./resource-card"
import { cn } from "@/lib/utils"
import type {
  OnboardingTemplate,
  OnboardingProgress,
  OnboardingResource,
} from "@/lib/types"

type ClientRow = {
  id: string
  name: string
  email: string | null
  status: string
  onboarding_date: string | null
  commentCount: number
}

type Props = {
  clients: ClientRow[]
  templates: OnboardingTemplate[]
  progress: OnboardingProgress[]
  resources: OnboardingResource[]
  currentUserId: string | null
}

type SortKey = "name" | "progress" | "start_date" | "comments"
type ProgressFilter = "all" | "not_started" | "in_progress" | "completed"

export function OnboardingView({
  clients,
  templates,
  progress,
  resources,
  currentUserId,
}: Props) {
  const [view, setView] = useState<"cards" | "table">("table")
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all")

  // Compute completion % per client
  const pctByClient = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of clients) {
      const total = templates.length
      if (total === 0) {
        map.set(c.id, 0)
        continue
      }
      const done = progress.filter(
        (p) => p.client_id === c.id && p.is_completed
      ).length
      map.set(c.id, Math.round((done / total) * 100))
    }
    return map
  }, [clients, templates, progress])

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = clients.filter((c) => {
      if (q) {
        const hay = `${c.name} ${c.email ?? ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      const pct = pctByClient.get(c.id) ?? 0
      if (progressFilter === "not_started" && pct > 0) return false
      if (progressFilter === "in_progress" && (pct === 0 || pct === 100))
        return false
      if (progressFilter === "completed" && pct < 100) return false
      return true
    })

    const dir = sortDir === "asc" ? 1 : -1
    filtered.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir
      if (sortKey === "progress") {
        const pa = pctByClient.get(a.id) ?? 0
        const pb = pctByClient.get(b.id) ?? 0
        return (pa - pb) * dir
      }
      if (sortKey === "comments") {
        return (a.commentCount - b.commentCount) * dir
      }
      // start_date
      const da = a.onboarding_date ? Date.parse(a.onboarding_date) : 0
      const db = b.onboarding_date ? Date.parse(b.onboarding_date) : 0
      return (da - db) * dir
    })
    return filtered
  }, [clients, pctByClient, search, sortKey, sortDir, progressFilter])

  const counts = useMemo(() => {
    let notStarted = 0
    let inProgress = 0
    let completed = 0
    for (const c of clients) {
      const pct = pctByClient.get(c.id) ?? 0
      if (pct === 0) notStarted++
      else if (pct === 100) completed++
      else inProgress++
    }
    return { notStarted, inProgress, completed, all: clients.length }
  }, [clients, pctByClient])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {clients.length === 0
              ? "No clients currently onboarding."
              : `${filteredSorted.length} of ${clients.length} client${clients.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center rounded-md border p-0.5">
          <button
            onClick={() => setView("cards")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm font-medium transition-colors",
              view === "cards"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <LayoutGrid className="size-4" />
            Cards
          </button>
          <button
            onClick={() => setView("table")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm font-medium transition-colors",
              view === "table"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <TableIcon className="size-4" />
            Table
          </button>
        </div>
      </div>

      {/* Toolbar */}
      {clients.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex gap-1.5">
            {(
              [
                ["all", "All", counts.all],
                ["not_started", "Not started", counts.notStarted],
                ["in_progress", "In progress", counts.inProgress],
                ["completed", "Completed", counts.completed],
              ] as [ProgressFilter, string, number][]
            ).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setProgressFilter(key)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                  progressFilter === key
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-transparent bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
                <span className="text-[10px] opacity-60">{count}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <Select
              value={sortKey}
              onValueChange={(v) => setSortKey(v as SortKey)}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort: Name</SelectItem>
                <SelectItem value="progress">Sort: Progress %</SelectItem>
                <SelectItem value="start_date">Sort: Start date</SelectItem>
                <SelectItem value="comments">Sort: Comments</SelectItem>
              </SelectContent>
            </Select>
            <button
              onClick={() =>
                setSortDir((d) => (d === "asc" ? "desc" : "asc"))
              }
              className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted transition-colors"
              title={sortDir === "asc" ? "Ascending" : "Descending"}
            >
              {sortDir === "asc" ? (
                <ArrowUp className="size-4" />
              ) : (
                <ArrowDown className="size-4" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      {clients.length > 0 && templates.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No onboarding steps configured. Go to Settings &rarr; Onboarding to
            create steps.
          </p>
        </div>
      )}

      {clients.length > 0 && templates.length > 0 && (
        <>
          {view === "cards" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSorted.map((client) => {
                  const clientProgress = progress.filter(
                    (p) => p.client_id === client.id
                  )
                  return (
                    <ClientStepperCard
                      key={client.id}
                      client={client}
                      templates={templates}
                      progress={clientProgress}
                      currentUserId={currentUserId}
                    />
                  )
                })}
              </div>
              {filteredSorted.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No clients match your filters.
                </p>
              )}
            </>
          ) : (
            <OnboardingTable
              clients={filteredSorted}
              templates={templates}
              progress={progress}
              currentUserId={currentUserId}
            />
          )}
        </>
      )}

      {/* Resources */}
      {resources.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Resources</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
