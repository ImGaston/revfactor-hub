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

export type StripeSubscriptionPriceOption = {
  priceId: string
  label: string
  productName: string | null
  nickname: string | null
  amount: number | null
  currency: string
  interval: string
  intervalCount: number
  subscriptionCount: number
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

type CheckoutLineItem = {
  price?: string
  price_data?: {
    currency: string
    product_data: {
      name: string
    }
    unit_amount: number
  }
  quantity: number
}

// --- Helpers ---

function centsToDollars(cents: number): number {
  return cents / 100
}

function formatPriceAmount(price: Stripe.Price): number | null {
  if (price.unit_amount == null) return null
  return centsToDollars(price.unit_amount)
}

function getProductName(product: Stripe.Price["product"] | null): string | null {
  if (!product || typeof product === "string" || product.deleted) return null
  return product.name ?? null
}

async function listProductNamesById(stripe: Stripe, productIds: Set<string>) {
  const productNames = new Map<string, string>()

  for (const productId of productIds) {
    try {
      const product = await stripe.products.retrieve(productId)
      if (!product.deleted && product.name) {
        productNames.set(productId, product.name)
      }
    } catch {
      // Keep the price ID/nickname fallback if a product lookup fails.
    }
  }

  return productNames
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

export async function listSubscriptionPriceOptions(): Promise<StripeSubscriptionPriceOption[]> {
  const stripe = getStripeClient()
  const optionMap = new Map<StripeSubscriptionPriceOption["priceId"], StripeSubscriptionPriceOption & { productId: string | null }>()
  const productIds = new Set<string>()

  for await (const sub of stripe.subscriptions.list({
    expand: ["data.items.data.price"],
    limit: 100,
    status: "all",
  })) {
    for (const item of sub.items.data) {
      const price = item.price
      if (!price?.id || !price.active || !price.recurring) continue

      const existing = optionMap.get(price.id)
      if (existing) {
        optionMap.set(price.id, {
          ...existing,
          subscriptionCount: existing.subscriptionCount + 1,
        })
        continue
      }

      const expandedProductName = getProductName(price.product)
      const productId = typeof price.product === "string" ? price.product : price.product?.id ?? null
      if (!expandedProductName && productId) productIds.add(productId)
      const nickname = price.nickname ?? null
      const label = nickname ?? expandedProductName ?? price.id

      optionMap.set(price.id, {
        priceId: price.id,
        label,
        productName: expandedProductName,
        productId,
        nickname,
        amount: formatPriceAmount(price),
        currency: price.currency,
        interval: price.recurring.interval,
        intervalCount: price.recurring.interval_count ?? 1,
        subscriptionCount: 1,
      })
    }
  }

  if (productIds.size > 0) {
    const productNames = await listProductNamesById(stripe, productIds)
    for (const [priceId, option] of optionMap) {
      if (option.productName || !option.productId) continue
      const productName = productNames.get(option.productId)
      if (!productName) continue
      optionMap.set(priceId, {
        ...option,
        productName,
        label: option.nickname ?? productName,
      })
    }
  }

  return [...optionMap.values()]
    .map(({ productId: _productId, ...option }) => option)
    .sort((a, b) => a.label.localeCompare(b.label))
}

export async function getSubscription(id: string): Promise<StripeSubscriptionSummary | null> {
  const stripe = getStripeClient()
  try {
    const sub = await stripe.subscriptions.retrieve(id, { expand: ["customer"] })
    const summary = summarizeSubscription(sub)

    // Fallback when the Stripe price has no flat unit_amount (tiered/metered):
    // use the most recent invoice amount so the UI reflects actual billing.
    if (summary.amount === 0) {
      const latest = await stripe.invoices.list({ subscription: id, limit: 1 })
      const inv = latest.data[0]
      if (inv) {
        const cents = inv.amount_paid > 0 ? inv.amount_paid : inv.amount_due
        if (cents > 0) summary.amount = centsToDollars(cents)
      }
    }

    return summary
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

export async function createCustomer(input: {
  name: string
  email: string | null
  hubClientId: string
}): Promise<StripeCustomerSummary> {
  const stripe = getStripeClient()
  const customer = await stripe.customers.create({
    name: input.name,
    email: input.email ?? undefined,
    metadata: {
      hub_client_id: input.hubClientId,
    },
  })

  return {
    id: customer.id,
    email: customer.email ?? null,
    name: customer.name ?? null,
    created: customer.created,
  }
}

export async function createSubscriptionCheckoutSession(input: {
  customerId: string
  priceId: string
  hubClientId: string
  successUrl: string
  cancelUrl: string
  onboardingFee?: {
    amountCents: number
    currency: string
  } | null
}): Promise<{ id: string; url: string }> {
  const stripe = getStripeClient()
  const metadata: Stripe.MetadataParam = {
    hub_client_id: input.hubClientId,
    include_onboarding_fee: input.onboardingFee ? "true" : "false",
    onboarding_fee_amount: input.onboardingFee
      ? centsToDollars(input.onboardingFee.amountCents).toFixed(2)
      : "0.00",
    onboarding_fee_source: "manual_editable_default_125",
  }
  const lineItems: CheckoutLineItem[] = [
    {
      price: input.priceId,
      quantity: 1,
    },
  ]

  if (input.onboardingFee && input.onboardingFee.amountCents > 0) {
    lineItems.push({
      price_data: {
        currency: input.onboardingFee.currency,
        product_data: {
          name: "RevFactor onboarding fee",
        },
        unit_amount: input.onboardingFee.amountCents,
      },
      quantity: 1,
    })
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.hubClientId,
    line_items: lineItems,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    subscription_data: {
      metadata,
    },
    metadata,
  })

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout URL")
  }

  return { id: session.id, url: session.url }
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

export async function searchCustomersByEmail(email: string): Promise<StripeCustomerSummary[]> {
  const stripe = getStripeClient()
  const result = await stripe.customers.search({
    query: `email:'${email}'`,
    limit: 100,
  })
  return result.data.map((c) => ({
    id: c.id,
    email: c.email ?? null,
    name: c.name ?? null,
    created: c.created,
  }))
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
  const promises = Array.from({ length: months }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1)
    return getMonthlyRevenue(date.getFullYear(), date.getMonth() + 1).then(
      ({ totalRevenue }) => ({
        month: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        revenue: totalRevenue,
      }),
    )
  })
  return Promise.all(promises)
}
