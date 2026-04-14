"use client"

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  CalendarRange,
  Check,
  ChevronDown,
  Flame,
  TrendingUp,
  Zap,
} from "lucide-react"

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { PacingBucket, PacingDayPoint } from "@/lib/pacing"
import { aggregatePacing, type PacingSource } from "@/lib/pacing-mock"

// Brand blue stepped on saturation + lightness so adjacent shades clear the
// 1.5:1 non-text contrast threshold. Darkest = freshest bookings.
const pacingConfig: ChartConfig = {
  older: { label: "Booked 14+ days ago", color: "hsl(221 40% 85%)" },
  last_14d: { label: "Booked 7–14 days ago", color: "hsl(221 55% 70%)" },
  last_7d: { label: "Booked 3–7 days ago", color: "hsl(221 70% 55%)" },
  last_3d: { label: "Booked last 3 days", color: "hsl(221 83% 42%)" },
}

const BUCKET_LABEL: Record<PacingBucket, string> = {
  older: "14+ days ago",
  last_14d: "7–14 days ago",
  last_7d: "3–7 days ago",
  last_3d: "Last 3 days",
}

const MS_PER_DAY = 86_400_000

type RangePreset = "3m" | "6m" | "1y" | "current_year"

const RANGE_LABELS: Record<RangePreset, string> = {
  "3m": "3 months",
  "6m": "6 months",
  "1y": "1 year",
  current_year: "Current year",
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function computeRange(
  todayIso: string,
  preset: RangePreset
): { startIso: string; endIso: string } {
  const today = parseISO(todayIso)
  const year = today.getUTCFullYear()
  if (preset === "current_year") {
    return {
      startIso: toISO(new Date(Date.UTC(year, 0, 1))),
      endIso: toISO(new Date(Date.UTC(year, 11, 31))),
    }
  }
  const daysForward = preset === "3m" ? 90 : preset === "6m" ? 180 : 365
  const end = new Date(today.getTime() + (daysForward - 1) * MS_PER_DAY)
  return { startIso: todayIso, endIso: toISO(end) }
}

function formatDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  const date = parseISO(iso)
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...opts,
  })
}

function formatRangeLabel(startIso: string, endIso: string): string {
  const start = parseISO(startIso)
  const end = parseISO(endIso)
  const fmt: Intl.DateTimeFormatOptions = {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }
  const s = start.toLocaleDateString("en-US", fmt)
  const e = end.toLocaleDateString("en-US", fmt)
  return `${s} → ${e}`
}

function pickTickInterval(numDays: number): number {
  if (numDays <= 65) return 7
  if (numDays <= 130) return 14
  if (numDays <= 200) return 21
  if (numDays <= 280) return 30
  return 45
}

