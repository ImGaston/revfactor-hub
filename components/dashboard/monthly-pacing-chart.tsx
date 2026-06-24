"use client"

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { CalendarRange, Check, ChevronDown, Flame, TrendingUp, Zap } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  aggregateMonthlyPacing,
  type MonthlyPacingBucket,
  type MonthlyPacingPoint,
  type MonthlyPacingSource,
} from "@/lib/monthly-pacing"

// Same brand-blue ramp as the daily Pacing chart. Darkest = freshest pickup.
const pacingConfig: ChartConfig = {
  older: { label: "Booked 30+ days ago", color: "hsl(221 40% 85%)" },
  pickup_15_30d: { label: "Pickup 15–30 days", color: "hsl(221 55% 70%)" },
  pickup_8_14d: { label: "Pickup 8–14 days", color: "hsl(221 70% 55%)" },
  pickup_7d: { label: "Pickup last 7 days", color: "hsl(221 83% 42%)" },
}

const BUCKET_LABEL: Record<MonthlyPacingBucket, string> = {
  older: "30+ days ago",
  pickup_15_30d: "15–30 days",
  pickup_8_14d: "8–14 days",
  pickup_7d: "Last 7 days",
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

type TooltipPayloadItem = { payload?: MonthlyPacingPoint }

function PacingTooltip({
  active,
  payload,
  totalListings,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  totalListings: number
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  const ordered: MonthlyPacingBucket[] = [
    "pickup_7d",
    "pickup_8_14d",
    "pickup_15_30d",
    "older",
  ]

  return (
    <div className="grid min-w-48 gap-1.5 rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
      <div className="font-medium">
        {formatPeriod(point.period, { month: "long", year: "numeric" })}
      </div>
      <div className="grid gap-1">
        {ordered.map((key) => {
          const value = point[key]
          if (!value) return null
          return (
            <div key={key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <div
                  className="size-2 rounded-[2px]"
                  style={{ backgroundColor: pacingConfig[key].color as string }}
                />
                <span className="text-muted-foreground">{BUCKET_LABEL[key]}</span>
              </div>
              <span className="font-mono tabular-nums">{value}%</span>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex items-center justify-between border-t pt-1.5">
        <span className="text-muted-foreground">Occupancy</span>
        <span className="font-mono font-medium tabular-nums">
          {point.occupancy_pct}%
        </span>
      </div>
      <p className="mt-0.5 text-[10px] italic text-muted-foreground/70">
        Avg across {totalListings} listings · pickup = booking recency.
      </p>
    </div>
  )
}

function HighlightCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub: string
}) {
  return (
    <Card size="sm" className="bg-card/60">
      <CardContent className="px-4">
        <div className="flex items-start justify-between">
          <div className="rounded-lg bg-primary/10 p-2">
            <Icon className="size-4 text-primary" />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {value}
          </p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground/70">{sub}</p>
      </CardContent>
    </Card>
  )
}

type FilterOption = { value: string; label: string; sub?: string }

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  width = "w-64",
}: {
  label: string
  options: FilterOption[]
  selected: string[]
  onChange: (next: string[]) => void
  width?: string
}) {
  const [open, setOpen] = React.useState(false)
  const count = selected.length

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs font-normal"
        >
          {label}
          {count > 0 && (
            <span className="ml-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {count}
            </span>
          )}
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={cn("p-0", width)}>
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {count > 0 && (
              <CommandGroup>
                <CommandItem
                  onSelect={() => onChange([])}
                  className="text-xs text-muted-foreground"
                >
                  Clear selection
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((opt) => {
                const isSelected = selected.includes(opt.value)
                return (
                  <CommandItem
                    key={opt.value}
                    value={`${opt.label} ${opt.sub ?? ""}`}
                    onSelect={() => toggle(opt.value)}
                    className="flex items-center gap-2"
                  >
                    <div
                      className={cn(
                        "flex size-4 items-center justify-center rounded-sm border",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input"
                      )}
                    >
                      {isSelected && <Check className="size-3" />}
                    </div>
                    <div className="flex flex-1 flex-col">
                      <span className="text-xs">{opt.label}</span>
                      {opt.sub && (
                        <span className="text-[10px] text-muted-foreground">
                          {opt.sub}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function InteractiveLegend({
  hovered,
  setHovered,
}: {
  hovered: MonthlyPacingBucket | null
  setHovered: (b: MonthlyPacingBucket | null) => void
}) {
  const order: MonthlyPacingBucket[] = [
    "pickup_7d",
    "pickup_8_14d",
    "pickup_15_30d",
    "older",
  ]
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
      {order.map((key) => {
        const isHovered = hovered === key
        const isDimmed = hovered !== null && hovered !== key
        return (
          <button
            key={key}
            type="button"
            onMouseEnter={() => setHovered(key)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(key)}
            onBlur={() => setHovered(null)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-opacity",
              isDimmed && "opacity-40",
              isHovered && "bg-muted/60"
            )}
          >
            <div
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: pacingConfig[key].color as string }}
            />
            <span className="text-muted-foreground">
              {pacingConfig[key].label as string}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function MonthlyPacingChart({ source }: { source: MonthlyPacingSource }) {
  const [listingFilter, setListingFilter] = React.useState<string[]>([])
  const [clientFilter, setClientFilter] = React.useState<string[]>([])
  const [cityFilter, setCityFilter] = React.useState<string[]>([])
  const [hoveredBucket, setHoveredBucket] =
    React.useState<MonthlyPacingBucket | null>(null)

  const filteredListingIds = React.useMemo(() => {
    return source.listings
      .filter(
        (l) =>
          clientFilter.length === 0 ||
          (l.client_id !== null && clientFilter.includes(l.client_id))
      )
      .filter((l) => cityFilter.length === 0 || cityFilter.includes(l.city))
      .filter(
        (l) => listingFilter.length === 0 || listingFilter.includes(l.id)
      )
      .map((l) => l.id)
  }, [source.listings, listingFilter, clientFilter, cityFilter])

  const { months, highlights } = React.useMemo(
    () => aggregateMonthlyPacing(source, filteredListingIds),
    [source, filteredListingIds]
  )

  const totalListings = highlights.total_listings
  const hasData = months.length > 0
  const yMax = React.useMemo(() => {
    const max = months.reduce((m, p) => Math.max(m, p.occupancy_pct), 0)
    return Math.min(100, Math.max(20, Math.ceil(max / 10) * 10))
  }, [months])

  const listingOptions: FilterOption[] = React.useMemo(
    () =>
      source.listings.map((l) => ({
        value: l.id,
        label: l.name,
        sub: `${l.client_name} · ${l.city}`,
      })),
    [source.listings]
  )

  const clientOptions: FilterOption[] = React.useMemo(() => {
    const seen = new Map<string, string>()
    source.listings.forEach((l) => {
      if (l.client_id) seen.set(l.client_id, l.client_name)
    })
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [source.listings])

  const cityOptions: FilterOption[] = React.useMemo(() => {
    const cities = Array.from(new Set(source.listings.map((l) => l.city)))
    cities.sort()
    return cities.map((c) => ({ value: c, label: c }))
  }, [source.listings])

  const getBarOpacity = (bucket: MonthlyPacingBucket) =>
    hoveredBucket === null || hoveredBucket === bucket ? 1 : 0.15

  const renderEmpty = (msg: string) => (
    <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
      {msg}
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Monthly Pacing</CardTitle>
            <p className="text-xs text-muted-foreground">
              Occupancy % per month, layered by booking recency (pickup)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectFilter
              label="Listings"
              options={listingOptions}
              selected={listingFilter}
              onChange={setListingFilter}
              width="w-72"
            />
            <MultiSelectFilter
              label="Clients"
              options={clientOptions}
              selected={clientFilter}
              onChange={setClientFilter}
            />
            <MultiSelectFilter
              label="Cities"
              options={cityOptions}
              selected={cityFilter}
              onChange={setCityFilter}
              width="w-48"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Highlights row */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HighlightCard
            icon={CalendarRange}
            label="Avg occupancy"
            value={`${highlights.avg_occupancy_pct}%`}
            sub={`across ${months.length} months`}
          />
          <HighlightCard
            icon={TrendingUp}
            label="Avg pickup 15–30d"
            value={`${highlights.avg_pickup_15_30d}%`}
            sub="occupancy pts gained"
          />
          <HighlightCard
            icon={Flame}
            label="Avg pickup 8–14d"
            value={`${highlights.avg_pickup_8_14d}%`}
            sub="occupancy pts gained"
          />
          <HighlightCard
            icon={Zap}
            label="Avg pickup last 7d"
            value={`${highlights.avg_pickup_7d}%`}
            sub="freshest pickup"
          />
        </div>

        {!hasData ? (
          renderEmpty(
            source.runCompletedAt === null
              ? "No completed Report Builder run yet."
              : "No monthly metrics match the current filters."
          )
        ) : (
          <>
            <ChartContainer config={pacingConfig} className="h-[320px] w-full">
              <BarChart
                data={months}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-muted/30"
                />
                <XAxis
                  dataKey="period"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatPeriod(v)}
                  className="text-xs"
                />
                <YAxis
                  domain={[0, yMax]}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                  className="text-xs"
                />
                <ChartTooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                  content={<PacingTooltip totalListings={totalListings} />}
                />
                {/* Stack order: bottom -> top. Darkest (pickup_7d) on top. */}
                <Bar
                  dataKey="older"
                  stackId="pacing"
                  fill="var(--color-older)"
                  fillOpacity={getBarOpacity("older")}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="pickup_15_30d"
                  stackId="pacing"
                  fill="var(--color-pickup_15_30d)"
                  fillOpacity={getBarOpacity("pickup_15_30d")}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="pickup_8_14d"
                  stackId="pacing"
                  fill="var(--color-pickup_8_14d)"
                  fillOpacity={getBarOpacity("pickup_8_14d")}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="pickup_7d"
                  stackId="pacing"
                  fill="var(--color-pickup_7d)"
                  fillOpacity={getBarOpacity("pickup_7d")}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
            <InteractiveLegend
              hovered={hoveredBucket}
              setHovered={setHoveredBucket}
            />
          </>
        )}
      </CardContent>
      <CardFooter className="text-[11px] italic text-muted-foreground/70">
        Monthly occupancy split by booking recency. Portfolio = simple average
        across selected listings (not weighted by available nights).
      </CardFooter>
    </Card>
  )
}
