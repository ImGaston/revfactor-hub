"use client"

// Per-listing Report Builder dashboard, adapted to shadcn/Tailwind + recharts.
// Single listing → no aggregation: each report_metrics row is one month.
// Tabs: Overview · Market Position · Booking Window · Pacing.

import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import {
  TrendingUp,
  TrendingDown,
  Activity,
  CalendarClock,
  Target,
  Clock,
  AlertTriangle,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import type { ListingReport, ReportMetric } from "@/lib/types"

// ─── Formatters & helpers ───────────────────────────────────

const f$ = (v: number | null | undefined) =>
  v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`
const fPct = (v: number | null | undefined, sign = true) =>
  v == null ? "—" : `${sign && v > 0 ? "+" : ""}${v.toFixed(1)}%`
const fNum = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d })
const monthLabel = (period: string) =>
  new Date(period + "T00:00:00").toLocaleDateString("en-US", { month: "short" })

const currentMonthKey = () => new Date().toISOString().slice(0, 7)

type Month = {
  key: string // YYYY-MM
  label: string
  rev: number
  stly: number | null
  ly: number | null
  pot: number
  yoy: number | null
  occ: number | null
  occLy: number | null
  mOcc: number | null
  adr: number | null
  adrYoy: number | null
  mAdr: number | null
  mAdrYoy: number | null
  revpar: number | null
  mRevpar: number | null
  rpi: number | null
  bw: number | null
  bwLy: number | null
  mBw: number | null
  ceiling: number
  pctLy: number | null
  past: boolean
}

function prepareMonths(metrics: ReportMetric[]): Month[] {
  const now = currentMonthKey()
  return metrics.map((m) => {
    const key = m.period.slice(0, 7)
    const rev = m.rental_revenue ?? 0
    const pot = m.potential_revenue_open_inventory ?? 0
    return {
      key,
      label: monthLabel(m.period),
      rev,
      stly: m.rental_revenue_stly,
      ly: m.rental_revenue_ly,
      pot,
      yoy: m.rental_revenue_stly_yoy_pct,
      occ: m.adjusted_occupancy_pct,
      occLy: m.adjusted_occupancy_ly_pct,
      mOcc: m.market_occupancy_pct,
      adr: m.rental_adr,
      adrYoy: m.rental_adr_stly_yoy_pct,
      mAdr: m.market_adr,
      mAdrYoy: m.market_adr_stly_yoy_pct,
      revpar: m.rental_revpar,
      mRevpar: m.market_revpar,
      rpi: m.revpar_index,
      bw: m.median_booking_window,
      bwLy: m.median_booking_window_ly,
      mBw: m.market_median_booking_window,
      ceiling: rev + pot,
      pctLy: m.rental_revenue_ly && m.rental_revenue_ly > 0 ? (rev / m.rental_revenue_ly) * 100 : null,
      past: key < now,
    }
  })
}

// ─── Shared bits ────────────────────────────────────────────

function NoReport() {
  return (
    <div className="rounded-lg border border-dashed border-amber-400/50 bg-amber-50/50 px-4 py-3 dark:bg-amber-950/20">
      <p className="text-sm text-amber-700 dark:text-amber-400">
        No Report Builder data yet for this listing. Run{" "}
        <strong>Sync Report Builder</strong> in Settings → Listings, or check
        that the Listing ID matches PriceLabs.
      </p>
    </div>
  )
}

function Delta({ v }: { v: number | null }) {
  if (v == null) return <span className="text-xs text-muted-foreground">—</span>
  const neutral = Math.abs(v) < 0.05
  const pos = v > 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        neutral
          ? "bg-muted text-muted-foreground"
          : pos
            ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
            : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
      )}
    >
      {!neutral && (pos ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />)}
      {`${pos ? "+" : ""}${v.toFixed(1)}%`}
    </span>
  )
}

function freshness(report: ListingReport) {
  return report.runCompletedAt
    ? `Updated ${new Date(report.runCompletedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : undefined
}

// ─── Overview ───────────────────────────────────────────────

const overviewConfig: ChartConfig = {
  otb: { label: "On the books", color: "var(--chart-1)" },
  stly: { label: "Same time last year", color: "var(--chart-3)" },
  lyFinal: { label: "LY final close", color: "var(--chart-4)" },
}

export function ReportOverview({ report }: { report: ListingReport | null }) {
  const months = useMemo(() => (report ? prepareMonths(report.metrics) : []), [report])

  const kpis = useMemo(() => {
    const now = currentMonthKey()
    const totalOtb = months.reduce((s, d) => s + d.rev, 0)
    const realized = months.filter((d) => d.key < now).reduce((s, d) => s + d.rev, 0)
    const comp = months.filter((d) => d.stly && d.stly > 0)
    const compRev = comp.reduce((s, d) => s + d.rev, 0)
    const compStly = comp.reduce((s, d) => s + (d.stly ?? 0), 0)
    const vsStly = compStly > 0 ? ((compRev - compStly) / compStly) * 100 : null
    const fwd = months.filter((d) => d.key >= now)
    const potential = fwd.reduce((s, d) => s + d.pot, 0)
    const rpis = fwd.filter((d) => d.rpi != null)
    const fwdRpi = rpis.length ? rpis.reduce((s, d) => s + (d.rpi ?? 0), 0) / rpis.length : null
    return { totalOtb, realized, vsStly, potential, fwdRpi }
  }, [months])

  const flags = useMemo(() => {
    const now = currentMonthKey()
    const out: { lvl: "neg" | "warn" | "pos"; mo: string; txt: string }[] = []
    for (const d of months.filter((m) => m.key >= now)) {
      if (d.rev === 0 && d.pot > 0) {
        out.push({ lvl: "neg", mo: d.label, txt: `Nothing on the books — ${f$(d.pot)} open. Check rates, min-stay & visibility.` })
        continue
      }
      if (d.rpi != null && d.rpi < 100)
        out.push({ lvl: "neg", mo: d.label, txt: `RevPAR Index ${d.rpi.toFixed(0)} — below market with ${f$(d.pot)} still bookable.` })
      else if (d.occ != null && d.mOcc != null && d.occ + 5 < d.mOcc && d.pot > 0)
        out.push({ lvl: "warn", mo: d.label, txt: `Occupancy ${d.occ.toFixed(0)}% vs market ${d.mOcc.toFixed(0)}% — ${f$(d.pot)} open.` })
      else if (d.yoy != null && d.yoy < -25)
        out.push({ lvl: "warn", mo: d.label, txt: `Pacing ${fPct(d.yoy)} vs STLY with ${f$(d.pot)} of inventory left.` })
      else if (d.yoy != null && d.yoy > 25 && d.rpi != null && d.rpi >= 100)
        out.push({ lvl: "pos", mo: d.label, txt: `Pacing ${fPct(d.yoy)} ahead of STLY (RPI ${d.rpi.toFixed(0)}) — hold price.` })
    }
    const rank = { neg: 0, warn: 1, pos: 2 }
    return out.sort((a, b) => rank[a.lvl] - rank[b.lvl]).slice(0, 12)
  }, [months])

  if (!report || months.length === 0) return <NoReport />

  const chartData = months.map((d) => ({
    label: d.label,
    otb: d.rev,
    stly: d.stly,
    lyFinal: d.ly,
  }))
  const flagTone = {
    neg: { label: "Action", cls: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400" },
    warn: { label: "Watch", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" },
    pos: { label: "Healthy", cls: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400" },
  }

  const kpiCards: {
    label: string
    value: string
    sub: string
    icon: typeof Activity
    tone?: "pos" | "neg"
  }[] = [
    { label: "Revenue OTB", value: f$(kpis.totalOtb), sub: `${f$(kpis.realized)} realized`, icon: Activity },
    { label: "vs Same Time LY", value: fPct(kpis.vsStly), sub: "comparable months", icon: kpis.vsStly != null && kpis.vsStly >= 0 ? TrendingUp : TrendingDown, tone: kpis.vsStly != null ? (kpis.vsStly >= 0 ? "pos" : "neg") : undefined },
    { label: "Open Inventory", value: f$(kpis.potential), sub: "bookable · final price", icon: CalendarClock },
    { label: "Fwd RevPAR Index", value: kpis.fwdRpi != null ? kpis.fwdRpi.toFixed(0) : "—", sub: "100 = market", icon: Target, tone: kpis.fwdRpi != null ? (kpis.fwdRpi >= 100 ? "pos" : "neg") : undefined },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "font-mono text-2xl font-bold",
                  c.tone === "pos" && "text-green-600 dark:text-green-400",
                  c.tone === "neg" && "text-red-600 dark:text-red-400"
                )}
              >
                {c.value}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue on the books · 2026</CardTitle>
          <CardDescription>
            On the books vs same time last year, with last year&apos;s final close
            {report.runCompletedAt && ` · ${freshness(report)}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={overviewConfig} className="h-[300px] w-full">
            <ComposedChart data={chartData} barGap={3}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="otb" fill="var(--color-otb)" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Bar dataKey="stly" fill="var(--color-stly)" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Line dataKey="lyFinal" stroke="var(--color-lyFinal)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4" /> Focus list
          </CardTitle>
          <CardDescription>Forward months · sorted by severity</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No flags for the forward months.</p>
          ) : (
            flags.map((fl, i) => {
              const t = flagTone[fl.lvl]
              return (
                <div key={i} className={cn("flex flex-wrap items-start gap-3 rounded-md px-3 py-2", t.cls)}>
                  <span className="min-w-[52px] text-xs font-bold uppercase tracking-wide">{t.label}</span>
                  <span className="min-w-[30px] text-sm font-bold text-foreground">{fl.mo}</span>
                  <span className="flex-1 text-sm text-foreground">{fl.txt}</span>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Market Position ────────────────────────────────────────

const rpiConfig: ChartConfig = { rpi: { label: "RevPAR Index", color: "var(--chart-1)" } }
const occConfig: ChartConfig = {
  occ: { label: "Listing", color: "var(--chart-1)" },
  mOcc: { label: "Market", color: "var(--muted-foreground)" },
  occLy: { label: "Listing LY", color: "var(--chart-3)" },
}
const adrConfig: ChartConfig = {
  adr: { label: "Listing ADR", color: "var(--chart-1)" },
  mAdr: { label: "Market ADR", color: "var(--chart-3)" },
}

export function ReportMarket({ report }: { report: ListingReport | null }) {
  const months = useMemo(() => (report ? prepareMonths(report.metrics) : []), [report])
  if (!report || months.length === 0) return <NoReport />

  const rpiData = months.map((d) => ({ label: d.label, rpi: d.rpi }))
  const occData = months.map((d) => ({ label: d.label, occ: d.occ, mOcc: d.mOcc, occLy: d.occLy }))
  const adrData = months.map((d) => ({ label: d.label, adr: d.adr, mAdr: d.mAdr }))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="size-4" /> RevPAR Index
          </CardTitle>
          <CardDescription>100 = market parity · above is outperforming the comp set</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={rpiConfig} className="h-[240px] w-full">
            <BarChart data={rpiData}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={36} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ReferenceLine y={100} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
              <Bar dataKey="rpi" radius={[4, 4, 0, 0]} maxBarSize={30}>
                {rpiData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.rpi == null || d.rpi >= 100 ? "var(--chart-1)" : "var(--destructive)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Occupancy vs market</CardTitle>
            <CardDescription>%, listing vs comp set vs last year</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={occConfig} className="h-[240px] w-full">
              <LineChart data={occData}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={36} unit="%" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="occ" stroke="var(--color-occ)" strokeWidth={2.2} dot={{ r: 2.5 }} connectNulls />
                <Line dataKey="mOcc" stroke="var(--color-mOcc)" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
                <Line dataKey="occLy" stroke="var(--color-occLy)" strokeWidth={1.5} dot={false} connectNulls />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ADR vs market</CardTitle>
            <CardDescription>Achieved nightly rate vs comp set</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={adrConfig} className="h-[240px] w-full">
              <BarChart data={adrData} barGap={2}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `$${v}`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="adr" fill="var(--color-adr)" radius={[3, 3, 0, 0]} maxBarSize={16} />
                <Bar dataKey="mAdr" fill="var(--color-mAdr)" radius={[3, 3, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Position detail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">RPI</TableHead>
                  <TableHead className="text-right">Occ</TableHead>
                  <TableHead className="text-right">Mkt Occ</TableHead>
                  <TableHead className="text-right">Occ Gap</TableHead>
                  <TableHead className="text-right">ADR</TableHead>
                  <TableHead className="text-right">Mkt ADR</TableHead>
                  <TableHead className="text-right">ADR Prem.</TableHead>
                  <TableHead className="text-right">ADR YoY</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((d) => {
                  const gap = d.occ != null && d.mOcc != null ? d.occ - d.mOcc : null
                  const prem = d.adr != null && d.mAdr ? (d.adr / d.mAdr - 1) * 100 : null
                  return (
                    <TableRow key={d.key} className={cn(d.past && "opacity-60")}>
                      <TableCell className="font-medium">{d.label}</TableCell>
                      <TableCell className={cn("text-right font-mono font-semibold", d.rpi == null ? "text-muted-foreground" : d.rpi >= 100 ? "text-foreground" : "text-red-600 dark:text-red-400")}>
                        {d.rpi != null ? d.rpi.toFixed(0) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">{d.occ != null ? `${d.occ.toFixed(0)}%` : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{d.mOcc != null ? `${d.mOcc.toFixed(0)}%` : "—"}</TableCell>
                      <TableCell className={cn("text-right font-mono font-semibold", gap == null ? "text-muted-foreground" : gap >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                        {gap == null ? "—" : `${gap > 0 ? "+" : ""}${gap.toFixed(0)} pp`}
                      </TableCell>
                      <TableCell className="text-right font-mono">{f$(d.adr)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{f$(d.mAdr)}</TableCell>
                      <TableCell className={cn("text-right font-mono", prem == null ? "text-muted-foreground" : prem >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                        {fPct(prem)}
                      </TableCell>
                      <TableCell className="text-right"><Delta v={d.adrYoy} /></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Booking Window ─────────────────────────────────────────

const bwConfig: ChartConfig = {
  bw: { label: "Listing", color: "var(--chart-1)" },
  mBw: { label: "Market", color: "var(--muted-foreground)" },
  bwLy: { label: "Listing LY", color: "var(--chart-3)" },
}

function bwBucket(days: number | null) {
  if (days == null) return null
  if (days <= 30) return { label: "Last-minute", cls: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400" }
  if (days <= 90) return { label: "Pickup chase", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" }
  if (days <= 120) return { label: "Far-out", cls: "bg-muted text-muted-foreground" }
  return { label: "Anchor", cls: "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400" }
}

export function ReportBookingWindow({ report }: { report: ListingReport | null }) {
  const months = useMemo(() => (report ? prepareMonths(report.metrics) : []), [report])
  if (!report || months.length === 0) return <NoReport />

  const data = months.map((d) => ({ label: d.label, bw: d.bw, mBw: d.mBw, bwLy: d.bwLy }))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="size-4" /> Median booking window
          </CardTitle>
          <CardDescription>Days before check-in · higher = guests book earlier</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={bwConfig} className="h-[280px] w-full">
            <LineChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={36} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ReferenceLine y={30} stroke="var(--muted-foreground)" strokeDasharray="3 4" strokeOpacity={0.5} />
              <ReferenceLine y={90} stroke="var(--muted-foreground)" strokeDasharray="3 4" strokeOpacity={0.5} />
              <Line dataKey="bw" stroke="var(--color-bw)" strokeWidth={2.2} dot={{ r: 2.5 }} connectNulls />
              <Line dataKey="mBw" stroke="var(--color-mBw)" strokeWidth={1.8} strokeDasharray="5 4" dot={false} connectNulls />
              <Line dataKey="bwLy" stroke="var(--color-bwLy)" strokeWidth={1.5} dot={false} connectNulls />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Window detail</CardTitle>
          <CardDescription>
            ≤30d last-minute · 31–90d pickup chase · 91–120d far-out · 120d+ anchor (by market window)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Listing</TableHead>
                  <TableHead className="text-right">Market</TableHead>
                  <TableHead className="text-right">Δ vs Mkt</TableHead>
                  <TableHead className="text-right">Listing LY</TableHead>
                  <TableHead>Demand pattern</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((d) => {
                  const diff = d.bw != null && d.mBw != null ? d.bw - d.mBw : null
                  const b = bwBucket(d.mBw)
                  return (
                    <TableRow key={d.key} className={cn(d.past && "opacity-60")}>
                      <TableCell className="font-medium">{d.label}</TableCell>
                      <TableCell className={cn("text-right font-mono", d.bw == null ? "text-muted-foreground" : "font-semibold")}>
                        {d.bw == null ? "—" : `${fNum(d.bw)} d`}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{d.mBw != null ? `${fNum(d.mBw)} d` : "—"}</TableCell>
                      <TableCell className={cn("text-right font-mono font-semibold", diff == null ? "text-muted-foreground" : diff >= 0 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400")}>
                        {diff == null ? "—" : `${diff > 0 ? "+" : ""}${fNum(diff)} d`}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{d.bwLy != null ? `${fNum(d.bwLy)} d` : "—"}</TableCell>
                      <TableCell>
                        {b && <Badge variant="secondary" className={cn("text-[10px]", b.cls)}>{b.label}</Badge>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Pacing ─────────────────────────────────────────────────

const pacingConfig: ChartConfig = {
  otb: { label: "On the books", color: "var(--chart-1)" },
  openInv: { label: "Open inventory", color: "var(--chart-3)" },
  lyFinal: { label: "LY final", color: "var(--chart-4)" },
}

export function ReportPacing({ report }: { report: ListingReport | null }) {
  const months = useMemo(() => (report ? prepareMonths(report.metrics) : []), [report])
  if (!report || months.length === 0) return <NoReport />

  const now = currentMonthKey()
  const data = months.map((d) => ({ label: d.label, otb: d.rev, openInv: d.pot, lyFinal: d.ly }))
  const totals = {
    rev: months.reduce((s, d) => s + d.rev, 0),
    stly: months.reduce((s, d) => s + (d.stly ?? 0), 0),
    ly: months.reduce((s, d) => s + (d.ly ?? 0), 0),
    pot: months.reduce((s, d) => s + d.pot, 0),
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4" /> Booked vs still bookable
          </CardTitle>
          <CardDescription>On the books + open inventory at final price; dashed = last year final close</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={pacingConfig} className="h-[300px] w-full">
            <ComposedChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="otb" stackId="a" fill="var(--color-otb)" maxBarSize={30} />
              <Bar dataKey="openInv" stackId="a" fill="var(--color-openInv)" radius={[4, 4, 0, 0]} maxBarSize={30} />
              <Line dataKey="lyFinal" stroke="var(--color-lyFinal)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly pacing detail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">OTB</TableHead>
                  <TableHead className="text-right">STLY</TableHead>
                  <TableHead className="text-right">vs STLY</TableHead>
                  <TableHead className="text-right">LY Final</TableHead>
                  <TableHead className="text-right">% of LY</TableHead>
                  <TableHead className="text-right">Occ</TableHead>
                  <TableHead className="text-right">Open Inv.</TableHead>
                  <TableHead className="text-right">Ceiling</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((d) => (
                  <TableRow key={d.key} className={cn(d.past && "opacity-60")}>
                    <TableCell className="font-medium">
                      {d.label}
                      {d.key === now && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">NOW</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">{f$(d.rev)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{d.stly && d.stly > 0 ? f$(d.stly) : "—"}</TableCell>
                    <TableCell className="text-right"><Delta v={d.yoy} /></TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{f$(d.ly)}</TableCell>
                    <TableCell className={cn("text-right font-mono", d.pctLy != null && d.pctLy >= 100 ? "text-green-600 dark:text-green-400" : "text-muted-foreground")}>
                      {d.pctLy != null ? `${d.pctLy.toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{d.occ != null ? `${d.occ.toFixed(0)}%` : "—"}</TableCell>
                    <TableCell className={cn("text-right font-mono", d.pot > 0 ? "text-foreground" : "text-muted-foreground")}>{d.pot > 0 ? f$(d.pot) : "—"}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{f$(d.ceiling)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-mono font-bold">{f$(totals.rev)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{f$(totals.stly)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono text-muted-foreground">{f$(totals.ly)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{totals.ly > 0 ? `${((totals.rev / totals.ly) * 100).toFixed(0)}%` : "—"}</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono text-muted-foreground">{f$(totals.pot)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{f$(totals.rev + totals.pot)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
