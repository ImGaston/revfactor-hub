import type { SupabaseClient } from "@supabase/supabase-js"
import Stripe from "stripe"

// --- Client (server-only) ---

let stripeClient: Stripe | null = null

function getStripeClient(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set")
    stripeClient = new Stripe(key, {
      // @ts-expect-error Preview payout reconciliation is newer than this SDK's pinned types.
      apiVersion: "2026-05-27.preview",
    })
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
  payouts: { upserted: number; reconciled: number; errors: string[] }
}

function objectId(value: unknown): string | null {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === "string" ? id : null
  }
  return null
}

function invoiceFromBalanceSource(source: unknown): unknown {
  if (!source || typeof source !== "object") return null
  const record = source as Record<string, unknown>
  if (record.object === "invoice") return record
  if (record.invoice) return record.invoice
  const charge = record.charge
  if (charge && typeof charge === "object") {
    return (charge as Record<string, unknown>).invoice ?? null
  }
  return null
}

function subscriptionIdFromInvoice(invoice: unknown): string | null {
  if (!invoice || typeof invoice !== "object") return null
  const record = invoice as Record<string, unknown>
  const direct = objectId(record.subscription)
  if (direct) return direct

  const parent = record.parent
  if (!parent || typeof parent !== "object") return null
  const subscriptionDetails = (parent as Record<string, unknown>)
    .subscription_details
  if (!subscriptionDetails || typeof subscriptionDetails !== "object")
    return null
  return objectId((subscriptionDetails as Record<string, unknown>).subscription)
}

