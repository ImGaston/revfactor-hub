"use client"

import { useEffect, useState, useTransition } from "react"
import { Sparkles, TrendingUp } from "lucide-react"
import { toast } from "sonner"

import {
  getListingOutcomesAction,
  summarizeOutcomeNowAction,
} from "@/app/(authenticated)/listings/[id]/outcome-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CHECKPOINTS,
  VERDICT_LABELS,
  addDays,
  type OutcomeVerdict,
  type WindowStats,
} from "@/lib/listing-outcomes"
import type { OutcomeSummary } from "@/lib/listing-outcomes-summary"
import type { ListingOutcomes, OutcomeWindowView } from "@/lib/listing-outcomes.server"
import { cn } from "@/lib/utils"

const verdictClasses: Record<OutcomeVerdict, string> = {
  on_track: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  watch: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  off_track: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  too_early: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
}

const usd = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`)
const num = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"))
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })

function VerdictBadge({ verdict }: { verdict: OutcomeVerdict }) {
  return (
    <Badge variant="secondary" className={cn("font-normal", verdictClasses[verdict])}>
      {VERDICT_LABELS[verdict]}
    </Badge>
  )
}

/** Results of tracked setup changes: before/after, pace vs last year, market, checkpoints. Loads on open. */
export function ListingOutcomes({ listingId, canSummarize }: { listingId: string; canSummarize: boolean }) {
  const [data, setData] = useState<ListingOutcomes | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getListingOutcomesAction(listingId).then((res) => {
      if (!live) return
      if (res.ok) setData(res.outcomes)
      else setError(res.error)
    })
    return () => {
      live = false
    }
  }, [listingId])

  if (error) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    )
  }
  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (data.windows.length === 0) return null

  return (
    <div className="space-y-4">
      {data.windows.map((w) => (
        <OutcomeCard
          key={w.window.changeSetId}
          listingId={listingId}
          view={w}
          asOf={data.asOf}
          canSummarize={canSummarize}
          snapshotsEnabled={data.snapshotsEnabled}
          reviewsEnabled={data.reviewsEnabled}
        />
      ))}
    </div>
  )
}

function OutcomeCard({
  listingId,
  view,
  asOf,
  canSummarize,
  snapshotsEnabled,
  reviewsEnabled,
}: {
  listingId: string
  view: OutcomeWindowView
  asOf: string
  canSummarize: boolean
  snapshotsEnabled: boolean
  reviewsEnabled: boolean
}) {
  const { window: w, live, reviews } = view
  const m = live.metrics
  const [summary, setSummary] = useState<OutcomeSummary | null>(null)
  const [pending, startTransition] = useTransition()

  const summarize = () =>
    startTransition(async () => {
      const res = await summarizeOutcomeNowAction(listingId, w.changeSetId)
      if (!res.ok) toast.error(res.error)
      else setSummary(res.summary)
    })

  const cols: { label: string; s: WindowStats | null }[] = [
    { label: `After (${fmtDate(m.after.from)} – ${fmtDate(m.after.to)})`, s: m.after },
    { label: `${m.days} day${m.days === 1 ? "" : "s"} before`, s: m.before },
    { label: "Same dates last year", s: m.lastYear },
  ]
  const rows: { label: string; get: (s: WindowStats) => string }[] = [
    { label: "Bookings made", get: (s) => num(s.bookings) },
    { label: "Nights booked", get: (s) => num(s.nights) },
    { label: "ADR", get: (s) => usd(s.adr) },
    { label: "Payout per night", get: (s) => usd(s.payoutPerNight) },
    { label: "Avg stay", get: (s) => (s.avgLos == null ? "—" : `${s.avgLos} nights`) },
    { label: "Avg lead time", get: (s) => (s.avgLeadDays == null ? "—" : `${s.avgLeadDays} days`) },
    { label: "Cancelled", get: (s) => num(s.cancelled) },
    {
      label: "Channel mix (nights)",
      get: (s) => (s.channels.length ? s.channels.map((c) => `${c.label} ${Math.round(c.share * 100)}%`).join(" · ") : "—"),
    },
  ]
  const latestReview = [...reviews].sort((a, b) => b.checkpoint_day - a.checkpoint_day).find((r) => r.summary)
  const shown = summary ?? (latestReview ? { summary: latestReview.summary!, suggestion: latestReview.suggestion } : null)
  const latestMarket = m.market?.latest

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <TrendingUp className="size-4" />
              Results since {fmtDate(w.start)} · day {m.days}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{w.titles.join(" · ")}</p>
          </div>
          <div className="flex items-center gap-2">
            <VerdictBadge verdict={live.verdict} />
            {canSummarize && (
              <Button size="sm" variant="outline" onClick={summarize} disabled={pending}>
                <Sparkles className="size-4" />
                {pending ? "Writing…" : "Summarize now"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {shown && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <p>{shown.summary}</p>
            {shown.suggestion && <p className="mt-1 text-muted-foreground">Next step: {shown.suggestion}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {summary ? "AI summary of today's numbers (not saved)" : `AI summary, day ${latestReview?.checkpoint_day} checkpoint`}
            </p>
          </div>
        )}

        {live.reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {live.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}

        <div className="-mx-6 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Bookings made in</TableHead>
                {cols.map((c) => (
                  <TableHead key={c.label} className="last:pr-6">
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="pl-6 text-muted-foreground">{r.label}</TableCell>
                  {cols.map((c) => (
                    <TableCell key={c.label} className="whitespace-normal last:pr-6">
                      {c.s ? r.get(c.s) : <span className="text-muted-foreground">No data yet</span>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="-mx-6 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">On the books (from {fmtDate(asOf)})</TableHead>
                <TableHead>Nights</TableHead>
                <TableHead>Same time last year</TableHead>
                <TableHead className="pr-6">Revenue per available night</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {m.pace.map((p) => (
                <TableRow key={p.horizon}>
                  <TableCell className="pl-6 text-muted-foreground">Next {p.horizon} days</TableCell>
                  <TableCell>
                    {p.nights} ({Math.round(p.occ * 100)}%)
                  </TableCell>
                  <TableCell>
                    {p.nightsStly == null ? (
                      <span className="text-muted-foreground">History too short</span>
                    ) : (
                      `${p.nightsStly} (${Math.round((p.occStly ?? 0) * 100)}%)`
                    )}
                  </TableCell>
                  <TableCell className="pr-6">
                    {usd(p.revpan)}
                    {p.revpanStly != null && <span className="text-muted-foreground"> vs {usd(p.revpanStly)}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          {latestMarket?.occ30 != null ? (
            <p>
              PriceLabs, {fmtDate(latestMarket.date)}: next 30 days {Math.round(latestMarket.occ30)}% booked vs market{" "}
              {latestMarket.market30 == null ? "—" : `${Math.round(latestMarket.market30)}%`}
              {m.market?.start?.occ30 != null &&
                ` (at the change: ${Math.round(m.market.start.occ30)}% vs ${Math.round(m.market.start.market30 ?? 0)}%)`}
            </p>
          ) : (
            <p>
              {snapshotsEnabled
                ? "Market comparison starts with the first daily snapshot."
                : "Market comparison starts once daily snapshots are enabled."}
            </p>
          )}
          {m.floor == null && <p>Set the owner&apos;s payout floor on the Strategy tab to check payout per night.</p>}
          <p>
            Booking revenue is the nightly rental amount; payout per night is after channel fees. Bookings made after the
            change have had less time to cancel.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {CHECKPOINTS.map((c) => {
            const r = reviews.find((x) => x.checkpoint_day === c)
            const due = addDays(w.start, c)
            return (
              <div
                key={c}
                className="rounded-md border px-2.5 py-1.5 text-xs"
                title={r?.summary ?? undefined}
              >
                <div className="font-medium">Day {c}</div>
                {r ? (
                  <VerdictBadge verdict={r.verdict} />
                ) : (
                  <div className="text-muted-foreground">{due <= asOf && reviewsEnabled ? "Next daily run" : fmtDate(due)}</div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
