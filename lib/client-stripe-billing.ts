import type { SupabaseClient } from "@supabase/supabase-js"

const BILLABLE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]

export async function getClientStripeBilling(
  supabase: SupabaseClient,
  clientIds?: string[]
): Promise<Map<string, number>> {
  let linksQuery = supabase
    .from("client_stripe_customers")
    .select("client_id, stripe_customer_id")

  if (clientIds) {
    if (clientIds.length === 0) return new Map()
    linksQuery = linksQuery.in("client_id", clientIds)
  }

  const { data: links, error: linksError } = await linksQuery
  if (linksError) throw new Error(linksError.message)
  if (!links?.length) return new Map()

  const customerIds = [...new Set(links.map((link) => link.stripe_customer_id))]
  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from("stripe_subscriptions")
    .select("customer_id, amount, interval, status")
    .in("customer_id", customerIds)
    .in("status", BILLABLE_SUBSCRIPTION_STATUSES)

  if (subscriptionsError) throw new Error(subscriptionsError.message)

  const billingByCustomer = new Map<string, number>()
  for (const subscription of subscriptions ?? []) {
    if (subscription.interval !== "month") continue
    billingByCustomer.set(
      subscription.customer_id,
      (billingByCustomer.get(subscription.customer_id) ?? 0) +
        Number(subscription.amount)
    )
  }

  const billingByClient = new Map<string, number>()
  for (const link of links) {
    const amount = billingByCustomer.get(link.stripe_customer_id)
    if (amount == null) continue
    billingByClient.set(
      link.client_id,
      (billingByClient.get(link.client_id) ?? 0) + amount
    )
  }

  return billingByClient
}