export async function syncStripeData(
  supabase: SupabaseClient
): Promise<SyncResult> {
  const stripe = getStripeClient()
  const now = new Date().toISOString()

  // --- Invoices (fetched first so we can use them as a fallback for sub.amount
  //     when the Stripe price has no flat unit_amount, e.g. tiered/metered)  ---

  const invoiceRows: Record<string, unknown>[] = []
  const invErrors: string[] = []
  // Most-recent invoice per subscription (by created desc). We iterate newest
  // first (Stripe default), so the FIRST invoice seen per sub is the latest.
  const latestInvoiceBySub = new Map<
    string,
    { amount: number; created: number }
  >()
  // payment_intent -> subscription. The 2026-05-27.preview API no longer exposes
  // charge.invoice / invoice.subscription, so we link payout charges back to
  // subscriptions through each invoice's payment records.
  const subByPaymentIntent = new Map<string, string>()

  for await (const inv of stripe.invoices.list({
    limit: 100,
    expand: ["data.payments"],
  })) {
    // Preview API: the subscription moved to parent.subscription_details.
    const parent = (inv as unknown as { parent?: unknown }).parent
    const subscriptionId = subscriptionIdFromInvoice(inv)

    if (subscriptionId && !latestInvoiceBySub.has(subscriptionId)) {
      // Prefer amount_paid when the invoice is settled, else amount_due.
      const amount = inv.amount_paid > 0 ? inv.amount_paid : inv.amount_due
      latestInvoiceBySub.set(subscriptionId, { amount, created: inv.created })
    }

    // Map every payment_intent that settled this invoice to its subscription.
    if (subscriptionId) {
      const payments = (
        inv as unknown as {
          payments?: { data?: { payment?: { payment_intent?: unknown } }[] }
        }
      ).payments
      for (const entry of payments?.data ?? []) {
        const pi = objectId(entry.payment?.payment_intent)
        if (pi) subByPaymentIntent.set(pi, subscriptionId)
      }
    }
    void parent

    invoiceRows.push({
      id: inv.id,
      subscription_id: subscriptionId,
      customer_id:
        typeof inv.customer === "string"
          ? inv.customer
          : (inv.customer?.id ?? null),
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
  // customer -> subscription, used as a fallback when a payout charge cannot be
  // matched to an invoice payment. Only customers with a single subscription are
  // safe to attribute unambiguously.
  const subCountByCustomer = new Map<string, number>()
  const subByCustomer = new Map<string, string>()

  for await (const sub of stripe.subscriptions.list({
    expand: ["data.customer"],
    limit: 100,
  })) {
    const customer = sub.customer as Stripe.Customer
    const customerId =
      customer?.id ?? (typeof sub.customer === "string" ? sub.customer : null)
    if (customerId) {
      subCountByCustomer.set(
        customerId,
        (subCountByCustomer.get(customerId) ?? 0) + 1
      )
      subByCustomer.set(customerId, sub.id)
    }
    const items = sub.items.data
    const firstItem = items[0]
    const totalCents = items.reduce(
      (acc, i) => acc + (i.price?.unit_amount ?? 0) * (i.quantity ?? 1),
      0
    )
    // Fallback to the most recent invoice when the price has no flat unit_amount
    // (tiered/metered pricing returns unit_amount: null, so totalCents ends at 0).
    const fallbackCents = latestInvoiceBySub.get(sub.id)?.amount ?? 0
    const effectiveCents = totalCents > 0 ? totalCents : fallbackCents
    const firstQty = firstItem?.quantity ?? 1
    const firstLabel =
      firstItem?.price?.nickname ??
      firstItem?.price?.product?.toString() ??
      null
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
      current_period_start: unixToIso(
        firstItem?.current_period_start ?? sub.created
      ),
      current_period_end: unixToIso(
        firstItem?.current_period_end ?? sub.created
      ),
      cancel_at_period_end: sub.cancel_at_period_end,
      created: unixToIso(sub.created),
      raw_json: sub,
      synced_at: now,
    })
    subIds.push(sub.id)
  }

  // Upsert subs in one shot (idempotent on PK)
  if (subRows.length > 0) {
    const { error } = await supabase
      .from("stripe_subscriptions")
      .upsert(subRows)
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

  // --- Payouts and reconciliation ---

  const payoutRows: Record<string, unknown>[] = []
  const payoutCandidates: {
    payout: Stripe.Payout
    reconciliationStatus: string | null
  }[] = []
  const payoutErrors: string[] = []
  let reconciledPayouts = 0
  const mirroredPayoutNet = new Map<string, number>()
  const payoutTransactionPageSize = 1000

  for (let from = 0; ; from += payoutTransactionPageSize) {
    const { data, error } = await supabase
      .from("stripe_payout_transactions")
      .select("payout_id, net_cents, type")
      .range(from, from + payoutTransactionPageSize - 1)

    if (error) {
      payoutErrors.push(`existing transactions: ${error.message}`)
      break
    }

    for (const transaction of data ?? []) {
      // The preview API includes the payout's own negative balance entry.
      // Excluding it leaves the funding transactions that equal payout.amount.
      if (transaction.type === "payout") continue
      mirroredPayoutNet.set(
        transaction.payout_id,
        (mirroredPayoutNet.get(transaction.payout_id) ?? 0) +
          Number(transaction.net_cents),
      )
    }

    if ((data?.length ?? 0) < payoutTransactionPageSize) break
  }

  for await (const payout of stripe.payouts.list({ limit: 100 })) {
    const raw = payout as unknown as Record<string, unknown>
    const reconciliationStatus =
      typeof raw.reconciliation_status === "string"
        ? raw.reconciliation_status
        : null

    const payoutRow = {
      id: payout.id,
      amount_cents: payout.amount,
      currency: payout.currency,
      status: payout.status,
      arrival_date: unixToIso(payout.arrival_date),
      created: unixToIso(payout.created),
      automatic: payout.automatic,
      reconciliation_status: reconciliationStatus,
      failure_code: payout.failure_code ?? null,
      failure_message: payout.failure_message ?? null,
      raw_json: payout,
      synced_at: now,
    }
    payoutRows.push(payoutRow)
    payoutCandidates.push({ payout, reconciliationStatus })
  }

  const upsertedPayoutIds = new Set<string>()
  for (let i = 0; i < payoutRows.length; i += CHUNK) {
    const chunk = payoutRows.slice(i, i + CHUNK)
    const { error: payoutError } = await supabase
      .from("stripe_payouts")
      .upsert(chunk)
    if (payoutError) {
      payoutErrors.push(`payout upsert: ${payoutError.message}`)
    } else {
      for (const row of chunk) upsertedPayoutIds.add(String(row.id))
    }
  }

  async function reconcilePayout({
    payout,
    reconciliationStatus,
  }: {
    payout: Stripe.Payout
    reconciliationStatus: string | null
  }): Promise<boolean> {
    if (!upsertedPayoutIds.has(payout.id)) return false
    if (!payout.automatic || reconciliationStatus !== "completed") return false
    if (mirroredPayoutNet.get(payout.id) === payout.amount) {
      return true
    }

    try {
      const transactionRows: Record<string, unknown>[] = []
      for await (const transaction of stripe.balanceTransactions.list({
        payout: payout.id,
        limit: 100,
        expand: ["data.source"],
      })) {
        const source = transaction.source as Record<string, unknown> | null
        const invoice = invoiceFromBalanceSource(source)
        // Resolve the subscription: preferred via the charge's payment_intent
        // (mapped from invoice payments), then a single-subscription customer,
        // then the legacy invoice path for older API objects.
        const paymentIntentId = source ? objectId(source.payment_intent) : null
        const customerId = source ? objectId(source.customer) : null
        const subscriptionId =
          (paymentIntentId
            ? (subByPaymentIntent.get(paymentIntentId) ?? null)
            : null) ??
          (customerId && subCountByCustomer.get(customerId) === 1
            ? (subByCustomer.get(customerId) ?? null)
            : null) ??
          subscriptionIdFromInvoice(invoice)
        transactionRows.push({
          id: transaction.id,
          payout_id: payout.id,
          amount_cents: transaction.amount,
          fee_cents: transaction.fee,
          net_cents: transaction.net,
          currency: transaction.currency,
          type: transaction.type,
          source_id: objectId(transaction.source),
          invoice_id: objectId(invoice),
          subscription_id: subscriptionId,
          available_on: unixToIso(transaction.available_on),
          created: unixToIso(transaction.created),
          raw_json: transaction,
          synced_at: now,
        })
      }

      const { error: deleteError } = await supabase
        .from("stripe_payout_transactions")
        .delete()
        .eq("payout_id", payout.id)
      if (deleteError) throw deleteError

      for (let i = 0; i < transactionRows.length; i += CHUNK) {
        const { error } = await supabase
          .from("stripe_payout_transactions")
          .upsert(transactionRows.slice(i, i + CHUNK))
        if (error) throw error
      }
      return true
    } catch (error) {
      payoutErrors.push(
        `${payout.id}: ${error instanceof Error ? error.message : "reconciliation failed"}`
      )
      return false
    }
  }

  const payoutReconciliationConcurrency = 6
  for (
    let i = 0;
    i < payoutCandidates.length;
    i += payoutReconciliationConcurrency
  ) {
    const results = await Promise.all(
      payoutCandidates
        .slice(i, i + payoutReconciliationConcurrency)
        .map(reconcilePayout),
    )
    reconciledPayouts += results.filter(Boolean).length
  }

  return {
    subscriptions: { upserted: subRows.length, errors: subErrors },
    invoices: { upserted: upsertedInv, errors: invErrors },
    payouts: {
      upserted: payoutRows.length,
      reconciled: reconciledPayouts,
      errors: payoutErrors,
    },
  }
}
