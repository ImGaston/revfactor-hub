import { redirect, notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import {
  isStripeConfigured,
  getSubscription,
  listInvoicesBySubscription,
} from "@/lib/stripe"
import { SubscriptionDetail } from "./subscription-detail"

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, profile] = await Promise.all([params, getProfile()])

  if (profile?.role !== "super_admin") {
    redirect("/")
  }

  if (!isStripeConfigured()) {
    redirect("/financials")
  }

  const supabase = await createClient()

  const [subscription, invoices] = await Promise.all([
    getSubscription(id),
    listInvoicesBySubscription(id, 4),
  ])

  if (!subscription) notFound()

  const [{ data: linkedClient }, { data: linkedListings }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, email")
      .eq("stripe_customer_id", subscription.customerId)
      .maybeSingle(),
    supabase
      .from("listings")
      .select("id, name, city, state, clients(id, name)")
      .eq("stripe_subscription_id", subscription.id),
  ])

  return (
    <SubscriptionDetail
      subscription={subscription}
      invoices={invoices}
      linkedClient={linkedClient ?? null}
      linkedListings={
        (linkedListings ?? []).map((l) => ({
          id: l.id as string,
          name: l.name as string,
          city: (l.city as string | null) ?? null,
          state: (l.state as string | null) ?? null,
          client: Array.isArray(l.clients) ? l.clients[0] ?? null : l.clients ?? null,
        }))
      }
    />
  )
}
