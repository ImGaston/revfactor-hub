import type { SupabaseClient } from "@supabase/supabase-js"
import type Stripe from "stripe"
import { allRows } from "./pagination"
import { buildMrrDetails, MRR_VERSION, type SubscriptionInput } from "./mrr"

export async function recordMrrFailure(db: SupabaseClient, error: string) {
  const result = await db
    .from("financial_mrr_snapshots")
    .insert({
      valid: false,
      error,
      calculation_version: MRR_VERSION,
      details: [],
    })
  if (result.error) throw new Error(result.error.message)
}
export async function captureMrr(
  db: SupabaseClient,
  stripe: Stripe,
  subscriptions: Stripe.Subscription[],
  errors: string[]
) {
  if (errors.length) {
    await recordMrrFailure(db, errors.join("; "))
    return
  }
  const [clients, links] = await Promise.all([
    allRows<{ id: string; status: string }>(db, "clients", "id,status"),
    // This join table has no id column.
    (async () => {
      const rows: { client_id: string; stripe_customer_id: string }[] = []
      for (let from = 0; ; from += 500) {
        const { data, error } = await db
          .from("client_stripe_customers")
          .select("client_id,stripe_customer_id")
          .order("client_id")
          .order("stripe_customer_id")
          .range(from, from + 499)
        if (error) throw new Error(error.message)
        rows.push(...data)
        if (data.length < 500) return rows
      }
    })(),
  ])
  const inputs: SubscriptionInput[] = []
  for (const sub of subscriptions) {
    if (!["active", "past_due"].includes(sub.status)) continue
    let raw = sub
    if (
      sub.discounts.length ||
      sub.items.data.some((i) => i.discounts.length)
    ) {
      raw = await stripe.subscriptions.retrieve(sub.id, {
        expand: ["discounts.source.coupon", "items.data.discounts"],
      })
      // Resolve item coupon IDs separately to avoid Stripe's four-level expansion limit.
      for (const item of raw.items.data) {
        for (const d of item.discounts) {
          if (
            typeof d !== "string" &&
            d.source?.coupon &&
            typeof d.source.coupon === "string"
          )
            d.source.coupon = await stripe.coupons.retrieve(d.source.coupon)
        }
      }
    }
    if (raw.items.has_more) {
      const items = []
      for await (const item of stripe.subscriptionItems.list({
        subscription: sub.id,
        limit: 100,
        expand: ["data.discounts"],
      }))
        items.push(item)
      raw = { ...raw, items: { ...raw.items, data: items, has_more: false } }
    }
    inputs.push(raw as unknown as SubscriptionInput)
  }
  const observed = new Date()
  const details = buildMrrDetails(
    inputs,
    links,
    clients,
    observed.getTime() / 1000
  )
  const invalid = details.filter(
    (d) => d.mrr_cents === null || (!d.client_id && (d.mrr_cents ?? 0) > 0)
  )
  const valid = invalid.length === 0
  const result = await db
    .from("financial_mrr_snapshots")
    .insert({
      observed_at: observed.toISOString(),
      calculation_version: MRR_VERSION,
      valid,
      error: valid
        ? null
        : `${invalid.length} suscripciones requieren revisión`,
      mrr_cents: valid
        ? details.reduce((s, d) => s + (d.mrr_cents ?? 0), 0)
        : null,
      past_due_cents: valid
        ? details
            .filter((d) => d.status === "past_due")
            .reduce((s, d) => s + (d.mrr_cents ?? 0), 0)
        : null,
      paying_clients: valid
        ? new Set(
            details
              .filter((d) => (d.mrr_cents ?? 0) > 0)
              .map((d) => d.client_id)
          ).size
        : null,
      details,
    })
  if (result.error) throw new Error(result.error.message)
}
