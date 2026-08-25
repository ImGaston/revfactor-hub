"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, Play, RefreshCw, Search, Trophy } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import { cn } from "@/lib/utils"
import {
  REASON_CODE_LABELS,
  daysBetween,
  type WinCandidate,
  type WinCategory,
  type WinDetectionRun,
} from "@/lib/wins"
import { formatCurrency, formatPercent } from "@/lib/wins-message"

import { runWinsDetectionAction } from "./actions"
import { WinDetailDrawer } from "./win-detail-drawer"

const CATEGORY_META: Record<
  WinCategory,
  { label: string; accent: string; badge: string }
> = {
  double_win: {
    label: "Double Win",
    accent: "border-l-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  yoy_positive_steady: {
    label: "YoY+ Steady",
    accent: "border-l-sky-500",
    badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  market_compass_candidate: {
    label: "Market Compass",
    accent: "border-l-violet-500",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  conflicting_signal: {
    label: "Conflicting",
    accent: "border-l-amber-500",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  insufficient_data: {
    label: "Insufficient data",
    accent: "border-l-muted-foreground/40",
    badge: "bg-muted text-muted-foreground",
  },
  no_win: {
    label: "No win",
    accent: "border-l-muted-foreground/20",
    badge: "bg-muted text-muted-foreground",
  },
}

const KPI_ORDER: WinCategory[] = [
  "double_win",
  "yoy_positive_steady",
  "market_compass_candidate",
  "conflicting_signal",
  "insufficient_data",
]

type Filters = {
  category: WinCategory | null
  confidence: string | null
  clientId: string | null
  state: string | null
  hasChat: string | null
  search: string | null
  readyOnly: boolean
}

export function WinsView({
  run,
  summary,
  candidates,
  count,
  page,
  clients,
  filters,
  canEdit,
  canControl,
}: {
  run: WinDetectionRun | null
  summary: (Record<WinCategory, number> & { total: number }) | null
  candidates: WinCandidate[]
  count: number
  page: number
  clients: { id: string; name: string }[]
  filters: Filters
  canEdit: boolean
  canControl: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [isDetecting, setIsDetecting] = useState(false)
  const [selected, setSelected] = useState<WinCandidate | null>(null)
  const [searchValue, setSearchValue] = useState(filters.search ?? "")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setParams = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") params.delete(key)
        else params.set(key, value)
      }
      if (resetPage) params.delete("page")
      const qs = params.toString()
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [pathname, router, searchParams]
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function onSearchChange(value: string) {
    setSearchValue(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setParams({ q: value || null }), 350)
  }

  async function onRunDetection() {
    setIsDetecting(true)
    try {
      const result = await runWinsDetectionAction(3)
      if ("error" in result) {
        toast.error(result.error)
        return
      }
      toast.success(`Detection complete — ${result.candidateCount} listings analysed`)
      router.refresh()
    } finally {
      setIsDetecting(false)
    }
  }

  const stalenessDays = run ? daysBetween(run.as_of_date, new Date().toISOString().slice(0, 10)) : null
  const isStale = stalenessDays != null && stalenessDays > 2
  const totalPages = Math.max(1, Math.ceil(count / 50))
  const activeFilters = [
    filters.category,
    filters.confidence,
    filters.clientId,
    filters.state,
    filters.hasChat,
    filters.search,
  ].filter(Boolean).length

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Trophy className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">Wins</h1>
          </div>
          {run ? (
            <p className="text-sm text-muted-foreground">
              Analysis as of{" "}
              <span className="font-medium text-foreground">{run.as_of_date}</span> · Period{" "}
              <span className="font-medium text-foreground">
                {run.period_start.slice(0, 7)} → {run.period_end.slice(0, 7)}
              </span>{" "}
              · {run.candidate_count} listings analysed
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No detection has been run yet.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {run ? (
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5",
                isStale
                  ? "border-destructive/40 text-destructive"
                  : stalenessDays != null && stalenessDays > 1
                    ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                    : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
              )}
              title={`Latest complete booking day: ${run.as_of_date}. Reservations synced at ${run.reservations_fetched_at ?? "unknown"}.`}
            >
              <RefreshCw className="size-3" />
              {stalenessDays === 0 ? "Fresh" : `${stalenessDays}d old`}
            </Badge>
          ) : null}
          {canEdit ? (
            <Button onClick={onRunDetection} disabled={isDetecting} className="gap-2">
              <Play className={cn("size-4", isDetecting && "animate-pulse")} />
              {isDetecting ? "Running…" : "Run detection"}
            </Button>
          ) : null}
        </div>
      </header>

      {isStale ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Source data is more than 2 days old</AlertTitle>
          <AlertDescription>
            Nothing is marked ready to communicate while the analysis is stale. Run detection
            again once PriceLabs has synced.
          </AlertDescription>
        </Alert>
      ) : null}

      {summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {KPI_ORDER.map((cat) => {
            const active = filters.category === cat
            return (
              <Card
                key={cat}
                role="button"
                tabIndex={0}
                onClick={() =>
                  setParams({ category: active ? null : cat, view: active ? null : "all" })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    setParams({ category: active ? null : cat, view: active ? null : "all" })
                  }
                }}
                className={cn(
                  "cursor-pointer transition-colors motion-snappy",
                  active && "ring-2 ring-primary"
                )}
              >
                <CardContent className="p-4">
                  <div className="text-2xl font-semibold tabular-nums">{summary[cat]}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {CATEGORY_META[cat].label}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search client or listing…"
            className="w-64 pl-8"
            aria-label="Search wins"
          />
        </div>

        <Select
          value={filters.clientId ?? "all"}
          onValueChange={(v) => setParams({ client: v === "all" ? null : v })}
        >
          <SelectTrigger className="w-52" aria-label="Filter by client">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.confidence ?? "all"}
          onValueChange={(v) => setParams({ confidence: v === "all" ? null : v })}
        >
          <SelectTrigger className="w-40" aria-label="Filter by confidence">
            <SelectValue placeholder="Confidence" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any confidence</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.state ?? "all"}
          onValueChange={(v) => setParams({ state: v === "all" ? null : v })}
        >
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="in_review">In review</SelectItem>
            <SelectItem value="shared_manually">Shared manually</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.hasChat ?? "all"}
          onValueChange={(v) => setParams({ chat: v === "all" ? null : v })}
        >
          <SelectTrigger className="w-44" aria-label="Filter by Assembly chat">
            <SelectValue placeholder="Assembly chat" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any chat status</SelectItem>
            <SelectItem value="yes">Has Assembly chat</SelectItem>
            <SelectItem value="no">No Assembly chat</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={filters.readyOnly ? "default" : "outline"}
          size="sm"
          onClick={() =>
            setParams({ view: filters.readyOnly ? "all" : null, category: null })
          }
        >
          {filters.readyOnly ? "Ready to communicate" : "All candidates"}
        </Button>

        {activeFilters > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchValue("")
              setParams({
                category: null,
                confidence: null,
                client: null,
                state: null,
                chat: null,
                q: null,
              })
            }}
          >
            Clear filters ({activeFilters})
          </Button>
        ) : null}
      </div>

      {!run ? (
        <EmptyState
          title="No detection has been run yet"
          body="Run detection to analyse booking pickup and year-over-year performance across the portfolio."
          action={
            canEdit ? (
              <Button onClick={onRunDetection} disabled={isDetecting} className="gap-2">
                <Play className="size-4" />
                Run detection
              </Button>
            ) : null
          }
        />
      ) : candidates.length === 0 ? (
        <EmptyState
          title="No wins match these filters"
          body={
            filters.readyOnly
              ? "Nothing is ready to communicate right now. Switch to All candidates to see conflicting signals and blocked listings."
              : "Try widening the filters."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%]">Client</TableHead>
                  <TableHead className="w-[26%]">Listing</TableHead>
                  <TableHead className="w-[14%]">Type</TableHead>
                  <TableHead className="w-[24%]">Evidence</TableHead>
                  <TableHead className="w-[14%]">Signals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => (
                  <WinRow key={c.id} candidate={c} onOpen={() => setSelected(c)} />
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {candidates.length} of {count} {count === 1 ? "candidate" : "candidates"}
            </span>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isPending}
                  onClick={() => setParams({ page: String(page - 1) }, false)}
                >
                  Previous
                </Button>
                <span className="tabular-nums">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || isPending}
                  onClick={() => setParams({ page: String(page + 1) }, false)}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}

      <WinDetailDrawer
        candidate={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        canEdit={canEdit}
        canControl={canControl}
        onChanged={() => router.refresh()}
      />
    </div>
  )
}

