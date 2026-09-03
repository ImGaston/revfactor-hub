"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowUpRight,
  BrainCircuit,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CircleX,
  CircleDotDashed,
  ClipboardPlus,
  Database,
  Eye,
  GraduationCap,
  Link2,
  MapPinned,
  Radar,
  RefreshCcw,
  Sparkles,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"

import {
  createMarketSignalAdjustmentAction,
  linkMarketSignalAdjustmentAction,
  recordMarketSignalDecisionAction,
  retryMarketSignalBriefAction,
  syncMarketSignalsAction,
} from "./actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  MarketSignalsMarketSummary,
  MarketSignalsQueueItem,
  MarketSignalsRecoveryItem,
  MarketSignalsUniversitySummary,
  MarketSignalsWorkspace,
} from "@/lib/market-signals/repository.server"

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

function daysUntil(value: string) {
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000)
}

function gateLabel(gate: MarketSignalsQueueItem["actionGate"]) {
  if (gate === "review_now") return "Needs review"
  if (gate === "unwind") return "Changed / unwind"
  return "Watch"
}

function gateVariant(gate: MarketSignalsQueueItem["actionGate"]) {
  if (gate === "unwind") return "destructive" as const
  if (gate === "review_now") return "default" as const
  return "secondary" as const
}

function metricSourceLabel(
  source: MarketSignalsQueueItem["topListings"][number]["metricSource"]
) {
  if (source === "pricelabs_rolling_7") return "next 7 days"
  if (source === "pricelabs_rolling_30") return "next 30 days"
  return "event month"
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: number
  detail: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" />
          <span className="text-xs font-medium tracking-wide uppercase">
            {label}
          </span>
        </div>
        <CardTitle className="mt-1 text-2xl tabular-nums">{value}</CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
    </Card>
  )
}

type BriefRuntime = {
  configured: boolean
  modelId: string
}

