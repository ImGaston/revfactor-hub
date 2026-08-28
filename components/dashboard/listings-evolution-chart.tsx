"use client"

import * as React from "react"
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts"

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import type { MonthlyEvolutionPoint } from "@/lib/monthly-summary"

const evolutionConfig: ChartConfig = {
  active: { label: "Active", color: "hsl(221 83% 42%)" },
  added: { label: "New", color: "hsl(152 60% 40%)" },
  churned: { label: "Churned", color: "hsl(0 65% 55%)" },
}

function formatPeriod(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  const [y, m] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    year: "2-digit",
    ...opts,
  })
}

type ChartPoint = MonthlyEvolutionPoint & { churnedNeg: number }

type TooltipPayloadItem = { payload?: ChartPoint }

function EvolutionTooltip({
  active,
  payload,
  activeLabel,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  activeLabel: string
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  return (
    <div className="grid min-w-44 gap-1.5 rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
      <div className="font-medium">
        {formatPeriod(point.month, { month: "long", year: "numeric" })}
      </div>
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <div
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: evolutionConfig.active.color as string }}
            />
            <span className="text-muted-foreground">{activeLabel}</span>
          </div>
          <span className="font-mono font-medium tabular-nums">
            {point.active}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <div
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: evolutionConfig.added.color as string }}
            />
            <span className="text-muted-foreground">New</span>
          </div>
          <span className="font-mono tabular-nums">+{point.added}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <div
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: evolutionConfig.churned.color as string }}
            />
            <span className="text-muted-foreground">Churned</span>
          </div>
          <span className="font-mono tabular-nums">−{point.churned}</span>
        </div>
        <div className="mt-1 flex items-center justify-between border-t pt-1.5">
          <span className="text-muted-foreground">Net</span>
          <span className="font-mono font-medium tabular-nums">
            {point.added - point.churned >= 0 ? "+" : ""}
            {point.added - point.churned}
          </span>
        </div>
      </div>
    </div>
  )
}

export function EvolutionChart({
  points,
  title,
  description,
}: {
  points: MonthlyEvolutionPoint[]
  title: string
  description: string
}) {
  const data: ChartPoint[] = React.useMemo(
    () => points.map((p) => ({ ...p, churnedNeg: -p.churned })),
    [points]
  )

  const barMax = React.useMemo(() => {
    const max = data.reduce((m, p) => Math.max(m, p.added, p.churned), 0)
    return Math.max(5, Math.ceil(max / 5) * 5)
  }, [data])

  const hasData = data.some((p) => p.active > 0 || p.added > 0 || p.churned > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            No lifecycle data yet.
          </div>
        ) : (
          <ChartContainer config={evolutionConfig} className="h-[220px] w-full">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatPeriod(v)}
                className="text-xs"
              />
              <YAxis
                yAxisId="active"
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                className="text-xs"
              />
              <YAxis
                yAxisId="delta"
                orientation="right"
                domain={[-barMax, barMax]}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                className="text-xs"
              />
              <ChartTooltip
                cursor={{
                  fill: "color-mix(in oklab, var(--muted) 40%, transparent)",
                }}
                content={<EvolutionTooltip activeLabel={`${title} (end of month)`} />}
              />
              <Bar
                yAxisId="delta"
                dataKey="added"
                fill="var(--color-added)"
                radius={[3, 3, 0, 0]}
                barSize={14}
                isAnimationActive={false}
              />
              <Bar
                yAxisId="delta"
                dataKey="churnedNeg"
                fill="var(--color-churned)"
                radius={[0, 0, 3, 3]}
                barSize={14}
                isAnimationActive={false}
              />
              <Line
                yAxisId="active"
                type="monotone"
                dataKey="active"
                stroke="var(--color-active)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "var(--color-active)", strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        )}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-3">
          {(["active", "added", "churned"] as const).map((key) => (
            <div key={key} className="flex items-center gap-1.5 text-xs">
              <div
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: evolutionConfig[key].color as string }}
              />
              <span className="text-muted-foreground">
                {evolutionConfig[key].label as string}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="text-[11px] text-muted-foreground/70 italic">
        Line = active at month end (left axis). Bars = new vs churned that
        month (right axis).
      </CardFooter>
    </Card>
  )
}
