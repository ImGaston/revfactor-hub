import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Total paid Stripe revenue per client: sum of paid stripe_invoices.amount_paid
 * across every Stripe customer linked through client_stripe_customers.
 * Clients with no Stripe link (or no paid invoices) have no entry in the Map.
 */
export async function getClientLifetimeValue(
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
  const { data: invoices, error: invoicesError } = await supabase
    .from("stripe_invoices")
    .select("customer_id, amount_paid")
    .in("customer_id", customerIds)
    .eq("status", "paid")
    .limit(10000)

  if (invoicesError) throw new Error(invoicesError.message)

  const paidByCustomer = new Map<string, number>()
  for (const invoice of invoices ?? []) {
    paidByCustomer.set(
      invoice.customer_id,
      (paidByCustomer.get(invoice.customer_id) ?? 0) +
        Number(invoice.amount_paid ?? 0)
    )
  }

  const paidByClient = new Map<string, number>()
  for (const link of links) {
    const amount = paidByCustomer.get(link.stripe_customer_id)
    if (amount == null) continue
    paidByClient.set(
      link.client_id,
      (paidByClient.get(link.client_id) ?? 0) + amount
    )
  }

  return paidByClient
}
