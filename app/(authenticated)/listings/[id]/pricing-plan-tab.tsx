"use client"

// Pricing plan tab (read-only v1): what we'd change, pace from the listing's own
// booking curve, channel payout math, owner economics and editable 12-month
// targets. Data loads when the tab opens. Nothing is saved yet: edits stay on
// screen. Saved, approved plans are phase 2 (docs/pricing-plan.md).

import { useEffect, useMemo, useState } from "react"
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { AlertTriangle, Lightbulb, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  CHANNEL_LABEL,
  DEFAULT_PLAN_CHANNELS,
  PACE_BEHIND,
  addMonths,
  appliedDiscounts,
  buildHistory,
  buildSuggestions,
  channelMix,
  curveAt,
  daysInMonth,
  draftTargetsFromHistory,
  economics,
  minPriceForFloor,
  monthPace,
  payoutShare,
  targetRevenue,
  tightestChannel,
  type DiscountMode,
  type MonthTarget,
  type PlanChannel,
  type PlanReservation,
} from "@/lib/pricing-plan"
import { getPricingPlanDataAction } from "./pricing-plan-actions"

const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US")
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${Math.round(n * 100)}%`)
const mLabel = (ym: string) =>
  new Date(ym + "-01T00:00:00Z").toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })

const monthlyConfig: ChartConfig = {
  ly: { label: "Last year", color: "var(--chart-4)" },
  ob: { label: "On the books", color: "var(--chart-1)" },
  pickup: { label: "Expected pickup", color: "var(--chart-2)" },
  target: { label: "Target", color: "var(--chart-5)" },
}
const curveConfig: ChartConfig = { share: { label: "Booked by then", color: "var(--chart-1)" } }
const LADDER_NIGHTS = [1, 2, 3, 4, 5, 7, 10, 14, 21, 28]

export function PricingPlanTab({
  listingId,
  current,
}: {
  listingId: string
  current: { min: number | null; base: number | null; max: number | null }
}) {
  const [data, setData] = useState<{ today: string; reservations: PlanReservation[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getPricingPlanDataAction(listingId)
      .then((r) => {
        if (!alive) return
        if (r.ok) setData({ today: r.today, reservations: r.reservations })
        else setError(r.error)
      })
      .catch(() => alive && setError("Couldn't load reservations. Reload the page and try again."))
    return () => {
      alive = false
    }
  }, [listingId])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return <PricingPlan today={data.today} reservations={data.reservations} current={current} />
}

function PricingPlan({
  today,
  reservations,
  current,
}: {
  today: string
  reservations: PlanReservation[]
  current: { min: number | null; base: number | null; max: number | null }
}) {
  const history = useMemo(() => buildHistory(reservations, today), [reservations, today])
  const hasHistory = history.leads.length > 0
  const [targets, setTargets] = useState<MonthTarget[]>(() => draftTargetsFromHistory(hasHistory ? history : null, today))
  const [channels, setChannels] = useState<PlanChannel[]>(() => structuredClone(DEFAULT_PLAN_CHANNELS))
  const [price, setPrice] = useState(current.base ?? 300)
  const [floor, setFloor] = useState(0)
  const [nights, setNights] = useState(Math.max(1, Math.round(history.avgStay ?? 3)))
  const [mode, setMode] = useState<DiscountMode>("auto")
  const [econ, setEcon] = useState({ fixedMonthly: 0, cleaningPerTurn: 0, guestCleaningFee: 0, avgStay: history.avgStay ?? 3, revfactorMonthly: 0 })

  const mix = useMemo(() => channelMix(channels, hasHistory ? history : null), [channels, history, hasHistory])
  const suggestions = useMemo(
    () => buildSuggestions({ targets, history: hasHistory ? history : null, channels, floor, today }),
    [targets, history, hasHistory, channels, floor, today]
  )
  const paces = useMemo(() => targets.map((t) => monthPace(t, hasHistory ? history : null, today)), [targets, history, hasHistory, today])
  const econResult = useMemo(() => economics(targets, channels, mix, econ), [targets, channels, mix, econ])
  const tight = floor > 0 ? tightestChannel(channels, floor) : null

  const totals = useMemo(() => {
    const target = targets.reduce((a, t) => a + targetRevenue(t), 0)
    const ly = targets.reduce((a, t) => a + (history.revenue[addMonths(t.month, -12)] ?? 0), 0)
    const ob = paces.reduce((a, p) => a + p.onBooksRevenue, 0)
    const proj = paces.reduce((a, p) => a + (p.projectedRevenue ?? 0), 0)
    const next90 = [0, 1, 2].map((k) => addMonths(today.slice(0, 7), k))
    const ob90 = next90.reduce((a, m) => a + (history.onBooksNights[m] ?? 0), 0)
    const days90 = next90.reduce((a, m) => a + daysInMonth(m), 0)
    const behind = targets.filter((_, i) => paces[i].pace != null && paces[i].lead <= 120 && (paces[i].pace ?? 1) < PACE_BEHIND)
    return { target, ly, ob, proj, ob90, days90, behind }
  }, [targets, history, paces, today])

  const monthly = targets.map((t, i) => ({
    label: mLabel(t.month),
    ly: Math.round(history.revenue[addMonths(t.month, -12)] ?? 0),
    ob: Math.round(paces[i].onBooksRevenue),
    pickup: Math.round((paces[i].pickupNights ?? 0) * t.adr),
    target: Math.round(targetRevenue(t)),
  }))
  const curve = hasHistory ? Array.from({ length: 61 }, (_, i) => ({ d: i * 3, share: Math.round((curveAt(history, i * 3) ?? 0) * 100) })) : []
  const ladder = LADDER_NIGHTS.map((n) => {
    const row: Record<string, number | string> = { n: `${n}n` }
    channels.forEach((ch) => (row[ch.key] = Math.round(price * payoutShare(ch, appliedDiscounts(ch, n, mode === "worst" ? "auto" : mode)))))
    return row
  })
  const ladderConfig: ChartConfig = Object.fromEntries(channels.map((ch, i) => [ch.key, { label: ch.label, color: `var(--chart-${(i % 5) + 1})` }]))

  const setTarget = (i: number, patch: Partial<MonthTarget>) => setTargets((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const setChannel = (i: number, patch: Partial<PlanChannel>) => setChannels((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const togglePromo = (i: number, label: string, on: boolean) =>
    setChannels((cs) => cs.map((c, j) => (j === i ? { ...c, discounts: c.discounts.map((d) => (d.label === label ? { ...d, on } : d)) } : c)))
  const applyTargets = (apply: MonthTarget[]) =>
    setTargets((ts) => ts.map((t) => apply.find((a) => a.month === t.month) ?? t))

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Draft view. Targets start from the same month last year; channel settings start from the RevFactor markup policy. Edits stay on this screen and are not saved yet.
      </p>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="12-month target" value={usd(totals.target)} note={`${mLabel(targets[0].month)} – ${mLabel(targets[targets.length - 1].month)}`} />
        <Kpi label="Same months last year" value={hasHistory ? usd(totals.ly) : "—"} note={hasHistory && totals.ly ? `${totals.target >= totals.ly ? "+" : ""}${pct(totals.target / totals.ly - 1)} target vs last year` : "No synced history"} />
        <Kpi label="Projected finish" value={hasHistory ? usd(totals.proj) : "—"} note={hasHistory ? `On the books ${usd(totals.ob)} + expected pickup` : "Needs history"} />
        <Kpi
          label="Next 90 days booked"
          value={pct(totals.ob90 / totals.days90)}
          note={totals.behind.length ? `Behind pace: ${totals.behind.map((t) => mLabel(t.month)).join(", ")}` : `${totals.ob90} of ${totals.days90} nights`}
          tone={totals.behind.length ? "bad" : undefined}
        />
      </div>

      {/* Suggestions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="size-4" /> What we&apos;d change</CardTitle>
          <CardDescription>Computed from this listing&apos;s bookings and the settings below. Apply updates the targets on this screen.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {suggestions.length === 0 && <p className="text-sm text-muted-foreground">Nothing stands out in the numbers.</p>}
          {suggestions.map((s) => (
            <div key={s.id} className={cn("flex flex-wrap gap-3 rounded-lg border border-l-4 p-3", s.severity === "critical" ? "border-l-destructive" : s.severity === "high" ? "border-l-amber-500" : "border-l-muted-foreground/40")}>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.severity === "critical" ? "Do now" : s.severity === "high" ? "This week" : "Worth doing"}</p>
                <p className="text-sm font-medium">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.why}</p>
                {s.math && <p className="text-xs text-muted-foreground">{s.math}</p>}
              </div>
              <div className="flex flex-col items-end justify-center gap-1 text-right">
                {s.impact != null && (
                  <>
                    <span className={cn("text-sm font-semibold tabular-nums", s.impact < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>{s.impact < 0 ? "−" : "+"}{usd(Math.abs(s.impact))}</span>
                    <span className="text-xs text-muted-foreground">{s.impactLabel}</span>
                  </>
                )}
                {s.apply && <Button size="sm" onClick={() => applyTargets(s.apply!)}>Apply to targets</Button>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Monthly chart + curve */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Revenue by month</CardTitle>
            <CardDescription>Last year, on the books, expected pickup (sized by the booking curve) and target</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={monthlyConfig} className="h-[280px] w-full">
              <ComposedChart data={monthly} barGap={2}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="ly" fill="var(--color-ly)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="ob" stackId="now" fill="var(--color-ob)" maxBarSize={22} />
                <Bar dataKey="pickup" stackId="now" fill="var(--color-pickup)" fillOpacity={0.45} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Line dataKey="target" stroke="var(--color-target)" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="size-4" /> Booking curve</CardTitle>
            <CardDescription>Share of nights already booked, by days before the night</CardDescription>
          </CardHeader>
          <CardContent>
            {hasHistory ? (
              <ChartContainer config={curveConfig} className="h-[240px] w-full">
                <LineChart data={curve}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="d" tickLine={false} axisLine={false} ticks={[0, 30, 60, 90, 120, 150, 180]} tickFormatter={(v) => `${v}d`} />
                  <YAxis tickLine={false} axisLine={false} width={36} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line dataKey="share" stroke="var(--color-share)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground">Needs synced booking history.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Channel math */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Channel math</CardTitle>
          <CardDescription>What the owner keeps per night on each channel. Payout share = (1 + markup) × (1 − discount) × (1 − channel fee).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <NumField label="PriceLabs nightly price" value={price} onChange={setPrice} step={5} />
            <NumField label="Owner payout floor / night" value={floor} onChange={setFloor} step={5} />
            <NumField label="Stay length (nights)" value={nights} onChange={(v) => setNights(Math.max(1, v))} step={1} />
            <label className="grid gap-1 text-xs text-muted-foreground">
              Discounts
              <select className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={mode} onChange={(e) => setMode(e.target.value as DiscountMode)}>
                <option value="auto">What this stay gets</option>
                <option value="worst">Worst case (deepest stack)</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Markup %</TableHead>
                  <TableHead className="text-right">Fee %</TableHead>
                  <TableHead className="text-right">Mix</TableHead>
                  <TableHead>Discounts applied</TableHead>
                  <TableHead className="text-right">Guest nightly</TableHead>
                  <TableHead className="text-right">Owner keeps</TableHead>
                  <TableHead className="text-right">Min needed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((ch, i) => {
                  const ds = appliedDiscounts(ch, nights, mode)
                  const share = payoutShare(ch, ds)
                  const guest = price * (1 + ch.markup) * ds.reduce((a, d) => a * (1 - d.pct), 1)
                  const keep = price * share
                  return (
                    <TableRow key={ch.key}>
                      <TableCell className="align-top">
                        <div className="font-medium">{ch.label}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {ch.discounts.filter((d) => d.kind !== "los").map((d) => (
                            <label key={d.label} className="inline-flex items-center gap-1">
                              <input type="checkbox" checked={!!d.on} disabled={mode !== "auto"} onChange={(e) => togglePromo(i, d.label, e.target.checked)} />
                              {d.label} {pct(d.pct)}
                            </label>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right"><Input type="number" className="ml-auto h-8 w-20 text-right" value={Math.round(ch.markup * 100)} onChange={(e) => setChannel(i, { markup: Number(e.target.value) / 100 })} aria-label={`${ch.label} markup percent`} /></TableCell>
                      <TableCell className="text-right"><Input type="number" step={0.5} className="ml-auto h-8 w-20 text-right" value={+(ch.fee * 100).toFixed(1)} onChange={(e) => setChannel(i, { fee: Number(e.target.value) / 100 })} aria-label={`${ch.label} fee percent`} /></TableCell>
                      <TableCell className="text-right tabular-nums">{pct(mix[i])}</TableCell>
                      <TableCell className="text-sm">{ds.length ? ds.map((d) => `${d.label} ${pct(d.pct)}`).join(" + ") : <span className="text-muted-foreground">None</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(guest)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={cn("font-semibold", floor > 0 && keep < floor && "text-destructive")}>{usd(keep)}</span>
                        <div className="text-xs text-muted-foreground">{share.toFixed(3)}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{floor > 0 ? usd(minPriceForFloor(ch, floor)) : "—"}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            {tight ? (
              <>To protect a <b>{usd(floor)}</b> payout on every channel, the PriceLabs minimum must be at least <b>{usd(tight.min)}</b>, set by <b>{tight.ch.label}</b> with its deepest discounts. Today in PriceLabs: min {usd(current.min)}, base {usd(current.base)}, max {usd(current.max)}.</>
            ) : (
              <>Enter the owner&apos;s payout floor to see the PriceLabs minimum it requires. Today in PriceLabs: min {usd(current.min)}, base {usd(current.base)}, max {usd(current.max)}.</>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Payout per night by stay length</p>
            <ChartContainer config={ladderConfig} className="h-[220px] w-full">
              <LineChart data={ladder}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="n" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} tickFormatter={(v) => `$${v}`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {floor > 0 && <ReferenceLine y={floor} stroke="var(--destructive)" strokeDasharray="5 4" label={{ value: `Floor ${usd(floor)}`, position: "insideTopRight", fontSize: 11 }} />}
                {channels.map((ch) => (
                  <Line key={ch.key} dataKey={ch.key} stroke={`var(--color-${ch.key})`} strokeWidth={2} dot={{ r: 2 }} />
                ))}
              </LineChart>
            </ChartContainer>
          </div>
        </CardContent>
      </Card>

      {/* Owner economics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Owner economics</CardTitle>
          <CardDescription>Target revenue is booked nightly revenue; the owner keeps it minus each channel&apos;s fee, then pays cleaning, fixed costs and our fee.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <NumField label="Fixed costs / month" value={econ.fixedMonthly} onChange={(v) => setEcon((e) => ({ ...e, fixedMonthly: v }))} step={50} />
            <NumField label="Cleaning cost / turn" value={econ.cleaningPerTurn} onChange={(v) => setEcon((e) => ({ ...e, cleaningPerTurn: v }))} step={5} />
            <NumField label="Guest cleaning fee / stay" value={econ.guestCleaningFee} onChange={(v) => setEcon((e) => ({ ...e, guestCleaningFee: v }))} step={5} />
            <NumField label="Average stay (nights)" value={+econ.avgStay.toFixed(1)} onChange={(v) => setEcon((e) => ({ ...e, avgStay: Math.max(1, v) }))} step={0.5} />
            <NumField label="RevFactor fee / month" value={econ.revfactorMonthly} onChange={(v) => setEcon((e) => ({ ...e, revfactorMonthly: v }))} step={10} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Owner keeps of revenue" value={pct(econResult.kept)} note="Revenue minus channel fees, by mix" />
            <Kpi label="Payout, 12 months" value={usd(econResult.payout)} note={`From ${usd(econResult.revenue)} target revenue`} />
            <Kpi label="Net after costs" value={usd(econResult.net)} note="Enter costs for a real number" tone={econResult.net < 0 ? "bad" : undefined} />
            <Kpi label="Break-even occupancy" value={econ.fixedMonthly ? pct(econResult.breakEvenOcc) : "—"} note={`At ${usd(econResult.avgRate)} average nightly`} />
          </div>
        </CardContent>
      </Card>

      {/* Targets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4" /> 12-month targets and pace</CardTitle>
          <CardDescription>Edit occupancy or nightly rate. Pace compares what&apos;s booked with what the booking curve expects by now.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">LY occ</TableHead>
                <TableHead className="text-right">LY nightly</TableHead>
                <TableHead className="text-right">LY revenue</TableHead>
                <TableHead className="text-right">Target occ %</TableHead>
                <TableHead className="text-right">Target nightly</TableHead>
                <TableHead className="text-right">Target revenue</TableHead>
                <TableHead className="text-right">On the books</TableHead>
                <TableHead className="text-right">Pace</TableHead>
                <TableHead className="text-right">Projected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.map((t, i) => {
                const ly = addMonths(t.month, -12)
                const lyN = history.nights[ly] ?? 0
                const lyRev = history.revenue[ly] ?? 0
                const p = paces[i]
                return (
                  <TableRow key={t.month}>
                    <TableCell>{mLabel(t.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hasHistory ? pct(lyN / daysInMonth(ly)) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{lyN ? usd(lyRev / lyN) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{hasHistory ? usd(lyRev) : "—"}</TableCell>
                    <TableCell className="text-right"><Input type="number" min={0} max={100} className="ml-auto h-8 w-20 text-right" value={Math.round(t.occ * 100)} onChange={(e) => setTarget(i, { occ: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} aria-label={`Target occupancy ${mLabel(t.month)}`} /></TableCell>
                    <TableCell className="text-right"><Input type="number" min={0} step={5} className="ml-auto h-8 w-24 text-right" value={Math.round(t.adr)} onChange={(e) => setTarget(i, { adr: Math.max(0, Number(e.target.value)) })} aria-label={`Target nightly rate ${mLabel(t.month)}`} /></TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{usd(targetRevenue(t))}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.onBooksNights ? `${p.onBooksNights} n · ${usd(p.onBooksRevenue)}` : "0"}</TableCell>
                    <TableCell className="text-right">
                      {p.pace == null ? (
                        <span className="text-xs text-muted-foreground">Too early</span>
                      ) : (
                        <Badge variant={p.pace < PACE_BEHIND ? "destructive" : "outline"}>{pct(p.pace)} of expected</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.projectedRevenue != null ? usd(p.projectedRevenue) : "—"}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell colSpan={2} />
                <TableCell className="text-right tabular-nums">{hasHistory ? usd(totals.ly) : "—"}</TableCell>
                <TableCell colSpan={2} />
                <TableCell className="text-right tabular-nums">{usd(totals.target)}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(totals.ob)}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">{hasHistory ? usd(totals.proj) : "—"}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <div className="mt-3 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setTargets(draftTargetsFromHistory(hasHistory ? history : null, today))}>Reset to last year</Button>
          </div>
        </CardContent>
      </Card>

      {/* Channel history */}
      {hasHistory && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Channel history</CardTitle>
            <CardDescription>Last ~13 months of synced reservations</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Stays</TableHead>
                  <TableHead className="text-right">Nights</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Avg nightly</TableHead>
                  <TableHead className="text-right">Days booked ahead</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.channels.map((c) => {
                  const rate = c.cancelled / Math.max(1, c.bookings + c.cancelled)
                  return (
                    <TableRow key={c.code}>
                      <TableCell>{CHANNEL_LABEL[c.code] ?? c.code}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.bookings}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.nights}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(c.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.nights ? usd(c.revenue / c.nights) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.bookings ? Math.round(c.leadSum / c.bookings) : "—"}</TableCell>
                      <TableCell className="text-right">{c.cancelled ? <Badge variant={rate > 0.25 ? "destructive" : "outline"}>{c.cancelled} · {pct(rate)}</Badge> : "0"}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "bad" }) {
  return (
    <div className={cn("rounded-lg border p-3", tone === "bad" && "border-destructive/50")}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", tone === "bad" && "text-destructive")}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step: number }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input type="number" step={step} className="h-9 w-32 text-right" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  )
}
