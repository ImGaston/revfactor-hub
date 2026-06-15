import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import { isStripeConfigured } from "@/lib/stripe"
import { isAssemblyConfigured } from "@/lib/assembly"
import { FinancialsView } from "./financials-view"
import type { StripeSubscriptionSummary } from "@/lib/stripe"

type StripeSubscriptionRow = {
  id: string
  status: string
  customer_id: string
  customer_email: string | null
  customer_name: string | null
  plan_name: string | null
  amount: number | string
  currency: string
  interval: string | null
  item_count: number
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created: string
}

function rowToSubscription(
  r: StripeSubscriptionRow
): StripeSubscriptionSummary {
  return {
    id: r.id,
    status: r.status,
    customerEmail: r.customer_email,
    customerName: r.customer_name,
    customerId: r.customer_id,
    planName: r.plan_name,
    amount: Number(r.amount),
    currency: r.currency,
    interval: r.interval,
    itemCount: r.item_count,
    currentPeriodStart: r.current_period_start
      ? Math.floor(new Date(r.current_period_start).getTime() / 1000)
      : Math.floor(new Date(r.created).getTime() / 1000),
    currentPeriodEnd: r.current_period_end
      ? Math.floor(new Date(r.current_period_end).getTime() / 1000)
      : Math.floor(new Date(r.created).getTime() / 1000),
    cancelAtPeriodEnd: r.cancel_at_period_end,
    created: Math.floor(new Date(r.created).getTime() / 1000),
  }
}

export default async function FinancialsPage() {
  const profile = await getProfile()

  if (profile?.role !== "super_admin") {
    redirect("/")
  }

  const supabase = await createClient()
  const stripeConfigured = isStripeConfigured()

  // Fetch all data in parallel
  const [
    expensesResult,
    categoriesResult,
    clientsResult,
    listingsResult,
    recurringResult,
    mirrorSubsResult,
    clientStripeCustomersResult,
    payoutsResult,
    payoutTransactionsResult,
    cashSnapshotResult,
    bankAccountsResult,
    bankTransactionsResult,
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "*, expense_categories(id, name, type), expense_listing_allocations(*, listings(id, name))"
      )
      .order("date", { ascending: false }),
    supabase.from("expense_categories").select("*").order("name"),
    supabase
      .from("clients")
      .select("id, name, email, stripe_customer_id")
      .order("name"),
    supabase
      .from("listings")
      .select("id, name, client_id, stripe_subscription_id, clients(id, name)")
      .eq("status", "active")
      .order("name"),
    supabase
      .from("recurring_expenses")
      .select("*, expense_categories(id, name, type)")
      .order("description"),
    supabase
      .from("stripe_subscriptions")
      .select(
        "id, status, customer_id, customer_email, customer_name, plan_name, amount, currency, interval, item_count, current_period_start, current_period_end, cancel_at_period_end, created"
      )
      .order("created", { ascending: false }),
    supabase
      .from("client_stripe_customers")
      .select("client_id, stripe_customer_id"),
    supabase
      .from("stripe_payouts")
      .select(
        "id, amount_cents, currency, status, arrival_date, created, automatic, reconciliation_status, failure_code, failure_message, synced_at"
      )
      .order("arrival_date", { ascending: false })
      .limit(500),
    supabase
      .from("stripe_payout_transactions")
      .select("payout_id, net_cents, subscription_id")
      .limit(5000),
    supabase
      .from("financial_cash_snapshots")
      .select(
        "id, operating_cash_cents, tax_cash_cents, effective_date, notes, created_at"
      )
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("bank_accounts").select("*").order("account_number"),
    supabase
      .from("bank_transactions")
      .select(
        "*, bank_accounts(id, account_number, label)"
      )
      .order("txn_date", { ascending: false })
      .limit(1000),
  ])

  const subscriptions = (mirrorSubsResult.data ?? []).map((r) =>
    rowToSubscription(r as StripeSubscriptionRow)
  )
  return (
    <FinancialsView
      stripeConfigured={stripeConfigured}
      subscriptions={subscriptions as StripeSubscriptionSummary[]}
      expenses={expensesResult.data ?? []}
      categories={categoriesResult.data ?? []}
      clients={clientsResult.data ?? []}
      clientStripeCustomers={
        (clientStripeCustomersResult.data ?? []) as {
          client_id: string
          stripe_customer_id: string
        }[]
      }
      listings={(listingsResult.data ?? []).map((l) => ({
        id: l.id as string,
        name: l.name as string,
        client_id: l.client_id as string,
        stripe_subscription_id: l.stripe_subscription_id as string | null,
        clients: Array.isArray(l.clients)
          ? (l.clients[0] ?? null)
          : (l.clients ?? null),
      }))}
      recurring={recurringResult.data ?? []}
      assemblyConfigured={isAssemblyConfigured()}
      payouts={payoutsResult.data ?? []}
      payoutTransactions={payoutTransactionsResult.data ?? []}
      cashSnapshot={cashSnapshotResult.data ?? null}
      bankAccounts={bankAccountsResult.data ?? []}
      bankTransactions={bankTransactionsResult.data ?? []}
    />
  )
}
