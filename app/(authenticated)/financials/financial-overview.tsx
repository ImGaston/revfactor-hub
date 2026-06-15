"use client"

import { useState } from "react"
import {
  AlertTriangle,
  Landmark,
  PiggyBank,
  Receipt,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  addMonths,
  allocateProfitFirst,
  buildForecast,
  calculateRunwayMonths,
  monthKey,
} from "@/lib/financial-planning"
import type {
  BankTransaction,
  Expense,
  FinancialCashSnapshot,
  StripePayout,
} from "@/lib/types"
import { saveCashSnapshot } from "./actions"

type ListingRef = {
  id: string
  name: string
  stripe_subscription_id: string | null
}

type PayoutTransaction = {
  payout_id: string
  net_cents: number
  subscription_id: string | null
}

const chartConfig: ChartConfig = {
  cash: { label: "Cash received", color: "var(--chart-2)" },
  opex: { label: "OPEX allocation", color: "var(--chart-4)" },
  contribution: { label: "Contribución", color: "var(--chart-2)" },
  margin: { label: "Margen %", color: "var(--chart-1)" },
  opexRemaining: { label: "OPEX restante %", color: "var(--chart-4)" },
}

function currency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export function FinancialOverview({
  payouts,
  payoutTransactions,
  expenses,
  listings,
  cashSnapshot,
  bankTransactions,
}: {
  payouts: StripePayout[]
  payoutTransactions: PayoutTransaction[]
  expenses: Expense[]
  listings: ListingRef[]
  cashSnapshot: FinancialCashSnapshot | null
  bankTransactions: BankTransaction[]
}) {
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [operatingCash, setOperatingCash] = useState(
    String((Number(cashSnapshot?.operating_cash_cents ?? 0) / 100).toFixed(2))
  )
  const [taxCash, setTaxCash] = useState(
    String((Number(cashSnapshot?.tax_cash_cents ?? 0) / 100).toFixed(2))
  )
  const [savingSnapshot, setSavingSnapshot] = useState(false)

  const now = new Date()
  const currentMonth = monthKey(now)
  const paidPayouts = payouts.filter(
    (payout) =>
      payout.status === "paid" &&
      payout.currency === "usd" &&
      payout.arrival_date.slice(0, 7) === currentMonth
  )
  const currentCashCents = paidPayouts.reduce(
    (sum, payout) => sum + Number(payout.amount_cents),
    0
  )
  const profitFirst = paidPayouts.reduce(
    (total, payout) => {
      const allocation = allocateProfitFirst(Number(payout.amount_cents))
      return {
        partnerACents: total.partnerACents + allocation.partnerACents,
        partnerBCents: total.partnerBCents + allocation.partnerBCents,
        taxCents: total.taxCents + allocation.taxCents,
        opexCents: total.opexCents + allocation.opexCents,
      }
    },
    { partnerACents: 0, partnerBCents: 0, taxCents: 0, opexCents: 0 }
  )

  const monthExpenses = expenses.filter((expense) =>
    expense.date.startsWith(currentMonth)
  )
  const paidExpensesCents = monthExpenses
    .filter((expense) => expense.is_paid)
    .reduce((sum, expense) => sum + Math.round(Number(expense.amount) * 100), 0)
  const committedExpensesCents = monthExpenses.reduce(
    (sum, expense) => sum + Math.round(Number(expense.amount) * 100),
    0
  )
  const opexVarianceCents = profitFirst.opexCents - committedExpensesCents

  const monthlyHistory = (() => {
    const rows = new Map<string, number>()
    for (let offset = 11; offset >= 0; offset--) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
      rows.set(monthKey(date), 0)
    }
    for (const payout of payouts) {
      if (payout.status !== "paid" || payout.currency !== "usd") continue
      const key = payout.arrival_date.slice(0, 7)
      if (rows.has(key))
        rows.set(key, (rows.get(key) ?? 0) + Number(payout.amount_cents))
    }
    return [...rows].map(([month, cash]) => ({
      month: new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
      }),
      cash: cash / 100,
      opex: allocateProfitFirst(cash).opexCents / 100,
    }))
  })()

  const averageCashCents = Math.round(
    monthlyHistory.slice(-3).reduce((sum, row) => sum + row.cash * 100, 0) / 3
  )
  // Average real expenses over the trailing 3 months (actual expenses, not a
  // recurring-expense template).
  const averageMonthlyExpensesCents = Math.round(
    (() => {
      let total = 0
      for (let offset = 2; offset >= 0; offset--) {
        const key = monthKey(
          new Date(now.getFullYear(), now.getMonth() - offset, 1)
        )
        total += expenses
          .filter((expense) => expense.date.startsWith(key))
          .reduce(
            (sum, expense) => sum + Math.round(Number(expense.amount) * 100),
            0
          )
      }
      return total / 3
    })()
  )
  const forecastEvents =
    averageMonthlyExpensesCents > 0
      ? [
          {
            id: "expenses",
            kind: "variable_expense" as const,
            description: "Average monthly expenses",
            amountCents: averageMonthlyExpensesCents,
            recurrence: "monthly" as const,
            startMonth: currentMonth,
            endMonth: null,
          },
        ]
      : []
  const forecast = buildForecast({
    startMonth: currentMonth,
    horizonMonths: 12,
    openingCashCents: Number(cashSnapshot?.operating_cash_cents ?? 0),
    listings: [
      {
        id: "baseline",
        name: "Current payout run rate",
        monthlyRevenueCents: averageCashCents,
        startMonth: currentMonth,
        endMonth: null,
      },
    ],
    events: forecastEvents,
  })
  const runway = calculateRunwayMonths(forecast)

  const currentPayoutIds = new Set(paidPayouts.map((payout) => payout.id))
  const listingsBySubscription = new Map<string, ListingRef[]>()
  for (const listing of listings) {
    if (!listing.stripe_subscription_id) continue
    const existing =
      listingsBySubscription.get(listing.stripe_subscription_id) ?? []
    existing.push(listing)
    listingsBySubscription.set(listing.stripe_subscription_id, existing)
  }

  // Attribute reconciled payout cash to listings for a given set of payouts,
  // splitting each transaction's net evenly across its subscription's listings.
  const buildListingCash = (payoutIds: Set<string>) => {
    const result = new Map<string, number>()
    for (const transaction of payoutTransactions) {
      if (!payoutIds.has(transaction.payout_id)) continue
      const linked = transaction.subscription_id
        ? (listingsBySubscription.get(transaction.subscription_id) ?? [])
        : []
      if (linked.length === 0) continue
      const baseShare = Math.trunc(Number(transaction.net_cents) / linked.length)
      let remainder = Number(transaction.net_cents) - baseShare * linked.length
      for (const listing of linked) {
        const share = baseShare + (remainder > 0 ? 1 : remainder < 0 ? -1 : 0)
        remainder += remainder > 0 ? -1 : remainder < 0 ? 1 : 0
        result.set(listing.id, (result.get(listing.id) ?? 0) + share)
      }
    }
    return result
  }

  const listingCash = buildListingCash(currentPayoutIds)
  // Aggregate unit economics. Variable expenses lower the total margin whether
  // or not they are allocated to a specific listing; unallocated ones are simply
  // absorbed at the portfolio level.
  const totalCashCents = [...listingCash.values()].reduce(
    (sum, value) => sum + value,
    0
  )
  const listingsWithCash = [...listingCash.values()].filter(
    (value) => value !== 0
  ).length
  // Per-listing figures divide by the total active listing count. We have no
  // history of when each listing was added, so the current active set is
  // treated as constant across all months.
  const activeListingsCount = listings.length
  const totalVariableExpensesCents = monthExpenses
    .filter((expense) => expense.type === "variable")
    .reduce((sum, expense) => sum + Math.round(Number(expense.amount) * 100), 0)
  const totalContributionCents = totalCashCents - totalVariableExpensesCents
  const marginPct =
    totalCashCents > 0
      ? Math.round((totalContributionCents / totalCashCents) * 100)
      : null
  const perListing = (cents: number) =>
    activeListingsCount > 0 ? Math.round(cents / activeListingsCount) : 0

  // Month-by-month evolution, from January of the current year to this month.
  const months: string[] = []
  for (
    let month = `${now.getFullYear()}-01`;
    month <= currentMonth;
    month = addMonths(month, 1)
  ) {
    months.push(month)
  }
  const monthlySeries = months.map((month) => {
    const monthPayouts = payouts.filter(
      (payout) =>
        payout.status === "paid" &&
        payout.currency === "usd" &&
        payout.arrival_date.slice(0, 7) === month
    )
    const incomeCents = monthPayouts.reduce(
      (sum, payout) => sum + Number(payout.amount_cents),
      0
    )
    const opexBudgetCents = allocateProfitFirst(incomeCents).opexCents
    const monthExp = expenses.filter((expense) => expense.date.startsWith(month))
    const allExpensesCents = monthExp.reduce(
      (sum, expense) => sum + Math.round(Number(expense.amount) * 100),
      0
    )
    const variableCents = monthExp
      .filter((expense) => expense.type === "variable")
      .reduce((sum, expense) => sum + Math.round(Number(expense.amount) * 100), 0)
    const cashMap = buildListingCash(new Set(monthPayouts.map((p) => p.id)))
    const attributedCashCents = [...cashMap.values()].reduce(
      (sum, value) => sum + value,
      0
    )
    const contributionCents = attributedCashCents - variableCents
    return {
      month,
      label: new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
      }),
      incomeCents,
      opexBudgetCents,
      allExpensesCents,
      variableCents,
      attributedCashCents,
      listingsCount: activeListingsCount,
      contributionCents,
      marginPct:
        attributedCashCents > 0
          ? Math.round((contributionCents / attributedCashCents) * 100)
          : null,
      opexRemainingPct:
        opexBudgetCents > 0
          ? Math.round(
              ((opexBudgetCents - allExpensesCents) / opexBudgetCents) * 100
            )
          : null,
      perListingContributionCents:
        activeListingsCount > 0
          ? Math.round(contributionCents / activeListingsCount)
          : 0,
    }
  })
  const evolutionChart = monthlySeries.map((row) => ({
    month: row.label,
    contribution: row.contributionCents / 100,
    margin: row.marginPct,
    opexRemaining: row.opexRemainingPct,
  }))

  const unreconciled = paidPayouts.filter(
    (payout) => payout.automatic && payout.reconciliation_status !== "completed"
  ).length

  const monthBankTxns = bankTransactions.filter((transaction) =>
    transaction.txn_date.startsWith(currentMonth)
  )
  const bankStripeDeposits = monthBankTxns.filter(
    (transaction) =>
      transaction.flow_class === "external_income" &&
      (transaction.payee ?? "").toLowerCase().includes("stripe")
  )
  const bankDepositsMatched = bankStripeDeposits.filter(
    (transaction) => transaction.matched_payout_id
  ).length
  const bankOpexSpentCents = monthBankTxns
    .filter((transaction) => transaction.flow_class === "external_expense")
    .reduce(
      (sum, transaction) => sum + Math.abs(Number(transaction.amount_cents)),
      0
    )
  const hasBankData = monthBankTxns.length > 0

  async function handleSaveSnapshot(event: React.FormEvent) {
    event.preventDefault()
    setSavingSnapshot(true)
    const result = await saveCashSnapshot({
      operatingCashCents: Math.round(Number(operatingCash || 0) * 100),
      taxCashCents: Math.round(Number(taxCash || 0) * 100),
      effectiveDate: new Date().toISOString().slice(0, 10),
    })
    setSavingSnapshot(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Cash balance updated")
    setSnapshotOpen(false)
  }

  return (
    <div className="flex flex-col gap-4">
      {(opexVarianceCents < 0 || unreconciled > 0) && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Items need attention</AlertTitle>
          <AlertDescription>
            {[
              opexVarianceCents < 0
                ? `OPEX is ${currency(Math.abs(opexVarianceCents))} over allocation`
                : null,
              unreconciled > 0
                ? `${unreconciled} payout(s) awaiting reconciliation`
                : null,
            ]
              .filter(Boolean)
              .join(". ")}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Landmark}
          label="Cash received"
          value={currency(currentCashCents)}
          detail={`${paidPayouts.length} paid payout${paidPayouts.length === 1 ? "" : "s"} this month`}
        />
        <MetricCard
          icon={PiggyBank}
          label="OPEX allocation"
          value={currency(profitFirst.opexCents)}
          detail="25% of paid payouts"
        />
        <MetricCard
          icon={Receipt}
          label="OPEX committed"
          value={currency(committedExpensesCents)}
          detail={`${currency(paidExpensesCents)} paid`}
        />
        <MetricCard
          icon={Wallet}
          label="Operating runway"
          value={
            cashSnapshot
              ? runway === null
                ? "12+ months"
                : `${runway} months`
              : "Set cash"
          }
          detail={
            cashSnapshot
              ? `${currency(Number(cashSnapshot.operating_cash_cents))} opening cash`
              : "Add bank balance to calculate"
          }
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSnapshotOpen(true)}
            >
              Update
            </Button>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profit First allocation</CardTitle>
          <CardDescription>
            Recommended allocation of each paid payout. This does not confirm
            bank transfers.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Allocation
            label="Partner A"
            percentage="30%"
            value={profitFirst.partnerACents}
          />
          <Allocation
            label="Partner B"
            percentage="30%"
            value={profitFirst.partnerBCents}
          />
          <Allocation
            label="Tax reserve"
            percentage="15%"
            value={profitFirst.taxCents}
          />
          <Allocation
            label="OPEX"
            percentage="25%"
            value={profitFirst.opexCents}
            detail={
              opexVarianceCents >= 0
                ? `${currency(opexVarianceCents)} available`
                : `${currency(Math.abs(opexVarianceCents))} over`
            }
          />
        </CardContent>
      </Card>

      {hasBankData && (
        <Card>
          <CardHeader>
            <CardTitle>Bank reconciliation</CardTitle>
            <CardDescription>
              Relay statement confirmation for {currentMonth}. Stripe stays the
              source for payouts; bank confirms settled cash.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-4">
              <span className="text-sm font-medium">Stripe deposits matched</span>
              <p className="mt-3 font-mono text-2xl font-semibold">
                {bankDepositsMatched}/{bankStripeDeposits.length}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {paidPayouts.length} paid payout(s) this month
              </p>
            </div>
            <div className="rounded-md border p-4">
              <span className="text-sm font-medium">OPEX allocation (25%)</span>
              <p className="mt-3 font-mono text-2xl font-semibold">
                {currency(profitFirst.opexCents)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Profit First target from payouts
              </p>
            </div>
            <div className="rounded-md border p-4">
              <span className="text-sm font-medium">OPEX spent (bank)</span>
              <p className="mt-3 font-mono text-2xl font-semibold">
                {currency(bankOpexSpentCents)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {currency(profitFirst.opexCents - bankOpexSpentCents)} vs
                allocation
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Cash trend</CardTitle>
            <CardDescription>
              Paid Stripe payouts by arrival month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[280px] w-full">
              <AreaChart data={monthlyHistory}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <div className="flex min-w-36 items-center justify-between gap-3">
                          <span>{chartConfig[String(name)]?.label}</span>
                          <span className="font-mono font-medium">
                            {currency(Number(value) * 100)}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="cash"
                  stroke="var(--color-cash)"
                  fill="var(--color-cash)"
                  fillOpacity={0.18}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="opex"
                  stroke="var(--color-opex)"
                  fill="var(--color-opex)"
                  fillOpacity={0.08}
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operating outlook</CardTitle>
            <CardDescription>
              12 months at the latest 3-month payout run rate
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="text-sm text-muted-foreground">
                Average monthly cash
              </p>
              <p className="font-mono text-2xl font-semibold">
                {currency(averageCashCents)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                Monthly expenses (avg. 3m)
              </p>
              <p className="font-mono text-2xl font-semibold">
                {currency(averageMonthlyExpensesCents)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                Projected cash after 12 months
              </p>
              <p className="font-mono text-2xl font-semibold">
                {currency(forecast.at(-1)?.endingCashCents ?? 0)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Use Planning to change listings, investments, expenses, and
              capital.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listing unit economics</CardTitle>
          <CardDescription>
            Aggregated payout cash and variable expenses for {currentMonth}.
            Variable expenses reduce the total margin even when they are not
            allocated to a specific listing.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{activeListingsCount} listings</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {listingsWithCash === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No attributable payout cash this month yet. Once subscription
              payouts are reconciled, unit economics appear here.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Listings" value={String(activeListingsCount)} />
                <Stat label="Total cash" value={currency(totalCashCents)} />
                <Stat
                  label="Variable expenses"
                  value={currency(totalVariableExpensesCents)}
                />
                <Stat
                  label="Total contribution"
                  value={currency(totalContributionCents)}
                  detail={marginPct !== null ? `${marginPct}% margin` : undefined}
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-muted-foreground">
                  Per listing average
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat
                    label="Cash / listing"
                    value={currency(perListing(totalCashCents))}
                  />
                  <Stat
                    label="Variable / listing"
                    value={currency(perListing(totalVariableExpensesCents))}
                  />
                  <Stat
                    label="Contribution / listing"
                    value={currency(perListing(totalContributionCents))}
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evolución mensual</CardTitle>
          <CardDescription>
            Contribución, margen y OPEX restante (25% Profit First) por mes,
            desde enero. La caja atribuida depende de payouts reconciliados; los
            meses sin reconciliar pueden verse bajos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <ComposedChart data={evolutionChart}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis
                yAxisId="left"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}%`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => (
                      <div className="flex min-w-40 items-center justify-between gap-3">
                        <span>{chartConfig[String(name)]?.label}</span>
                        <span className="font-mono font-medium">
                          {name === "contribution"
                            ? currency(Number(value) * 100)
                            : `${value}%`}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Bar
                yAxisId="left"
                dataKey="contribution"
                fill="var(--color-contribution)"
                radius={4}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="margin"
                stroke="var(--color-margin)"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="opexRemaining"
                stroke="var(--color-opexRemaining)"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ChartContainer>
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mes</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
                <TableHead className="text-right">OPEX (25%)</TableHead>
                <TableHead className="text-right">Caja atribuida</TableHead>
                <TableHead className="text-right">Gastos totales</TableHead>
                <TableHead className="text-right">Gastos variables</TableHead>
                <TableHead className="text-right">Contribución</TableHead>
                <TableHead className="text-right">Margen %</TableHead>
                <TableHead className="text-right">OPEX restante %</TableHead>
                <TableHead className="text-right">Contrib./listing</TableHead>
                <TableHead className="text-right">Listings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthlySeries.map((row) => (
                <TableRow key={row.month}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-right font-mono">
                    {currency(row.incomeCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {currency(row.opexBudgetCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {currency(row.attributedCashCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {currency(row.allExpensesCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {currency(row.variableCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {currency(row.contributionCents)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.marginPct === null ? "—" : `${row.marginPct}%`}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.opexRemainingPct === null
                      ? "—"
                      : `${row.opexRemainingPct}%`}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {currency(row.perListingContributionCents)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.listingsCount}
                  </TableCell>
                </TableRow>
              ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={snapshotOpen} onOpenChange={setSnapshotOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update cash balance</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveSnapshot} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="operating-cash">Operating cash ($)</Label>
              <Input
                id="operating-cash"
                type="number"
                min="0"
                step="0.01"
                value={operatingCash}
                onChange={(event) => setOperatingCash(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tax-cash">Tax reserve balance ($)</Label>
              <Input
                id="tax-cash"
                type="number"
                min="0"
                step="0.01"
                value={taxCash}
                onChange={(event) => setTaxCash(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSnapshotOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingSnapshot}>
                {savingSnapshot ? "Saving..." : "Save balance"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  detail: string
  action?: React.ReactNode
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" />
          <CardTitle>{label}</CardTitle>
        </div>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>
        <p className="font-mono text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded-md border p-4">
      <span className="text-sm font-medium">{label}</span>
      <p className="mt-3 font-mono text-2xl font-semibold">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}

function Allocation({
  label,
  percentage,
  value,
  detail,
}: {
  label: string
  percentage: string
  value: number
  detail?: string
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Badge variant="outline">{percentage}</Badge>
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold">{currency(value)}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}