type TooltipPayloadItem = {
  dataKey?: string | number
  name?: string | number
  value?: number
  color?: string
  payload?: PacingDayPoint
}

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

  const ordered: PacingBucket[] = ["last_3d", "last_7d", "last_14d", "older"]

  return (
    <div className="grid min-w-44 gap-1.5 rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
      <div className="font-medium">
        {formatDate(point.stay_date, { weekday: "short", year: "numeric" })}
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
              <span className="font-mono tabular-nums">{value}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex items-center justify-between border-t pt-1.5">
        <span className="text-muted-foreground">Total</span>
        <span className="font-mono font-medium tabular-nums">
          {point.booked_total} ({point.booked_pct}%)
        </span>
      </div>
      <p className="mt-0.5 text-[10px] italic text-muted-foreground/70">
        Based on {totalListings} listings. Manual blocks not excluded.
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
  value: number
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
            {value.toLocaleString()}
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

function RangeDropdown({
  preset,
  onChange,
  startIso,
  endIso,
}: {
  preset: RangePreset
  onChange: (next: RangePreset) => void
  startIso: string
  endIso: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs font-normal"
        >
          {formatRangeLabel(startIso, endIso)}
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {(Object.keys(RANGE_LABELS) as RangePreset[]).map((key) => (
          <DropdownMenuItem
            key={key}
            onSelect={() => onChange(key)}
            className="justify-between text-xs"
          >
            {RANGE_LABELS[key]}
            {preset === key && <Check className="size-3" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function InteractiveLegend({
  hovered,
  setHovered,
}: {
  hovered: PacingBucket | null
  setHovered: (b: PacingBucket | null) => void
}) {
  const order: PacingBucket[] = ["last_3d", "last_7d", "last_14d", "older"]
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

export function PacingChart({ source }: { source: PacingSource }) {
  const [preset, setPreset] = React.useState<RangePreset>("6m")
  const [listingFilter, setListingFilter] = React.useState<string[]>([])
  const [clientFilter, setClientFilter] = React.useState<string[]>([])
  const [stateFilter, setStateFilter] = React.useState<string[]>([])
  const [hoveredBucket, setHoveredBucket] = React.useState<PacingBucket | null>(
    null
  )

  const { startIso, endIso } = React.useMemo(
    () => computeRange(source.today, preset),
    [source.today, preset]
  )

  const filteredListingIds = React.useMemo(() => {
    return source.listings
      .filter(
        (l) => clientFilter.length === 0 || clientFilter.includes(l.client_id)
      )
      .filter(
        (l) => stateFilter.length === 0 || stateFilter.includes(l.state)
      )
      .filter(
        (l) => listingFilter.length === 0 || listingFilter.includes(l.id)
      )
      .map((l) => l.id)
  }, [source.listings, listingFilter, clientFilter, stateFilter])

  const { days, highlights } = React.useMemo(
    () => aggregatePacing(source, startIso, endIso, filteredListingIds),
    [source, startIso, endIso, filteredListingIds]
  )

  const totalListings = highlights.total_listings
  const possibleNights = totalListings * days.length
  const hasReservations = highlights.total_booked_nights > 0
  const hasListings = totalListings > 0

  const listingOptions: FilterOption[] = React.useMemo(
    () =>
      source.listings.map((l) => ({
        value: l.id,
        label: l.name,
        sub: `${l.client_name} · ${l.state}`,
      })),
    [source.listings]
  )

  const clientOptions: FilterOption[] = React.useMemo(() => {
    const seen = new Map<string, string>()
    source.listings.forEach((l) => seen.set(l.client_id, l.client_name))
    return Array.from(seen.entries()).map(([value, label]) => ({
      value,
      label,
    }))
  }, [source.listings])

  const stateOptions: FilterOption[] = React.useMemo(() => {
    const states = Array.from(new Set(source.listings.map((l) => l.state)))
    states.sort()
    return states.map((s) => ({ value: s, label: s }))
  }, [source.listings])

  const tickInterval = pickTickInterval(days.length)
  const tickFormatter = (value: string, index: number) => {
    if (index % tickInterval !== 0) return ""
    const opts: Intl.DateTimeFormatOptions =
      days.length > 130 ? { month: "short" } : { month: "short", day: "numeric" }
    return formatDate(value, opts)
  }

  const getBarOpacity = (bucket: PacingBucket) =>
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
            <CardTitle>Pacing</CardTitle>
            <p className="text-xs text-muted-foreground">
              Daily booked % across the portfolio, layered by booking recency
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
              label="States"
              options={stateOptions}
              selected={stateFilter}
              onChange={setStateFilter}
              width="w-40"
            />
            <RangeDropdown
              preset={preset}
              onChange={setPreset}
              startIso={startIso}
              endIso={endIso}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Highlights row */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HighlightCard
            icon={CalendarRange}
            label="Total booked nights"
            value={highlights.total_booked_nights}
            sub={
              possibleNights > 0
                ? `of ${possibleNights.toLocaleString()} possible`
                : "no listings selected"
            }
          />
          <HighlightCard
            icon={TrendingUp}
            label="Booked last 14 days"
            value={highlights.booked_last_14d}
            sub="within selected range"
          />
          <HighlightCard
            icon={Flame}
            label="Booked last 7 days"
            value={highlights.booked_last_7d}
            sub="within selected range"
          />
          <HighlightCard
            icon={Zap}
            label="Booked last 3 days"
            value={highlights.booked_last_3d}
            sub="freshest pickup"
          />
        </div>

        {!hasListings ? (
          renderEmpty("No listings match the current filters.")
        ) : !hasReservations ? (
          renderEmpty("No reservations in the selected range.")
        ) : (
          <>
            <ChartContainer config={pacingConfig} className="h-[320px] w-full">
              <BarChart
                data={days}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-muted/30"
                />
                <XAxis
                  dataKey="stay_date"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tickFormatter={tickFormatter}
                  className="text-xs"
                />
                <YAxis
                  domain={[0, totalListings]}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    totalListings > 0
                      ? `${Math.round((v / totalListings) * 100)}%`
                      : `${v}`
                  }
                  className="text-xs"
                />
                <ChartTooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                  content={<PacingTooltip totalListings={totalListings} />}
                />
                {/* Stack order: bottom -> top. Darkest (last_3d) is on top */}
                <Bar
                  dataKey="older"
                  stackId="pacing"
                  fill="var(--color-older)"
                  fillOpacity={getBarOpacity("older")}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="last_14d"
                  stackId="pacing"
                  fill="var(--color-last_14d)"
                  fillOpacity={getBarOpacity("last_14d")}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="last_7d"
                  stackId="pacing"
                  fill="var(--color-last_7d)"
                  fillOpacity={getBarOpacity("last_7d")}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="last_3d"
                  stackId="pacing"
                  fill="var(--color-last_3d)"
                  fillOpacity={getBarOpacity("last_3d")}
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
        Booked % uses selected listings as the denominator. Manual blocks not
        excluded.
      </CardFooter>
    </Card>
  )
}
