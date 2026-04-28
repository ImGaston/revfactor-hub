import type { SupabaseClient } from "@supabase/supabase-js"
import Stripe from "stripe"

// --- Client (server-only) ---

let stripeClient: Stripe | null = null

function getStripeClient(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set")
    stripeClient = new Stripe(key)
  }
  return stripeClient
}

// --- Helpers ---

function centsToDollars(cents: number): number {
  return cents / 100
}

function unixToIso(unix: number | null | undefined): string | null {
  if (!unix) return null
  return new Date(unix * 1000).toISOString()
}

// --- Sync ---

export type SyncResult = {
  subscriptions: { upserted: number; errors: string[] }
  invoices: { upserted: number; errors: string[] }
}

export async function syncStripeData(supabase: SupabaseClient): Promise<SyncResult> {
  const stripe = getStripeClient()
  const now = new Date().toISOString()

  // --- Invoices (fetched first so we can use them as a fallback for sub.amount
  //     when the Stripe price has no flat unit_amount, e.g. tiered/metered)  ---

  const invoiceRows: Record<string, unknown>[] = []
  const invErrors: string[] = []
  // Most-recent invoice per subscription (by created desc). We iterate newest
  // first (Stripe default), so the FIRST invoice seen per sub is the latest.
  const latestInvoiceBySub = new Map<string, { amount: number; created: number }>()

  for await (const inv of stripe.invoices.list({ limit: 100 })) {
    const subField = (inv as unknown as { subscription?: string | { id: string } | null }).subscription
    const subscriptionId =
      typeof subField === "string" ? subField : subField?.id ?? null

    if (subscriptionId && !latestInvoiceBySub.has(subscriptionId)) {
      // Prefer amount_paid when the invoice is settled, else amount_due.
      const amount = inv.amount_paid > 0 ? inv.amount_paid : inv.amount_due
      latestInvoiceBySub.set(subscriptionId, { amount, created: inv.created })
    }

    invoiceRows.push({
      id: inv.id,
      subscription_id: subscriptionId,
      customer_id: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null,
      customer_email: inv.customer_email ?? null,
      customer_name: inv.customer_name ?? null,
      amount_due: centsToDollars(inv.amount_due),
      amount_paid: centsToDollars(inv.amount_paid),
      status: inv.status,
      description: inv.description,
      created: unixToIso(inv.created),
      due_date: unixToIso(inv.due_date),
      period_start: unixToIso(inv.period_start),
      period_end: unixToIso(inv.period_end),
      raw_json: inv,
      synced_at: now,
    })
  }

  // --- Subscriptions ---

  const subRows: Record<string, unknown>[] = []
  const subIds: string[] = []
  const subErrors: string[] = []

  for await (const sub of stripe.subscriptions.list({
    expand: ["data.customer"],
    limit: 100,
  })) {
    const customer = sub.customer as Stripe.Customer
    const items = sub.items.data
    const firstItem = items[0]
    const totalCents = items.reduce(
      (acc, i) => acc + (i.price?.unit_amount ?? 0) * (i.quantity ?? 1),
      0,
    )
    // Fallback to the most recent invoice when the price has no flat unit_amount
    // (tiered/metered pricing returns unit_amount: null, so totalCents ends at 0).
    const fallbackCents = latestInvoiceBySub.get(sub.id)?.amount ?? 0
    const effectiveCents = totalCents > 0 ? totalCents : fallbackCents
    const firstQty = firstItem?.quantity ?? 1
    const firstLabel =
      firstItem?.price?.nickname ?? firstItem?.price?.product?.toString() ?? null
    const planName =
      items.length > 1
        ? `${items.length} items`
        : firstQty > 1 && firstLabel
          ? `${firstLabel} × ${firstQty}`
          : firstLabel

    subRows.push({
      id: sub.id,
      status: sub.status,
      customer_id:
        customer?.id ?? (typeof sub.customer === "string" ? sub.customer : ""),
      customer_email: customer?.email ?? null,
      customer_name: customer?.name ?? null,
      plan_name: planName,
      amount: centsToDollars(effectiveCents),
      currency: firstItem?.price?.currency ?? "usd",
      interval: firstItem?.price?.recurring?.interval ?? null,
      item_count: items.length,
      current_period_start: unixToIso(firstItem?.current_period_start ?? sub.created),
      current_period_end: unixToIso(firstItem?.current_period_end ?? sub.created),
      cancel_at_period_end: sub.cancel_at_period_end,
      created: unixToIso(sub.created),
      raw_json: sub,
      synced_at: now,
    })
    subIds.push(sub.id)
  }

  // Upsert subs in one shot (idempotent on PK)
  if (subRows.length > 0) {
    const { error } = await supabase.from("stripe_subscriptions").upsert(subRows)
    if (error) subErrors.push(error.message)
  }

  // Delete subs that no longer exist upstream (removed from Stripe)
  if (subIds.length > 0) {
    const { error: pruneErr } = await supabase
      .from("stripe_subscriptions")
      .delete()
      .not("id", "in", `(${subIds.map((id) => `"${id}"`).join(",")})`)
    if (pruneErr) subErrors.push(`prune: ${pruneErr.message}`)
  }

  // Upsert in chunks to stay under payload limits
  const CHUNK = 500
  let upsertedInv = 0
  for (let i = 0; i < invoiceRows.length; i += CHUNK) {
    const chunk = invoiceRows.slice(i, i + CHUNK)
    const { error } = await supabase.from("stripe_invoices").upsert(chunk)
    if (error) invErrors.push(error.message)
    else upsertedInv += chunk.length
  }

  return {
    subscriptions: { upserted: subRows.length, errors: subErrors },
    invoices: { upserted: upsertedInv, errors: invErrors },
  }
}
