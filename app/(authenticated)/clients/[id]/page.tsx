import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import { isAssemblyConfigured } from "@/lib/assembly"
import { isStripeConfigured } from "@/lib/stripe"
import { notFound } from "next/navigation"
import { ClientDetailPage } from "@/components/clients/client-detail-page"
import {
  linkAssemblyClientAction,
  unlinkAssemblyClientAction,
} from "@/app/(authenticated)/settings/clients/actions"
import {
  createClientStripeCheckoutAction,
  getStripeSubscriptionOptionsAction,
} from "./stripe-actions"
import { getClientStripeBilling } from "@/lib/client-stripe-billing"

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [supabase, profile] = await Promise.all([
    createClient(),
    getProfile(),
  ])
  const isSuperAdmin = profile?.role === "super_admin"

  const [
    { data: client },
    { data: credentials },
    stripeCustomersResult,
    billingByClient,
  ] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, status, billing_amount, onboarding_date, ending_date, autopayment_set_up, stripe_dashboard, email, assembly_link, assembly_client_id, assembly_company_id, dashboard_url, listings(id, name, status, listing_id, pricelabs_link, airbnb_link, city, state, pl_occupancy_next_7, pl_market_occupancy_next_7, pl_occupancy_next_30, pl_market_occupancy_next_30, pl_mpi_next_30, pl_last_booked_date), tasks(id, title, status, owner, tags, profiles(full_name, email))"
      )
      .eq("id", id)
      .single(),
    supabase
      .from("client_credentials")
      .select("*")
      .eq("client_id", id)
      .order("software")
      .order("name"),
    isSuperAdmin
      ? supabase
          .from("client_stripe_customers")
          .select("stripe_customer_id")
          .eq("client_id", id)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    isSuperAdmin
      ? getClientStripeBilling(supabase, [id])
      : Promise.resolve(new Map<string, number>()),
  ])

  if (!client) notFound()

  const filteredClient = {
    ...client,
    billing_amount: isSuperAdmin ? (billingByClient.get(id) ?? null) : null,
    autopayment_set_up: isSuperAdmin ? client.autopayment_set_up : false,
    stripe_dashboard: isSuperAdmin ? client.stripe_dashboard : null,
    listings: (client.listings ?? []).filter((l: { status?: string }) => l.status !== "inactive"),
  }

  return (
    <ClientDetailPage
      client={filteredClient}
      credentials={credentials ?? []}
      isSuperAdmin={isSuperAdmin}
      assemblyConfigured={isAssemblyConfigured()}
      stripeConfigured={isSuperAdmin && isStripeConfigured()}
      stripeCustomerIds={
        isSuperAdmin
          ? (stripeCustomersResult.data ?? []).map((row) => row.stripe_customer_id as string)
          : []
      }
      onLinkAssembly={linkAssemblyClientAction}
      onUnlinkAssembly={unlinkAssemblyClientAction}
      onLoadStripeOptions={isSuperAdmin ? getStripeSubscriptionOptionsAction : undefined}
      onCreateStripeCheckout={isSuperAdmin ? createClientStripeCheckoutAction : undefined}
    />
  )
}
