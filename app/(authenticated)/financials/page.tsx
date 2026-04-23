import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import {
  isStripeConfigured,
  getMonthlyRevenue,
  getRevenueOnTheBooks,
  getRevenueHistory,
} from "@/lib/stripe"
import { FinancialsView } from "./financials-view"
import type { StripeSubscriptionSummary, StripeRevenueSummary } from "@/lib/stripe"

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

function rowToSubscription(r: StripeSubscriptionRow): StripeSubscriptionSummary {
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

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // Fetch all data in parallel
  const [
    expensesResult,
    categoriesResult,
    clientsResult,
    listingsResult,
    recurringResult,
    mirrorSubsResult,
    stripeAggregates,
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select("*, expense_categories(id, name, type)")
      .order("date", { ascending: false }),
    supabase
      .from("expense_categories")
      .select("*")
      .order("name"),
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
        "id, status, customer_id, customer_email, customer_name, plan_name, amount, currency, interval, item_count, current_period_start, current_period_end, cancel_at_period_end, created",
      )
      .order("created", { ascending: false }),
    stripeConfigured
      ? Promise.all([
          getMonthlyRevenue(currentYear, currentMonth).catch(() => ({ totalRevenue: 0, invoiceCount: 0, invoices: [] }) as StripeRevenueSummary),
          getRevenueOnTheBooks().catch(() => ({ total: 0, invoices: [] })),
          getRevenueHistory(6).catch(() => []),
        ])
      : Promise.resolve([{ totalRevenue: 0, invoiceCount: 0, invoices: [] }, { total: 0, invoices: [] }, []] as const),
  ])

  const subscriptions = (mirrorSubsResult.data ?? []).map((r) =>
    rowToSubscription(r as StripeSubscriptionRow),
  )
  const [monthlyRevenue, revenueOnBooks, revenueHistory] = stripeAggregates

  return (
    <FinancialsView
      stripeConfigured={stripeConfigured}
      subscriptions={subscriptions as StripeSubscriptionSummary[]}
      monthlyRevenue={monthlyRevenue as StripeRevenueSummary}
      revenueOnBooks={revenueOnBooks as { total: number; invoices: [] }}
      revenueHistory={revenueHistory as { month: string; revenue: number }[]}
      expenses={expensesResult.data ?? []}
      categories={categoriesResult.data ?? []}
      clients={clientsResult.data ?? []}
      listings={
        (listingsResult.data ?? []).map((l) => ({
          id: l.id as string,
          name: l.name as string,
          client_id: l.client_id as string,
          stripe_subscription_id: l.stripe_subscription_id as string | null,
          clients: Array.isArray(l.clients) ? l.clients[0] ?? null : l.clients ?? null,
        }))
      }
      recurring={recurringResult.data ?? []}
    />
  )
}
