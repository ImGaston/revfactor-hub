"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { StripeSubscriptionSummary } from "@/lib/stripe"
import type {
  BankAccount,
  BankTransaction,
  Expense,
  ExpenseCategory,
  FinancialCashSnapshot,
  RecurringExpense,
  StripeInvoice,
  StripePayout,
} from "@/lib/types"
import { BankSection } from "./bank-section"
import { ExpensesTable } from "./expenses-table"
import { FinancialOverview } from "./financial-overview"
import { NewSubscriptionsSection } from "./new-subscriptions-section"
import { PaymentIssuesSection } from "./payment-issues-section"
import type { ClientRef } from "./payment-issues"
import { PlanningSection } from "./planning-section"
import { SubscriptionsTable } from "./subscriptions-table"

type ListingRef = {
  id: string
  name: string
  client_id: string
  stripe_subscription_id: string | null
  clients: { id: string; name: string } | null
}

export function FinancialsView({
  stripeConfigured,
  subscriptions,
  expenses,
  categories,
  clients,
  clientStripeCustomers,
  listings,
  recurring,
  assemblyConfigured,
  payouts,
  payoutTransactions,
  cashSnapshot,
  bankAccounts,
  bankTransactions,
  unpaidInvoices,
  dismissedInvoiceIds,
}: {
  stripeConfigured: boolean
  subscriptions: StripeSubscriptionSummary[]
  expenses: Expense[]
  categories: ExpenseCategory[]
  clients: ClientRef[]
  clientStripeCustomers: { client_id: string; stripe_customer_id: string }[]
  listings: ListingRef[]
  recurring: RecurringExpense[]
  assemblyConfigured: boolean
  payouts: StripePayout[]
  payoutTransactions: {
    payout_id: string
    net_cents: number
    subscription_id: string | null
  }[]
  cashSnapshot: FinancialCashSnapshot | null
  bankAccounts: BankAccount[]
  bankTransactions: BankTransaction[]
  unpaidInvoices: StripeInvoice[]
  dismissedInvoiceIds: string[]
}) {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const unpaidExpenses = expenses.filter(
    (expense) => expense.date.startsWith(currentMonth) && !expense.is_paid
  )
  const activeSubscriptions = subscriptions.filter(
    (subscription) => subscription.status === "active"
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Financials</h1>
        <p className="text-sm text-muted-foreground">
          Cash received, Profit First allocations, operating costs, and planning
        </p>
      </div>

      {!stripeConfigured && (
        <Alert>
          <AlertDescription>
            Stripe is not configured. Add{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              STRIPE_SECRET_KEY
            </code>{" "}
            to see payout and subscription data.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="planning">Planning</TabsTrigger>
          <TabsTrigger value="subscriptions">
            Subscriptions
            {activeSubscriptions.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {activeSubscriptions.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="expenses">
            Expenses
            {unpaidExpenses.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {unpaidExpenses.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="bank">Bank</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <PaymentIssuesSection
            invoices={unpaidInvoices}
            subscriptions={subscriptions}
            clients={clients}
            clientStripeCustomers={clientStripeCustomers}
            assemblyConfigured={assemblyConfigured}
            dismissedInvoiceIds={dismissedInvoiceIds}
          />
          <NewSubscriptionsSection
            subscriptions={subscriptions}
            clients={clients}
            clientStripeCustomers={clientStripeCustomers}
            listings={listings}
            assemblyConfigured={assemblyConfigured}
          />
          <FinancialOverview
            payouts={payouts}
            payoutTransactions={payoutTransactions}
            expenses={expenses}
            listings={listings}
            cashSnapshot={cashSnapshot}
            bankTransactions={bankTransactions}
          />
        </TabsContent>

        <TabsContent value="planning">
          <PlanningSection />
        </TabsContent>

        <TabsContent value="subscriptions">
          <SubscriptionsTable
            subscriptions={subscriptions}
            clients={clients}
            clientStripeCustomers={clientStripeCustomers}
            listings={listings}
            stripeConfigured={stripeConfigured}
          />
        </TabsContent>

        <TabsContent value="expenses">
          <ExpensesTable
            expenses={expenses}
            categories={categories}
            listings={listings}
          />
        </TabsContent>

        <TabsContent value="bank">
          <BankSection
            accounts={bankAccounts}
            transactions={bankTransactions}
            categories={categories}
            recurring={recurring}
            payouts={payouts}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
