"use client"

import { useMemo, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { MonthlySummary, MonthlySummaryListing } from "@/lib/monthly-summary"
import {
  activeDaysInMonth,
  currentMonthISO,
  daysInMonth,
} from "@/lib/monthly-summary"
import { BILLING_ENTITY_LABEL, type BillingEntity } from "@/lib/billing-entity"

export type EntityFilter = BillingEntity | "all"

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number)
  const shifted = new Date(Date.UTC(y, m - 1 + delta, 1))
  return shifted.toISOString().slice(0, 7)
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const [y, m, d] = value.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

function ListingsTable({
  rows,
  dateHeader,
  dateOf,
  daysOf,
  showEntity,
  emptyText,
}: {
  rows: MonthlySummaryListing[]
  dateHeader: string
  dateOf: (row: MonthlySummaryListing) => string | null
  daysOf: (row: MonthlySummaryListing) => number
  showEntity: boolean
  emptyText: string
}) {
  return (
    <div className="rounded-md border w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Listing</TableHead>
            <TableHead className="w-[220px]">Client</TableHead>
            <TableHead className="w-[140px]">{dateHeader}</TableHead>
            <TableHead className="w-[70px] text-right">Days</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="text-center text-muted-foreground py-8"
              >
                {emptyText}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>
                  {row.client_name ? (
                    <span className="flex items-center gap-1.5 text-sm">
                      <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                      {row.client_name}
                      {showEntity && row.billing_entity === "blackbird" && (
                        <Badge variant="outline" className="ml-1">
                          Blackbird
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{formatDate(dateOf(row))}</TableCell>
                <TableCell className="text-sm text-right tabular-nums">
                  {daysOf(row)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function MonthlySummaryView({
  summary,
  entity,
  entityCounts,
  internalCount,
}: {
  summary: MonthlySummary
  entity: EntityFilter
  entityCounts: Record<BillingEntity, number>
  internalCount: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  const isCurrentMonth = summary.month === currentMonthISO()
  // The month in progress counts days to date, not the whole month.
  const asOf = isCurrentMonth ? new Date().toISOString().slice(0, 10) : undefined
  const daysOf = (row: MonthlySummaryListing) =>
    activeDaysInMonth(row, summary.month, asOf)
  // Churned listings were active part of the month but aren't in
  // activeListings (deactivated before month end), so add them back.
  const totalDays = [...summary.activeListings, ...summary.churnedListings].reduce(
    (sum, r) => sum + daysOf(r),
    0
  )
  const monthDays = asOf ? Number(asOf.slice(8)) : daysInMonth(summary.month)

  function navigate(month: string, nextEntity: EntityFilter) {
    const params = new URLSearchParams({ month })
    if (nextEntity !== "revfactor") params.set("entity", nextEntity)
    startTransition(() => {
      router.replace(`${pathname}?${params}`)
    })
  }

  function goToMonth(month: string) {
    navigate(month, entity)
  }

  const unknownCount =
    summary.unknownSetup.length + summary.unknownChurn.length

  const stats = useMemo(
    () => [
      { label: "Start of month", value: summary.startCount, icon: null },
      { label: "End of month", value: summary.endCount, icon: null },
      {
        label: "New this month",
        value: summary.newListings.length,
        icon: TrendingUp,
      },
      {
        label: "Churned this month",
        value: summary.churnedListings.length,
        icon: TrendingDown,
      },
      {
        label: asOf ? "Listing-days to date" : "Listing-days",
        value: totalDays,
        icon: CalendarDays,
      },
    ],
    [summary, totalDays, asOf]
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Monthly Summary
          </h1>
          <p className="text-sm text-muted-foreground">
            Active listings and portfolio changes for {monthLabel(summary.month)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            value={entity}
            onValueChange={(value) => {
              if (value) navigate(summary.month, value as EntityFilter)
            }}
            disabled={pending}
            aria-label="Billing entity"
          >
            {(["revfactor", "blackbird"] as const).map((key) => (
              <ToggleGroupItem key={key} value={key} className="gap-1.5 px-3">
                {BILLING_ENTITY_LABEL[key]}
                <span className="text-muted-foreground tabular-nums">
                  {entityCounts[key]}
                </span>
              </ToggleGroupItem>
            ))}
            <ToggleGroupItem value="all" className="px-3">
              All
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            disabled={pending}
            onClick={() => goToMonth(shiftMonth(summary.month, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            type="month"
            className="w-[170px]"
            value={summary.month}
            disabled={pending}
            onChange={(e) => {
              if (e.target.value) goToMonth(e.target.value)
            }}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            disabled={pending || isCurrentMonth}
            onClick={() => goToMonth(shiftMonth(summary.month, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {stat.icon && <stat.icon className="size-4" />}
                  {stat.label}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {(unknownCount > 0 || internalCount > 0) && (
        <p className="text-xs text-muted-foreground">
          {internalCount > 0 && (
            <>
              {internalCount} listing{internalCount === 1 ? "" : "s"} managed
              by RevFactor (not hostpricing) excluded.
            </>
          )}{" "}
          {summary.unknownSetup.length > 0 && (
            <>
              {summary.unknownSetup.length} listing
              {summary.unknownSetup.length === 1 ? "" : "s"} without an initial
              setup date counted as carried over (never shown as new).
            </>
          )}{" "}
          {summary.unknownChurn.length > 0 && (
            <>
              {summary.unknownChurn.length} inactive listing
              {summary.unknownChurn.length === 1 ? "" : "s"} without a
              deactivation date excluded from all counts.
            </>
          )}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-medium flex items-center gap-1.5">
            <TrendingUp className="size-4 text-green-600 dark:text-green-500" />
            New listings
            <Badge variant="secondary">{summary.newListings.length}</Badge>
          </h2>
          <ListingsTable
            rows={summary.newListings}
            dateHeader="Setup date"
            dateOf={(r) => r.initial_setup_date}
            daysOf={daysOf}
            showEntity={entity === "all"}
            emptyText="No new listings this month"
          />
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium flex items-center gap-1.5">
            <TrendingDown className="size-4 text-red-600 dark:text-red-500" />
            Churned listings
            <Badge variant="secondary">{summary.churnedListings.length}</Badge>
          </h2>
          <ListingsTable
            rows={summary.churnedListings}
            dateHeader="Deactivated"
            dateOf={(r) => r.deactivated_date}
            daysOf={daysOf}
            showEntity={entity === "all"}
            emptyText="No churned listings this month"
          />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          Active at end of month
          <Badge variant="secondary">{summary.activeListings.length}</Badge>
          <span className="text-xs font-normal text-muted-foreground">
            {totalDays} listing-days incl. churned · {monthDays} day
            {monthDays === 1 ? "" : "s"} {asOf ? "so far" : "in month"}
          </span>
        </h2>
        <ListingsTable
          rows={summary.activeListings}
          dateHeader="Setup date"
          dateOf={(r) => r.initial_setup_date}
          daysOf={daysOf}
          showEntity={entity === "all"}
          emptyText="No active listings"
        />
      </div>
    </div>
  )
}
