"use client"

import { useMemo, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { MonthlySummary, MonthlySummaryListing } from "@/lib/monthly-summary"
import { currentMonthISO } from "@/lib/monthly-summary"

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
  emptyText,
}: {
  rows: MonthlySummaryListing[]
  dateHeader: string
  dateOf: (row: MonthlySummaryListing) => string | null
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={3}
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
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{formatDate(dateOf(row))}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function MonthlySummaryView({ summary }: { summary: MonthlySummary }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  const isCurrentMonth = summary.month === currentMonthISO()

  function goToMonth(month: string) {
    startTransition(() => {
      router.replace(`${pathname}?month=${month}`)
    })
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
    ],
    [summary]
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
        <div className="flex items-center gap-2">
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      {unknownCount > 0 && (
        <p className="text-xs text-muted-foreground">
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
            emptyText="No churned listings this month"
          />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          Active at end of month
          <Badge variant="secondary">{summary.activeListings.length}</Badge>
        </h2>
        <ListingsTable
          rows={summary.activeListings}
          dateHeader="Setup date"
          dateOf={(r) => r.initial_setup_date}
          emptyText="No active listings"
        />
      </div>
    </div>
  )
}
