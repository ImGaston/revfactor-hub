"use client"

// Range picker for URL-driven list filters: one trigger button showing the
// active range, a two-month calendar, and quick presets. Values cross the
// boundary as YYYY-MM-DD strings (or null to clear) so callers can drop them
// straight into searchParams; Dates are built with local-time constructors on
// purpose — new Date("YYYY-MM-DD") parses as UTC and shifts a day west of it.
//
// Presets are RELATIVE: choosing one emits `preset` (a DateRangePresetKey)
// with from/to null, and the caller is expected to persist the key (e.g.
// ?range=last30) and resolve it server-side. Picking calendar dates emits
// absolute from/to with preset null.

import { useState } from "react"
import { Calendar as CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  DATE_RANGE_PRESETS,
  dateRangePresetLabel,
  isDateRangePresetKey,
  resolveDateRangePreset,
  type DateRangePresetKey,
} from "@/lib/date-range-presets"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type DateRangeValue = {
  preset: DateRangePresetKey | null
  from: string | null // YYYY-MM-DD
  to: string | null // YYYY-MM-DD
}

function parseIsoDate(value?: string | null): Date | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatShort(date: Date, withYear: boolean): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  })
}

function rangeLabel(from?: Date, to?: Date): string {
  if (from && to) {
    const sameYear = from.getFullYear() === to.getFullYear()
    return `${formatShort(from, !sameYear)} – ${formatShort(to, true)}`
  }
  if (from) return `From ${formatShort(from, true)}`
  if (to) return `Through ${formatShort(to, true)}`
  return "All dates"
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
}

export function DateRangePicker({
  preset,
  from,
  to,
  onChange,
  className,
}: {
  preset?: string // active DateRangePresetKey, wins over from/to
  from?: string // YYYY-MM-DD
  to?: string // YYYY-MM-DD
  onChange: (value: DateRangeValue) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()

  const activePreset = isDateRangePresetKey(preset) ? preset : null
  const resolved = activePreset ? resolveDateRangePreset(activePreset) : null
  const fromDate = parseIsoDate(resolved ? resolved.from : from)
  const toDate = parseIsoDate(resolved ? resolved.to : to)
  const hasRange = Boolean(activePreset || fromDate || toDate)

  function emitDates(range: DateRange | undefined) {
    onChange({
      preset: null,
      from: range?.from ? toIsoDate(range.from) : null,
      to: range?.to ? toIsoDate(range.to) : null,
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "justify-start font-normal",
            !hasRange && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="size-3.5 text-muted-foreground shrink-0" />
          {activePreset
            ? dateRangePresetLabel(activePreset)
            : rangeLabel(fromDate, toDate)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-[calc(100vw-1rem)] p-0"
        align="start"
        collisionPadding={8}
      >
        {/* On phones the two-month grid plus a preset column cannot fit, so
            presets become a wrap row on top and the calendar drops to one
            month. md: matches useIsMobile's 768px so the preset layout and
            the month count flip together. */}
        <div className="flex flex-col md:flex-row">
          <div className="flex flex-row flex-wrap gap-0.5 border-b p-2 md:flex-col md:border-b-0 md:border-r">
            {DATE_RANGE_PRESETS.map((p) => (
              <Button
                key={p.key}
                variant={activePreset === p.key ? "secondary" : "ghost"}
                size="sm"
                className="justify-start font-normal"
                onClick={() => {
                  onChange({ preset: p.key, from: null, to: null })
                  setOpen(false)
                }}
              >
                {p.label}
              </Button>
            ))}
            {hasRange && (
              <Button
                variant="ghost"
                size="sm"
                className="justify-start font-normal text-muted-foreground"
                onClick={() => {
                  onChange({ preset: null, from: null, to: null })
                  setOpen(false)
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <Calendar
            mode="range"
            selected={{ from: fromDate, to: toDate }}
            onSelect={emitDates}
            numberOfMonths={isMobile ? 1 : 2}
            defaultMonth={fromDate ?? startOfMonth(addDays(new Date(), -30))}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