function WinRow({ candidate, onOpen }: { candidate: WinCandidate; onOpen: () => void }) {
  const meta = CATEGORY_META[candidate.category]
  const { pickup, yoy, currency } = candidate.evidence
  const warnings = candidate.reason_codes.filter((r) => r !== "no_assembly_chat")

  return (
    <TableRow
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn("cursor-pointer border-l-[3px]", meta.accent)}
    >
      <TableCell className="whitespace-normal font-medium">
        {candidate.client_name_snapshot ?? (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </TableCell>
      <TableCell className="whitespace-normal text-muted-foreground">
        {candidate.listing_name_snapshot}
      </TableCell>
      <TableCell>
        <Badge className={cn("font-medium", meta.badge)} variant="secondary">
          {meta.label}
        </Badge>
        <div className="mt-1 text-xs capitalize text-muted-foreground">
          {candidate.confidence}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        {/* Absolute delta first, always. A percentage without the amount behind
            it is the single easiest way to mislead in a client message. */}
        <div className="font-mono text-sm tabular-nums">
          {pickup.delta_abs >= 0 ? "+" : ""}
          {formatCurrency(pickup.delta_abs, currency)} pickup
          {pickup.change_pct != null ? (
            <span className="ml-1 text-muted-foreground">
              ({formatPercent(pickup.change_pct)})
            </span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {yoy.delta_abs >= 0 ? "+" : ""}
          {formatCurrency(yoy.delta_abs, currency)} vs STLY
          {yoy.pct != null && yoy.pct_suppressed_reason == null
            ? ` (${formatPercent(yoy.pct)})`
            : ""}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap gap-1">
          {candidate.review_state && candidate.review_state !== "new" ? (
            <Badge variant="outline" className="text-xs capitalize">
              {candidate.review_state.replace(/_/g, " ")}
            </Badge>
          ) : null}
          {warnings.slice(0, 2).map((code) => (
            <Badge
              key={code}
              variant="outline"
              className="border-amber-500/40 text-xs text-amber-700 dark:text-amber-300"
            >
              {REASON_CODE_LABELS[code] ?? code}
            </Badge>
          ))}
          {warnings.length > 2 ? (
            <Badge variant="outline" className="text-xs">
              +{warnings.length - 2}
            </Badge>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
      <Trophy className="size-8 text-muted-foreground/50" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  )
}
