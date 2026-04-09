"use client"

import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Receipt,
  Wallet,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { StripeSubscriptionSummary, StripeRevenueSummary } from "@/lib/stripe"
import type { Expense, ExpenseCategory, RecurringExpense } from "@/lib/types"
import { SubscriptionsTable } from "./subscriptions-table"
import { ExpensesTable } from "./expenses-table"
import { RecurringExpensesTable } from "./recurring-expenses-table"

type ClientRef = { id: string; name: string; email: string | null; stripe_customer_id: string | null }
type ListingRef = { id: string; name: string; client_id: string; stripe_subscription_id: string | null; clients: { id: string; name: string } | null }

const revenueConfig: ChartConfig = {
  revenue: { label: "Revenue", color: "hsl(142 71% 45%)" },
}

const expenseConfig: ChartConfig = {
  amount: { label: "Amount", color: "hsl(0 84% 60%)" },
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)
}

export function FinancialsView({
  stripeConfigured,
  subscriptions,
  monthlyRevenue,
  revenueOnBooks,
  revenueHistory,
  expenses,
  categories,
  clients,
  listings,
  recurring,
}: {
  stripeConfigured: boolean
  subscriptions: StripeSubscriptionSummary[]
  monthlyRevenue: StripeRevenueSummary
  revenueOnBooks: { total: number; invoices: { id: string; customerEmail: string | null; customerName: string | null; amountDue: number; status: string | null }[] }
  revenueHistory: { month: string; revenue: number }[]
  expenses: Expense[]
  categories: ExpenseCategory[]
  clients: ClientRef[]
  listings: ListingRef[]
  recurring: RecurringExpense[]
}) {
  const now = new Date()
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

  // Current month expenses
  const monthExpenses = expenses.filter((e) => e.date.startsWith(currentMonthStr))
  const totalMonthExpenses = monthExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const unpaidExpenses = monthExpenses.filter((e) => !e.is_paid)
  const totalUnpaid = unpaidExpenses.reduce((sum, e) => sum + Number(e.amount), 0)

  const activeSubscriptions = subscriptions.filter((s) => s.status === "active")
  const netProfit = monthlyRevenue.totalRevenue - totalMonthExpenses

  // Expenses by category for chart
  const expensesByCategory = monthExpenses.reduce<Record<string, number>>((acc, e) => {
    const catName = e.expense_categories?.name ?? "Uncategorized"
    acc[catName] = (acc[catName] ?? 0) + Number(e.amount)
    return acc
  }, {})
  const expenseCategoryData = Object.entries(expensesByCategory)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Financials</h1>
        <p className="text-sm text-muted-foreground">
          Revenue, subscriptions, and expense management
        </p>
      </div>

      {!stripeConfigured && (
        <Alert>
          <AlertDescription>
            Stripe is not configured. Add <code className="rounded bg-muted px-1 py-0.5 text-xs">STRIPE_SECRET_KEY</code> to your environment variables to see live revenue and subscription data.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="subscriptions">
            Subscriptions
            {activeSubscriptions.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">{activeSubscriptions.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="expenses">
            Expenses
            {unpaidExpenses.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">{unpaidExpenses.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="recurring">
            Recurring
            {recurring.filter((r) => r.is_active).length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">{recurring.filter((r) => r.is_active).length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── Overview ─── */}
        <TabsContent value="overview" className="space-y-4">
          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={DollarSign}
              label="Monthly Revenue"
              value={formatCurrency(monthlyRevenue.totalRevenue)}
              sub={`${monthlyRevenue.invoiceCount} paid invoices`}
              color="text-emerald-600"
            />
            <KpiCard
              icon={CreditCard}
              label="Revenue on the Books"
              value={formatCurrency(revenueOnBooks.total)}
              sub={`${revenueOnBooks.invoices.length} open invoices`}
              color="text-blue-600"
            />
            <KpiCard
              icon={Receipt}
              label="Monthly Expenses"
              value={formatCurrency(totalMonthExpenses)}
              sub={totalUnpaid > 0 ? `${formatCurrency(totalUnpaid)} unpaid` : "All paid"}
              color="text-red-500"
            />
            <KpiCard
              icon={Wallet}
              label="Net Profit"
              value={formatCurrency(netProfit)}
              sub={monthlyRevenue.totalRevenue > 0 ? `${Math.round((netProfit / monthlyRevenue.totalRevenue) * 100)}% margin` : "—"}
              trend={netProfit >= 0}
              color={netProfit >= 0 ? "text-emerald-600" : "text-red-500"}
            />
          </div>

          {/* Charts Row */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Revenue Trend */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Revenue Trend</CardTitle>
                <p className="text-xs text-muted-foreground">Last 6 months</p>
              </CardHeader>
              <CardContent>
                {revenueHistory.length > 0 ? (
                  <ChartContainer config={revenueConfig} className="h-[260px] w-full">
                    <AreaChart data={revenueHistory} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} className="text-xs" />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        className="text-xs"
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      />
                      <ChartTooltip
                        content={<ChartTooltipContent formatter={(value) => `$${Number(value).toLocaleString()}`} />}
                      />
                      <defs>
                        <linearGradient id="fillRevFinancials" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="hsl(142 71% 45%)"
                        fill="url(#fillRevFinancials)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                    No revenue data available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Expenses by Category */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Expenses by Category</CardTitle>
                <p className="text-xs text-muted-foreground">Current month</p>
              </CardHeader>
              <CardContent>
                {expenseCategoryData.length > 0 ? (
                  <ChartContainer config={expenseConfig} className="h-[260px] w-full">
                    <BarChart data={expenseCategoryData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" horizontal={false} />
                      <XAxis
                        type="number"
                        tickLine={false}
                        axisLine={false}
                        className="text-xs"
                        tickFormatter={(v) => `$${v}`}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        className="text-xs"
                        width={100}
                      />
                      <ChartTooltip
                        content={<ChartTooltipContent formatter={(value) => `$${Number(value).toLocaleString()}`} />}
                      />
                      <Bar dataKey="amount" fill="hsl(0 84% 60%)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                    No expenses this month
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Unpaid Expenses Summary */}
          {unpaidExpenses.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Pending Payments</CardTitle>
                <p className="text-xs text-muted-foreground">{unpaidExpenses.length} unpaid expenses this month</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {unpaidExpenses.slice(0, 5).map((e) => (
                    <div key={e.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{e.description}</span>
                        {e.expense_categories && (
                          <Badge variant="outline" className="text-xs">{e.expense_categories.name}</Badge>
                        )}
                      </div>
                      <span className="font-mono text-sm font-medium text-red-500">
                        ${Number(e.amount).toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {unpaidExpenses.length > 5 && (
                    <p className="text-center text-xs text-muted-foreground">
                      +{unpaidExpenses.length - 5} more
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── Subscriptions ─── */}
        <TabsContent value="subscriptions">
          <SubscriptionsTable
            subscriptions={subscriptions}
            clients={clients}
            listings={listings}
            stripeConfigured={stripeConfigured}
          />
        </TabsContent>

        {/* ─── Expenses ─── */}
        <TabsContent value="expenses">
          <ExpensesTable
            expenses={expenses}
            categories={categories}
          />
        </TabsContent>

        {/* ─── Recurring ─── */}
        <TabsContent value="recurring">
          <RecurringExpensesTable
            recurring={recurring}
            categories={categories}
            generatedMonths={new Set(
              expenses
                .filter((e) => e.recurring_month)
                .map((e) => e.recurring_month!)
            )}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub: string
  trend?: boolean
  color?: string
}) {
  return (
    <Card className="group relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={`rounded-lg bg-primary/10 p-2.5`}>
            <Icon className={`size-5 ${color ?? "text-primary"}`} />
          </div>
          {trend !== undefined && (
            <span className={`flex items-center gap-0.5 text-xs font-medium ${trend ? "text-emerald-600" : "text-red-500"}`}>
              {trend ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            </span>
          )}
        </div>
        <div className="mt-3">
          <p className="text-3xl font-semibold font-mono tracking-tight">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground/70">{sub}</p>
      </CardContent>
    </Card>
  )
}
