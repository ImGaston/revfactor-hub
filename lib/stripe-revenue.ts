import type { SupabaseClient } from "@supabase/supabase-js"
import type { StripeRevenueSummary, StripeInvoiceSummary } from "./stripe"

function isoToUnix(iso: string | null): number {
  if (!iso) return 0
  return Math.floor(new Date(iso).getTime() / 1000)
}

type InvoiceRow = {
  id: string
  customer_id: string | null
  customer_email: string | null
  customer_name: string | null
  amount_due: number
  amount_paid: number
  status: string | null
  description: string | null
  created: string
  due_date: string | null
  period_start: string | null
  period_end: string | null
}

function rowToInvoiceSummary(r: InvoiceRow): StripeInvoiceSummary {
  return {
    id: r.id,
    customerId: r.customer_id,
    customerEmail: r.customer_email,
    customerName: r.customer_name,
    amountDue: Number(r.amount_due),
    amountPaid: Number(r.amount_paid),
    status: r.status,
    created: isoToUnix(r.created),
    dueDate: isoToUnix(r.due_date),
    periodStart: isoToUnix(r.period_start),
    periodEnd: isoToUnix(r.period_end),
    description: r.description,
  }
}

export async function getMonthlyRevenueFromMirror(
  supabase: SupabaseClient,
  year: number,
  month: number,
): Promise<StripeRevenueSummary> {
  const startDate = new Date(year, month - 1, 1).toISOString()
  const endDate = new Date(year, month, 1).toISOString()

  const { data, error } = await supabase
    .from("stripe_invoices")
    .select("id, customer_id, customer_email, customer_name, amount_due, amount_paid, status, description, created, due_date, period_start, period_end")
    .eq("status", "paid")
    .gte("created", startDate)
    .lt("created", endDate)

  if (error || !data) {
    return { totalRevenue: 0, invoiceCount: 0, invoices: [] }
  }

  const invoices = data.map((r) => rowToInvoiceSummary(r as InvoiceRow))
  const totalRevenue = invoices.reduce((sum, inv) => sum + inv.amountPaid, 0)

  return { totalRevenue, invoiceCount: invoices.length, invoices }
}

export async function getRevenueOnTheBooksFromMirror(
  supabase: SupabaseClient,
): Promise<{ total: number; invoices: StripeInvoiceSummary[] }> {
  const { data, error } = await supabase
    .from("stripe_invoices")
    .select("id, customer_id, customer_email, customer_name, amount_due, amount_paid, status, description, created, due_date, period_start, period_end")
    .eq("status", "open")

  if (error || !data) {
    return { total: 0, invoices: [] }
  }

  const invoices = data.map((r) => rowToInvoiceSummary(r as InvoiceRow))
  const total = invoices.reduce((sum, inv) => sum + inv.amountDue, 0)

  return { total, invoices }
}

export async function getRevenueHistoryFromMirror(
  supabase: SupabaseClient,
  months: number = 6,
): Promise<{ month: string; revenue: number }[]> {
  const now = new Date()
  const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const { data, error } = await supabase
    .from("stripe_invoices")
    .select("amount_paid, created")
    .eq("status", "paid")
    .gte("created", startDate.toISOString())
    .lt("created", endDate.toISOString())

  if (error || !data) {
    return []
  }

  const buckets = new Map<string, number>()
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    buckets.set(key, 0)
  }

  for (const row of data) {
    const d = new Date(row.created)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    if (buckets.has(key)) {
      buckets.set(key, buckets.get(key)! + Number(row.amount_paid))
    }
  }

  const results: { month: string; revenue: number }[] = []
  for (const [key, revenue] of buckets) {
    const [y, m] = key.split("-")
    const d = new Date(Number(y), Number(m) - 1, 1)
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    results.push({ month: label, revenue })
  }

  return results
}
