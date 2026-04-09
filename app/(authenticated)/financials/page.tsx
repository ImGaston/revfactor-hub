import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import {
  isStripeConfigured,
  listSubscriptions,
  getMonthlyRevenue,
  getRevenueOnTheBooks,
  getRevenueHistory,
} from "@/lib/stripe"
import { FinancialsView } from "./financials-view"
import type { StripeSubscriptionSummary, StripeRevenueSummary } from "@/lib/stripe"

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
    stripeData,
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
      .order("name"),
    supabase
      .from("recurring_expenses")
      .select("*, expense_categories(id, name, type)")
      .order("description"),
    stripeConfigured
      ? Promise.all([
          listSubscriptions().catch(() => [] as StripeSubscriptionSummary[]),
          getMonthlyRevenue(currentYear, currentMonth).catch(() => ({ totalRevenue: 0, invoiceCount: 0, invoices: [] }) as StripeRevenueSummary),
          getRevenueOnTheBooks().catch(() => ({ total: 0, invoices: [] })),
          getRevenueHistory(6).catch(() => []),
        ])
      : Promise.resolve([[], { totalRevenue: 0, invoiceCount: 0, invoices: [] }, { total: 0, invoices: [] }, []] as const),
  ])

  const [subscriptions, monthlyRevenue, revenueOnBooks, revenueHistory] = stripeData

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