function SignalActions({ signal }: { signal: MarketSignalsQueueItem }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [createOpen, setCreateOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const eligibleListings = signal.topListings.filter(
    (listing) => listing.score >= 45
  )
  const [listingId, setListingId] = useState(
    eligibleListings[0]?.listingId ?? ""
  )
  const [adjustmentValue, setAdjustmentValue] = useState("")
  const briefId = signal.brief?.id

  function finish(result: { error: string | null; message: string | null }) {
    if (result.error) {
      toast.error(result.error)
      return false
    }
    toast.success(result.message ?? "Signal reviewed")
    router.refresh()
    return true
  }

  function decide(decision: "watch" | "dismissed" | "escalated") {
    if (!briefId) return
    startTransition(async () => {
      finish(
        await recordMarketSignalDecisionAction({
          impactId: signal.id,
          briefId,
          decision,
        })
      )
    })
  }

  function createAdjustment() {
    if (!briefId || !listingId) return
    startTransition(async () => {
      const result = await createMarketSignalAdjustmentAction({
        impactId: signal.id,
        briefId,
        listingId,
      })
      if (finish(result)) setCreateOpen(false)
    })
  }

  function linkAdjustment() {
    if (!briefId || !adjustmentValue.trim()) return
    startTransition(async () => {
      const result = await linkMarketSignalAdjustmentAction({
        impactId: signal.id,
        briefId,
        adjustment: adjustmentValue,
      })
      if (finish(result)) setLinkOpen(false)
    })
  }

  if (!briefId || signal.brief?.status !== "completed") return null

  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => decide("watch")}
      >
        <Eye data-icon="inline-start" />
        Keep watching
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => decide("escalated")}
      >
        <AlertTriangle data-icon="inline-start" />
        Escalate
      </Button>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            disabled={isPending || eligibleListings.length === 0}
          >
            <ClipboardPlus data-icon="inline-start" />
            Create Adjustment
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a bounded review request</DialogTitle>
            <DialogDescription>
              This opens an internal Adjustment for one exposed property. It
              does not change PriceLabs, minimum stays, or channel restrictions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`listing-${signal.id}`}>Exposed property</Label>
            <Select value={listingId} onValueChange={setListingId}>
              <SelectTrigger id={`listing-${signal.id}`}>
                <SelectValue placeholder="Select a property" />
              </SelectTrigger>
              <SelectContent>
                {eligibleListings.map((listing) => (
                  <SelectItem key={listing.listingId} value={listing.listingId}>
                    {listing.name} · exposure {Math.round(listing.score)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || !listingId}
              onClick={createAdjustment}
            >
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Open Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={isPending}>
            <Link2 data-icon="inline-start" />
            Link existing
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link an existing Adjustment</DialogTitle>
            <DialogDescription>
              Paste an open Adjustment URL or ID for an exposed client or
              property. The Adjustment itself will not be changed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`adjustment-${signal.id}`}>
              Adjustment URL or ID
            </Label>
            <Input
              id={`adjustment-${signal.id}`}
              value={adjustmentValue}
              onChange={(event) => setAdjustmentValue(event.target.value)}
              placeholder="https://hub.revfactor.io/adjustments/..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || !adjustmentValue.trim()}
              onClick={linkAdjustment}
            >
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Link Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="ghost" disabled={isPending}>
            <CircleX data-icon="inline-start" />
            Dismiss
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dismiss this evidence version?</AlertDialogTitle>
            <AlertDialogDescription>
              The decision is append-only. A materially changed event or new
              inventory snapshot will create a new Signal Brief for review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => decide("dismissed")}>
              Dismiss signal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SignalBriefPanel({
  signal,
  canEdit,
  briefRuntime,
}: {
  signal: MarketSignalsQueueItem
  canEdit: boolean
  briefRuntime: BriefRuntime
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const brief = signal.brief

  function retry() {
    startTransition(async () => {
      const result = await retryMarketSignalBriefAction(signal.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(result.message ?? "Signal Brief generated")
      router.refresh()
    })
  }

  if (!brief || brief.status === "failed") {
    return (
      <div className="mt-4 rounded-2xl border border-dashed p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <BrainCircuit className="size-4" /> Signal Brief unavailable
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {brief?.error ??
                (briefRuntime.configured
                  ? "The governed explanation has not been generated yet."
                  : "AI Gateway is not configured for Signal Briefs.")}
            </p>
          </div>
          {canEdit && briefRuntime.configured && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={retry}
            >
              {isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCcw data-icon="inline-start" />
              )}
              Generate brief
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (brief.status === "pending" || !brief.output) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
        <Spinner /> Generating governed Signal Brief…
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
            <BrainCircuit className="size-4" /> Decision snapshot
          </div>
          <h4 className="mt-1 font-heading text-sm font-semibold sm:text-base">
            {brief.output.headline}
          </h4>
        </div>
        <Badge variant="outline">{brief.output.confidence} confidence</Badge>
      </div>
      {canEdit && !signal.latestDecision && <SignalActions signal={signal} />}
      {signal.latestDecision && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4 text-sm">
          <Badge variant="secondary">
            Reviewed: {signal.latestDecision.replaceAll("_", " ")}
          </Badge>
          {signal.latestDecisionReason && (
            <span className="text-muted-foreground">
              {signal.latestDecisionReason}
            </span>
          )}
          {signal.adjustmentId && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/adjustments/${signal.adjustmentId}`}>
                Open Adjustment <ArrowUpRight data-icon="inline-end" />
              </Link>
            </Button>
          )}
        </div>
      )}
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleTrigger asChild>
          <Button className="mt-2" size="sm" variant="ghost">
            {detailsOpen ? (
              <ChevronUp data-icon="inline-start" />
            ) : (
              <ChevronDown data-icon="inline-start" />
            )}
            {detailsOpen ? "Hide full brief" : "View full brief"}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 border-t pt-3">
            <p className="text-sm leading-relaxed">
              {brief.output.executiveSummary}
            </p>
            <ul className="mt-3 grid gap-1.5 text-sm text-muted-foreground">
              {brief.output.whyNow.map((reason) => (
                <li key={reason} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl bg-background/70 p-3 text-sm">
                <div className="text-xs font-medium text-muted-foreground uppercase">
                  Property exposure
                </div>
                <p className="mt-1">{brief.output.propertyExposureSummary}</p>
              </div>
              <div className="rounded-xl bg-background/70 p-3 text-sm">
                <div className="text-xs font-medium text-muted-foreground uppercase">
                  Operator note
                </div>
                <p className="mt-1">{brief.output.operatorNote}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Generated by {brief.modelId.replace("openai/", "")} from the
              stored deterministic snapshot. The model cannot change pricing.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function DecisionKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-heading text-lg tabular-nums">{value}</div>
    </div>
  )
}

function SignalRow({
  signal,
  canEdit,
  briefRuntime,
}: {
  signal: MarketSignalsQueueItem
  canEdit: boolean
  briefRuntime: BriefRuntime
}) {
  const leadDays = daysUntil(signal.startAt)
  return (
    <div className="rounded-2xl border p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={gateVariant(signal.actionGate)}>
            {gateLabel(signal.actionGate)}
          </Badge>
          <Badge variant="outline">{signal.category}</Badge>
          {signal.latestDecision && (
            <Badge variant="secondary">
              Decided: {signal.latestDecision.replaceAll("_", " ")}
            </Badge>
          )}
        </div>
        <h3 className="mt-3 font-heading text-base font-semibold">
          {signal.title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {signal.marketName} · {formatDate(signal.startAt)}–
          {formatDate(signal.endAt)} ·{" "}
          {leadDays >= 0 ? `${leadDays} days out` : "event window passed"}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>{signal.evidenceCount} evidence records</span>
          <span>First seen {formatDate(signal.firstSeenAt)}</span>
          <span>Evidence {signal.evidenceFreshness}</span>
          {signal.evaluatedListings > 0 && (
            <span>
              {signal.exposedListings} of {signal.evaluatedListings} listings
              exposed
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <DecisionKpi
          label="Materiality"
          value={String(Math.round(signal.materialityScore))}
        />
        <DecisionKpi
          label="Vulnerability"
          value={
            signal.vulnerabilityScore == null
              ? "—"
              : String(Math.round(signal.vulnerabilityScore))
          }
        />
        <DecisionKpi
          label="Exposure"
          value={`${signal.exposedListings}/${signal.evaluatedListings}`}
        />
        <DecisionKpi
          label="Lead time"
          value={leadDays >= 0 ? `${leadDays}d` : "Passed"}
        />
        <DecisionKpi label="Evidence" value={String(signal.evidenceCount)} />
      </div>
      {signal.topListings.length > 0 && (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          Most exposed:{" "}
          {signal.topListings.map((listing) => listing.name).join(" · ")}
          {` · ${metricSourceLabel(signal.topListings[0].metricSource)}`}
        </p>
      )}
      {(signal.actionGate === "review_now" || signal.latestDecision) && (
        <SignalBriefPanel
          signal={signal}
          canEdit={canEdit}
          briefRuntime={briefRuntime}
        />
      )}
    </div>
  )
}

function SignalList({
  signals,
  empty,
  canEdit,
  briefRuntime,
}: {
  signals: MarketSignalsQueueItem[]
  empty: string
  canEdit: boolean
  briefRuntime: BriefRuntime
}) {
  if (signals.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      {signals.map((signal) => (
        <SignalRow
          key={signal.id}
          signal={signal}
          canEdit={canEdit}
          briefRuntime={briefRuntime}
        />
      ))}
    </div>
  )
}

function sourceName(source: string) {
  if (source === "official_feed") return "Official source"
  if (source === "google_news") return "Google News"
  if (source === "nws") return "NWS"
  if (source === "predicthq") return "PredictHQ"
  if (source === "ticketmaster") return "Ticketmaster"
  if (source === "cfbd") return "College Football Data"
  if (source === "seatgeek") return "SeatGeek"
  return source.replaceAll("_", " ")
}

function PredictHQRecoveryList({
  items,
}: {
  items: MarketSignalsRecoveryItem[]
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No PredictHQ reference events have been archived yet.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <Alert>
        <ArchiveRestore />
        <AlertTitle>
          PredictHQ is reference data, not an active dependency
        </AlertTitle>
        <AlertDescription>
          Needs replacement means only PredictHQ has found the canonical event.
          Recovered means at least one independent source found the same event.
        </AlertDescription>
      </Alert>
      {items.map((item) => (
        <div
          key={item.eventId}
          className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border p-4"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  item.status === "pending" ? "destructive" : "secondary"
                }
              >
                {item.status === "pending" ? "Needs replacement" : "Recovered"}
              </Badge>
              <Badge variant="outline">{item.category}</Badge>
            </div>
            <h3 className="mt-2 font-heading text-base font-semibold">
              {item.title}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.marketNames.length > 0
                ? item.marketNames.join(" · ")
                : `${item.city}${item.region ? `, ${item.region}` : ""}`}{" "}
              · {formatDate(item.startAt)}–{formatDate(item.endAt)}
            </p>
          </div>
          <div className="min-w-48 text-sm">
            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Independent coverage
            </div>
            <div className="mt-1 font-medium">
              {item.replacementSourceTypes.length > 0
                ? item.replacementSourceTypes.map(sourceName).join(" · ")
                : "None yet"}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              PredictHQ first seen {formatDate(item.predictHQFirstObservedAt)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function universityEventTypeLabel(value: string) {
  if (value === "family_weekend") return "Family weekend"
  if (value === "college_football") return "Football"
  if (value === "commencement") return "Graduation"
  return value.replaceAll("_", " ")
}

function UniversityRegistry({
  universities,
}: {
  universities: MarketSignalsUniversitySummary[]
}) {
  if (universities.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No university-event sources are mapped yet.
      </div>
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {universities.map((university) => {
        const monitoredSources = university.sources.filter(
          (source) => source.isActive
        ).length
        return (
          <Card
            key={`${university.marketId ?? "unmapped"}:${university.id}`}
            size="sm"
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{university.name}</CardTitle>
                  <CardDescription className="mt-1">
                    {university.marketName ?? "Market proposal pending"} ·{" "}
                    {university.city}, {university.region}
                  </CardDescription>
                </div>
                <Badge
                  variant={
                    university.relevanceStatus === "active"
                      ? "default"
                      : "outline"
                  }
                  className="capitalize"
                >
                  {university.relevanceStatus === "active"
                    ? "Mapped"
                    : university.relevanceStatus}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-2">
                {university.eventTypes.map((eventType) => (
                  <Badge key={eventType} variant="secondary">
                    {universityEventTypeLabel(eventType)}
                  </Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 border-t pt-4">
              <div>
                <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Official sources
                </div>
                <div className="mt-2 grid gap-2">
                  {university.sources.map((source) => (
                    <div
                      key={source.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      {source.sourceUrl ? (
                        <Link
                          href={source.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 truncate font-medium hover:underline"
                        >
                          {source.name}
                          <ArrowUpRight className="ml-1 inline size-3.5" />
                        </Link>
                      ) : (
                        <span className="min-w-0 truncate font-medium">
                          {source.name}
                        </span>
                      )}
                      <Badge variant="outline" className="shrink-0">
                        {source.sourceRole === "corroborating"
                          ? "Cross-check"
                          : "Official"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {university.demandRationale}
              </p>
              <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                <span>
                  {university.sources.length} official pages registered
                </span>
                <span>
                  {monitoredSources > 0
                    ? `${monitoredSources} monitored`
                    : "Collector pending"}
                </span>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function FoundationSnapshot({
  foundation,
}: {
  foundation: MarketSignalsWorkspace["foundation"]
}) {
  if (!foundation.available) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" /> Intelligence foundation
          </CardTitle>
          <CardDescription>
            Registry KPIs will appear after the additive market and event
            foundation migration is applied. Existing signal monitoring remains
            available.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const operationalSources = foundation.sourceCatalog.filter((source) =>
    ["active", "pilot"].includes(source.status)
  ).length
  const researchSources = foundation.sourceCatalog.filter(
    (source) => source.status === "research"
  ).length
  const credentialSources = foundation.sourceCatalog.filter(
    (source) => source.status === "credentials_pending"
  ).length

  return (
    <section className="grid gap-3">
      <div>
        <h2 className="font-heading text-lg font-semibold">
          Intelligence foundation
        </h2>
        <p className="text-sm text-muted-foreground">
          Fast readiness checks for mapping, source coverage, and future-event
          monitoring.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          icon={ShieldCheck}
          label="Primary mapped"
          value={foundation.primaryAssignments}
          detail={`${foundation.unmappedActiveListings} active listings unmapped`}
        />
        <MetricCard
          icon={MapPinned}
          label="Localities"
          value={foundation.localityCount}
          detail={`${foundation.stateCount} market jurisdictions`}
        />
        <MetricCard
          icon={CircleDotDashed}
          label="Market proposals"
          value={foundation.openMarketProposals}
          detail="Draft, review, or approved"
        />
        <MetricCard
          icon={Database}
          label="Source catalog"
          value={foundation.sourceCatalog.length}
          detail={`${operationalSources} active/pilot · ${researchSources} research · ${credentialSources} credentials`}
        />
        <MetricCard
          icon={CalendarClock}
          label="Dates due"
          value={foundation.dueDateWatches}
          detail="Recurring dates awaiting verification"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Playoff watches"
          value={foundation.pendingConditionalEvents}
          detail="Conditional events still pending"
        />
      </div>
    </section>
  )
}

function sourceStatusLabel(market: MarketSignalsMarketSummary) {
  if (market.sources.length === 0) return "Sources not registered"
  const active = market.sources.filter((item) => item.isActive)
  if (active.length === 0) return "Agent waiting for secure source connections"
  const failed = active.filter((item) => item.lastStatus === "error")
  const rateLimited = active.filter(
    (item) => item.lastStatus === "rate_limited"
  )
  if (failed.length > 0) return `${failed.length} source sync failed`
  if (rateLimited.length > 0) return `${rateLimited.length} source rate limited`
  const latestSuccess = active
    .map((item) => item.lastSuccessAt)
    .filter((value): value is string => value != null)
    .sort()
    .at(-1)
  if (latestSuccess) {
    return `${active.length} sources · last sync ${formatDate(latestSuccess)}`
  }
  return `${active.length} sources ready for first sync`
}

function jobStatusLabel(market: MarketSignalsMarketSummary) {
  const job = market.latestJob
  if (!job) return "No agent refresh queued yet"
  if (job.status === "queued") return "Agent refresh queued"
  if (job.status === "running")
    return `Agent refresh running · attempt ${job.attempts}`
  if (job.status === "failed")
    return `Agent refresh failed after ${job.attempts} attempts`
  if (job.durationMs != null) {
    return `Agent refresh completed in ${Math.max(1, Math.round(job.durationMs / 1000))}s`
  }
  return "Agent refresh completed"
}

function MarketCard({
  market,
  canEdit,
  runtime,
}: {
  market: MarketSignalsMarketSummary
  canEdit: boolean
  runtime: {
    serviceRoleConfigured: boolean
    predictHQConfigured: boolean
    ticketmasterConfigured: boolean
    cfbdConfigured: boolean
    nwsConfigured: boolean
    configuredSources: number
    ready: boolean
  }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const source =
    market.sources.find((item) => item.isActive && item.lastStatus !== "ok") ??
    market.sources.find((item) => item.isActive)
  const action =
    market.status === "active"
      ? {
          label: "Queue refresh",
          run: syncMarketSignalsAction,
          disabled: !runtime.ready,
        }
      : null

  function runAction() {
    if (!action) return
    startTransition(async () => {
      const result = await action.run(market.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(result.message ?? "Market updated")
      router.refresh()
    })
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{market.name}</CardTitle>
            <CardDescription className="mt-1 capitalize">
              {market.kind} · {market.radiusMiles} mi source radius
            </CardDescription>
            <div className="mt-2 flex flex-wrap gap-1">
              {market.stateLabels.map((state) => (
                <Badge key={state} variant="outline">
                  {state}
                </Badge>
              ))}
            </div>
            {market.localityLabels.length > 0 && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {market.localityLabels.join(" · ")}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant={market.status === "active" ? "default" : "outline"}>
              {market.status}
            </Badge>
            {market.managementMode === "agent" && (
              <Badge variant="secondary">
                <Sparkles /> Agent managed
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-muted/60 p-2">
          <div className="font-heading text-lg">{market.approvedListings}</div>
          <div className="text-xs text-muted-foreground">Listings</div>
        </div>
        <div className="rounded-xl bg-muted/60 p-2">
          <div className="font-heading text-lg">{market.proposedListings}</div>
          <div className="text-xs text-muted-foreground">Proposed</div>
        </div>
        <div className="rounded-xl bg-muted/60 p-2">
          <div className="font-heading text-lg">{market.activeSources}</div>
          <div className="text-xs text-muted-foreground">Sources</div>
        </div>
      </CardContent>
      <CardContent className="flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{sourceStatusLabel(market)}</span>
          {source?.lastStatus && (
            <Badge
              variant={source.lastStatus === "ok" ? "secondary" : "destructive"}
            >
              {source.lastStatus.replaceAll("_", " ")}
            </Badge>
          )}
        </div>
        {source?.lastError && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {source.lastError}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{jobStatusLabel(market)}</span>
          {market.latestJob && (
            <Badge
              variant={
                market.latestJob.status === "failed"
                  ? "destructive"
                  : market.latestJob.status === "running"
                    ? "default"
                    : "secondary"
              }
            >
              {market.latestJob.status}
            </Badge>
          )}
        </div>
        {market.latestJob?.error && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {market.latestJob.error}
          </p>
        )}
        {canEdit && action && (
          <Button
            size="sm"
            variant={market.status === "active" ? "outline" : "default"}
            disabled={isPending || action.disabled}
            onClick={runAction}
          >
            {isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCcw data-icon="inline-start" />
            )}
            {isPending ? "Working..." : action.label}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function MarketSignalsView({
  workspace,
  canEdit,
  runtime,
  briefRuntime,
}: {
  workspace: MarketSignalsWorkspace
  canEdit: boolean
  runtime: {
    serviceRoleConfigured: boolean
    predictHQConfigured: boolean
    ticketmasterConfigured: boolean
    cfbdConfigured: boolean
    nwsConfigured: boolean
    configuredSources: number
    ready: boolean
  }
  briefRuntime: BriefRuntime
}) {
  const needsReview = workspace.queue.filter(
    (signal) => signal.actionGate === "review_now" && !signal.latestDecision
  )
  const changed = workspace.queue.filter(
    (signal) => signal.actionGate === "unwind"
  )
  const watch = workspace.queue
    .filter((signal) => signal.actionGate === "watch")
    .slice(0, 60)
  const reviewed = workspace.queue.filter((signal) => signal.latestDecision)
  const announcements = workspace.queue.filter(
    (signal) =>
      ["candidate", "corroborating", "verified"].includes(signal.state) &&
      daysUntil(signal.startAt) > 120
  )
  const activeMarkets = workspace.markets.filter(
    (market) => market.status === "active"
  )
  const staleSources = workspace.markets.reduce(
    (sum, market) => sum + market.staleSources,
    0
  )
  const failedJobs = workspace.markets.filter(
    (market) => market.latestJob?.status === "failed"
  )
  const predictHQPending = workspace.predictHQRecovery.filter(
    (item) => item.status === "pending"
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Radar className="size-4" />
            Revenue intelligence
          </div>
          <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight">
            Market Signals
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Verified market changes that may require an ADR, minimum-stay, or
            restriction review before booking pickup makes them obvious.
          </p>
        </div>
        <Badge variant="outline" className="h-7 px-3">
          <ShieldCheck /> AI monitors · humans approve actions
        </Badge>
      </header>

      {workspace.persistence === "unavailable" && (
        <Alert>
          <Database />
          <AlertTitle>Persistence is ready for review, not applied</AlertTitle>
          <AlertDescription>
            {workspace.persistenceMessage} The UI fails closed and no external
            source or pricing mutation has been enabled.
          </AlertDescription>
        </Alert>
      )}

      {workspace.persistence === "ready" &&
        workspace.markets.some((market) => market.status === "draft") && (
          <Alert>
            <CircleDotDashed />
            <AlertTitle>The agent is mapping new markets</AlertTitle>
            <AlertDescription>
              Coordinate matching and market readiness happen automatically. You
              only review event-driven revenue recommendations.
            </AlertDescription>
          </Alert>
        )}

      {workspace.persistence === "ready" && !runtime.ready && (
        <Alert>
          <Database />
          <AlertTitle>Runtime credentials required</AlertTitle>
          <AlertDescription>
            Add the server-side Supabase service role and at least one event
            source connection (Ticketmaster, College Football Data, or NWS) so
            the agent can monitor automatically. No credential is exposed to the
            browser.
          </AlertDescription>
        </Alert>
      )}

      {workspace.persistence === "ready" && !briefRuntime.configured && (
        <Alert>
          <BrainCircuit />
          <AlertTitle>Signal Brief agent is not connected</AlertTitle>
          <AlertDescription>
            Event ingestion and deterministic scoring continue. Connect Vercel
            AI Gateway to generate cached explanations for Needs Review items.
          </AlertDescription>
        </Alert>
      )}

      {staleSources > 0 && (
        <Alert variant="destructive">
          <RefreshCcw />
          <AlertTitle>{staleSources} sources need attention</AlertTitle>
          <AlertDescription>
            Stale or failed sources remain visible; an empty feed is never
            treated as proof that no event exists.
          </AlertDescription>
        </Alert>
      )}

      {failedJobs.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>
            Agent refresh failed in {failedJobs.length}{" "}
            {failedJobs.length === 1 ? "market" : "markets"}
          </AlertTitle>
          <AlertDescription>
            The retry limit was reached for{" "}
            {failedJobs.map((market) => market.name).join(", ")}. Open Markets
            to see the last error and queue a recovery refresh.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          icon={AlertTriangle}
          label="Needs review"
          value={needsReview.length}
          detail="Verified and materially relevant"
        />
        <MetricCard
          icon={CalendarClock}
          label="Announcements"
          value={announcements.length}
          detail="Long-lead candidates over 120 days"
        />
        <MetricCard
          icon={RefreshCcw}
          label="Changed / unwind"
          value={changed.length}
          detail="Canceled, postponed, or moved"
        />
        <MetricCard
          icon={MapPinned}
          label="Active markets"
          value={activeMarkets.length}
          detail={
            failedJobs.length > 0
              ? `${failedJobs.length} agent refresh ${failedJobs.length === 1 ? "failure" : "failures"}`
              : `${workspace.markets.length} configured markets · agent healthy`
          }
        />
        <MetricCard
          icon={ArchiveRestore}
          label="PHQ gaps"
          value={predictHQPending.length}
          detail={`${workspace.predictHQRecovery.length - predictHQPending.length} independently recovered`}
        />
      </div>

      <FoundationSnapshot foundation={workspace.foundation} />

      <Tabs defaultValue="review">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="review">Needs review</TabsTrigger>
          <TabsTrigger value="announcements">Announcements</TabsTrigger>
          <TabsTrigger value="changed">Changed</TabsTrigger>
          <TabsTrigger value="watch">Watchlist</TabsTrigger>
          <TabsTrigger value="reviewed">Reviewed</TabsTrigger>
          <TabsTrigger value="universities">
            <GraduationCap /> Universities
          </TabsTrigger>
          <TabsTrigger value="predicthq">PredictHQ recovery</TabsTrigger>
          <TabsTrigger value="markets">Markets</TabsTrigger>
        </TabsList>
        <TabsContent value="review" className="mt-4">
          <SignalList
            signals={needsReview}
            empty="No verified signals currently require revenue-manager review."
            canEdit={canEdit}
            briefRuntime={briefRuntime}
          />
        </TabsContent>
        <TabsContent value="announcements" className="mt-4">
          <SignalList
            signals={announcements}
            empty="No long-lead announcements have been normalized yet."
            canEdit={canEdit}
            briefRuntime={briefRuntime}
          />
        </TabsContent>
        <TabsContent value="changed" className="mt-4">
          <SignalList
            signals={changed}
            empty="No cancellations, postponements, or unwind signals are open."
            canEdit={canEdit}
            briefRuntime={briefRuntime}
          />
        </TabsContent>
        <TabsContent value="watch" className="mt-4">
          <SignalList
            signals={watch}
            empty="No below-threshold signals are being watched."
            canEdit={canEdit}
            briefRuntime={briefRuntime}
          />
        </TabsContent>
        <TabsContent value="reviewed" className="mt-4">
          <SignalList
            signals={reviewed}
            empty="No Signal Brief decisions have been recorded yet."
            canEdit={canEdit}
            briefRuntime={briefRuntime}
          />
        </TabsContent>
        <TabsContent value="universities" className="mt-4">
          <UniversityRegistry universities={workspace.universities} />
        </TabsContent>
        <TabsContent value="predicthq" className="mt-4">
          <PredictHQRecoveryList items={workspace.predictHQRecovery} />
        </TabsContent>
        <TabsContent value="markets" className="mt-4">
          {workspace.markets.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No governed markets are configured.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {workspace.markets.map((market) => (
                <MarketCard
                  key={market.id}
                  market={market}
                  canEdit={canEdit}
                  runtime={runtime}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
