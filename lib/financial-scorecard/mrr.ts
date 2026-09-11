import type { MrrDetail } from "./types"
export const MRR_VERSION = "cash-scorecard-mrr-v1"
type Coupon = {
  percent_off?: number | null
  amount_off?: number | null
  currency?: string | null
  applies_to?: { products: string[] }
}
type Discount = {
  start?: number
  end?: number | null
  coupon?: Coupon | string
  source?: { coupon?: Coupon | string }
}
type Item = {
  quantity?: number | null
  discounts?: (Discount | string)[]
  price?: {
    unit_amount?: number | null
    unit_amount_decimal?: string | null
    transform_quantity?: unknown
    currency?: string
    product?: string | { id: string }
    recurring?: {
      interval: string
      interval_count?: number
      usage_type?: string
    } | null
  }
}
export type SubscriptionInput = {
  id: string
  status: string
  customer: string | { id: string }
  discounts?: (Discount | string)[]
  items: { data: Item[]; has_more?: boolean }
}
function discount(
  amount: number,
  discounts: (Discount | string)[],
  now: number,
  product: string,
  currency: string
) {
  for (const d of discounts) {
    if (typeof d === "string") throw new Error("Descuento sin resolver")
    if ((d.start && d.start > now) || (d.end && d.end <= now)) continue
    const c = d.source?.coupon ?? d.coupon
    if (!c || typeof c === "string") throw new Error("Cupón sin resolver")
    if (c.applies_to && !c.applies_to.products.includes(product)) continue
    if (c.percent_off != null) amount *= 1 - c.percent_off / 100
    else if (c.amount_off != null) {
      if (c.currency !== currency)
        throw new Error("Moneda de descuento no compatible")
      amount -= c.amount_off
    } else throw new Error("Descuento no calculable")
    amount = Math.max(0, amount)
  }
  return amount
}
export function subscriptionMrr(sub: SubscriptionInput, now: number): number {
  if (!["active", "past_due"].includes(sub.status)) return 0
  if (sub.items.has_more) throw new Error("Ítems incompletos")
  const entries = sub.items.data
    .filter((i) => i.price?.recurring)
    .map((item) => {
      const p = item.price!,
        r = p.recurring!
      if (
        p.currency !== "usd" ||
        (p.unit_amount == null && p.unit_amount_decimal == null) ||
        p.transform_quantity != null ||
        r.usage_type === "metered"
      )
        throw new Error("Precio no normalizable en USD")
      const periods = r.interval_count ?? 1
      const factor = (
        { month: 1, year: 1 / 12, week: 52 / 12, day: 365 / 12 } as Record<
          string,
          number
        >
      )[r.interval]
      if (!factor || periods <= 0) throw new Error("Intervalo no compatible")
      const product =
        typeof p.product === "string" ? p.product : (p.product?.id ?? "")
      return {
        cents: discount(
          Number(p.unit_amount ?? p.unit_amount_decimal) * (item.quantity ?? 1),
          item.discounts ?? [],
          now,
          product,
          "usd"
        ),
        factor: factor / periods,
        product,
      }
    })
  // Subscription fixed discounts apply once per billing period, not once per item.
  for (const d of sub.discounts ?? []) {
    if (typeof d === "string") throw new Error("Descuento sin resolver")
    if ((d.start && d.start > now) || (d.end && d.end <= now)) continue
    const c = d.source?.coupon ?? d.coupon
    if (!c || typeof c === "string") throw new Error("Cupón sin resolver")
    const eligible = entries.filter(
      (e) => !c.applies_to || c.applies_to.products.includes(e.product)
    )
    if (c.percent_off != null)
      eligible.forEach((e) => {
        e.cents = Math.max(0, e.cents * (1 - c.percent_off! / 100))
      })
    else if (c.amount_off != null) {
      if (
        c.currency !== "usd" ||
        new Set(eligible.map((e) => e.factor)).size > 1
      )
        throw new Error("Descuento fijo con intervalos incompatibles")
      const total = eligible.reduce((s, e) => s + e.cents, 0)
      if (total > 0)
        eligible.forEach((e) => {
          e.cents *= Math.max(0, total - c.amount_off!) / total
        })
    } else throw new Error("Descuento no calculable")
  }
  return Math.round(entries.reduce((s, e) => s + e.cents * e.factor, 0))
}
export function buildMrrDetails(
  subs: SubscriptionInput[],
  links: { client_id: string; stripe_customer_id: string }[],
  clients: { id: string; status: string }[],
  now: number
): MrrDetail[] {
  return subs
    .filter((s) => ["active", "past_due"].includes(s.status))
    .flatMap((sub) => {
      const customer =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id
      const ids = [
        ...new Set(
          links
            .filter((l) => l.stripe_customer_id === customer)
            .map((l) => l.client_id)
        ),
      ]
      if (
        ids.length === 1 &&
        clients.find((c) => c.id === ids[0])?.status === "test"
      )
        return []
      const client =
        ids.length === 1 && clients.some((c) => c.id === ids[0]) ? ids[0] : null
      let mrr: number | null = null,
        reason: string | null = client
          ? null
          : "Vinculación de cliente pendiente o ambigua"
      try {
        mrr = subscriptionMrr(sub, now)
      } catch (e) {
        reason = e instanceof Error ? e.message : "MRR no calculable"
      }
      return [
        {
          subscription_id: sub.id,
          customer_id: customer,
          client_id: client,
          status: sub.status,
          mrr_cents: mrr,
          reason,
        },
      ]
    })
}
