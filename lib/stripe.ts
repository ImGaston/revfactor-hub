import Stripe from "stripe"

// --- Configuration ---

let stripeClient: Stripe | null = null

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

function getStripeClient(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set")
    stripeClient = new Stripe(key)
  }
  return stripeClient
}

// --- Types ---

export type StripeSubscriptionSummary = {
  id: string
  status: string
  customerEmail: string | null
  customerName: string | null
  customerId: string
  planName: string | null
  amount: number // total recurring amount in dollars, summed across all items × quantity
  currency: string
  interval: string | null
  itemCount: number
  currentPeriodStart: number
  currentPeriodEnd: number
  cancelAtPeriodEnd: boolean
  created: number
}

export type StripeCustomerSummary = {
  id: string
  email: string | null
  name: string | null
  created: number
}

export type StripeInvoiceSummary = {
  id: string
  customerId: string | null
  customerEmail: string | null
  customerName: string | null
  amountDue: number // in dollars
  amountPaid: number // in dollars
  status: string | null
  created: number
  dueDate: number | null
  periodStart: number
  periodEnd: number
  description: string | null
}

export type StripeRevenueSummary = {
  totalRevenue: number
  invoiceCount: number
  invoices: StripeInvoiceSummary[]
}

// --- Helpers ---

function centsToDollars(cents: number): number {
  return cents / 100
}

function mapInvoice(inv: Stripe.Invoice): StripeInvoiceSummary {
  return {
    id: inv.id,
    customerId: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null,
    customerEmail: inv.customer_email ?? null,
    customerName: inv.customer_name ?? null,
    amountDue: centsToDollars(inv.amount_due),
    amountPaid: centsToDollars(inv.amount_paid),
    status: inv.status,
    created: inv.created,
    dueDate: inv.due_date,
    periodStart: inv.period_start,
    periodEnd: inv.period_end,
    description: inv.description,
  }
}

// --- Subscriptions ---

function summarizeSubscription(sub: Stripe.Subscription): StripeSubscriptionSummary {
  const customer = sub.customer as Stripe.Customer
  const items = sub.items.data
  const firstItem = items[0]
  const totalCents = items.reduce(
    (acc, i) => acc + (i.price?.unit_amount ?? 0) * (i.quantity ?? 1),
    0,
  )
  const firstQty = firstItem?.quantity ?? 1
  const firstLabel = firstItem?.price?.nickname ?? firstItem?.price?.product?.toString() ?? null
  const planName =
    items.length > 1
      ? `${items.length} items`
      : firstQty > 1 && firstLabel
        ? `${firstLabel} × ${firstQty}`
        : firstLabel

  return {
    id: sub.id,
    status: sub.status,
    customerEmail: customer?.email ?? null,
    customerName: customer?.name ?? null,
    customerId: customer?.id ?? (typeof sub.customer === "string" ? sub.customer : ""),
    planName,
    amount: centsToDollars(totalCents),
    currency: firstItem?.price?.currency ?? "usd",
    interval: firstItem?.price?.recurring?.interval ?? null,
    itemCount: items.length,
    currentPeriodStart: firstItem?.current_period_start ?? sub.created,
    currentPeriodEnd: firstItem?.current_period_end ?? sub.created,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    created: sub.created,
  }
}

export async function listSubscriptions(): Promise<StripeSubscriptionSummary[]> {
  const stripe = getStripeClient()
  const subs: StripeSubscriptionSummary[] = []

  for await (const sub of stripe.subscriptions.list({
    expand: ["data.customer"],
    limit: 100,
  })) {
    subs.push(summarizeSubscription(sub))
  }

  return subs
}

export async function getSubscription(id: string): Promise<StripeSubscriptionSummary | null> {
  const stripe = getStripeClient()
  try {
    const sub = await stripe.subscriptions.retrieve(id, { expand: ["customer"] })
    return summarizeSubscription(sub)
  } catch {
    return null
  }
}

export async function listInvoicesBySubscription(
  subscriptionId: string,
  limit: number = 4,
): Promise<StripeInvoiceSummary[]> {
  const stripe = getStripeClient()
  const result = await stripe.invoices.list({ subscription: subscriptionId, limit })
  return result.data.map(mapInvoice)
}

// --- Customers ---

export async function listCustomers(): Promise<StripeCustomerSummary[]> {
  const stripe = getStripeClient()
  const customers: StripeCustomerSummary[] = []

  for await (const c of stripe.customers.list({ limit: 100 })) {
    customers.push({
      id: c.id,
      email: c.email ?? null,
      name: c.name ?? null,
      created: c.created,
    })
  }

  return customers
}

export async function searchCustomerByEmail(email: string): Promise<StripeCustomerSummary | null> {
  const stripe = getStripeClient()
  const result = await stripe.customers.search({
    query: `email:'${email}'`,
    limit: 1,
  })
  const c = result.data[0]
  if (!c) return null
  return {
    id: c.id,
    email: c.email ?? null,
    name: c.name ?? null,
    created: c.created,
  }
}

// --- Revenue ---

export async function getMonthlyRevenue(year: number, month: number): Promise<StripeRevenueSummary> {
  const stripe = getStripeClient()
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 1)

  const invoices: StripeInvoiceSummary[] = []
  let totalRevenue = 0

  for await (const inv of stripe.invoices.list({
    status: "paid",
    created: {
      gte: Math.floor(startDate.getTime() / 1000),
      lt: Math.floor(endDate.getTime() / 1000),
    },
    limit: 100,
  })) {
    const mapped = mapInvoice(inv)
    invoices.push(mapped)
    totalRevenue += mapped.amountPaid
  }

  return { totalRevenue, invoiceCount: invoices.length, invoices }
}

export async function getRevenueOnTheBooks(): Promise<{ total: number; invoices: StripeInvoiceSummary[] }> {
  const stripe = getStripeClient()
  const invoices: StripeInvoiceSummary[] = []
  let total = 0

  // Open invoices (sent but not yet paid)
  for await (const inv of stripe.invoices.list({
    status: "open",
    limit: 100,
  })) {
    const mapped = mapInvoice(inv)
    invoices.push(mapped)
    total += mapped.amountDue
  }

  return { total, invoices }
}

// --- Revenue History (for charts) ---

export async function getRevenueHistory(months: number = 6): Promise<{ month: string; revenue: number }[]> {
  const now = new Date()
  const results: { month: string; revenue: number }[] = []

  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const { totalRevenue } = await getMonthlyRevenue(year, month)
    const label = date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    results.push({ month: label, revenue: totalRevenue })
  }

  return results
}
