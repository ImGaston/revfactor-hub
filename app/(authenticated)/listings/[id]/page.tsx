import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { getListingReport } from "@/lib/report-builder/queries"
import { ListingDetail } from "./listing-detail"
import type { ListingSubscriptionOption } from "./change-listing-subscription-dialog"

export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: listing }, profile] = await Promise.all([
    supabase
      .from("listings")
      .select(
        `id, name, status, listing_id, pricelabs_link, airbnb_link, city, state, client_id, stripe_subscription_id, created_at, updated_at,
       pl_base_price, pl_min_price, pl_max_price, pl_recommended_base_price,
       pl_cleaning_fees, pl_no_of_bedrooms,
       pl_occupancy_next_7, pl_market_occupancy_next_7,
       pl_occupancy_next_30, pl_market_occupancy_next_30,
       pl_occupancy_past_90, pl_market_occupancy_past_90,
       pl_mpi_next_30, pl_mpi_next_60, pl_last_booked_date,
       pl_wknd_occupancy_next_30, pl_market_wknd_occupancy_next_30,
       pl_push_enabled, pl_last_refreshed_at, pl_synced_at,
       clients(id, name, status)`
      )
      .eq("id", id)
      .single(),
    getProfile(),
  ])

  if (!listing) notFound()

  // Monthly Report Builder series for this listing (latest completed run).
  const report = await getListingReport(supabase, listing.listing_id)

  const clientRaw = listing.clients as
    | { id: string; name: string; status: string }
    | { id: string; name: string; status: string }[]
    | null
  const client = Array.isArray(clientRaw) ? clientRaw[0] ?? null : clientRaw

  // Subscription management is financial data — super_admin only. We load the
  // mirrored subscriptions (now including canceled ones) and the Stripe customers
  // linked to this listing's client to drive the reassignment picker.
  const canManageSubscription = profile?.role === "super_admin"
  let subscriptionOptions: ListingSubscriptionOption[] = []
  let clientCustomerIds: string[] = []

  if (canManageSubscription) {
    const [subsResult, customersResult] = await Promise.all([
      supabase
        .from("stripe_subscriptions")
        .select(
          "id, status, customer_id, customer_name, plan_name, amount, currency, interval"
        )
        .order("created", { ascending: false }),
      listing.client_id
        ? supabase
            .from("client_stripe_customers")
            .select("stripe_customer_id")
            .eq("client_id", listing.client_id)
        : Promise.resolve({ data: [] as { stripe_customer_id: string }[] }),
    ])

    subscriptionOptions = (subsResult.data ?? []).map((s) => ({
      id: s.id as string,
      status: s.status as string,
      customerId: s.customer_id as string,
      customerName: (s.customer_name as string | null) ?? null,
      planName: (s.plan_name as string | null) ?? null,
      amount: Number(s.amount),
      currency: (s.currency as string) ?? "usd",
      interval: (s.interval as string | null) ?? null,
    }))
    clientCustomerIds = (customersResult.data ?? []).map(
      (r) => r.stripe_customer_id as string
    )
  }

  return (
    <ListingDetail
      listing={{
        id: listing.id,
        name: listing.name,
        status: listing.status,
        listing_id: listing.listing_id,
        pricelabs_link: listing.pricelabs_link,
        airbnb_link: listing.airbnb_link,
        city: listing.city,
        state: listing.state,
        client_id: listing.client_id,
        created_at: listing.created_at,
        updated_at: listing.updated_at,
        pl_base_price: listing.pl_base_price,
        pl_min_price: listing.pl_min_price,
        pl_max_price: listing.pl_max_price,
        pl_recommended_base_price: listing.pl_recommended_base_price,
        pl_cleaning_fees: listing.pl_cleaning_fees,
        pl_no_of_bedrooms: listing.pl_no_of_bedrooms,
        pl_occupancy_next_7: listing.pl_occupancy_next_7,
        pl_market_occupancy_next_7: listing.pl_market_occupancy_next_7,
        pl_occupancy_next_30: listing.pl_occupancy_next_30,
        pl_market_occupancy_next_30: listing.pl_market_occupancy_next_30,
        pl_occupancy_past_90: listing.pl_occupancy_past_90,
        pl_market_occupancy_past_90: listing.pl_market_occupancy_past_90,
        pl_mpi_next_30: listing.pl_mpi_next_30,
        pl_mpi_next_60: listing.pl_mpi_next_60,
        pl_last_booked_date: listing.pl_last_booked_date,
        pl_wknd_occupancy_next_30: listing.pl_wknd_occupancy_next_30,
        pl_market_wknd_occupancy_next_30: listing.pl_market_wknd_occupancy_next_30,
        pl_push_enabled: listing.pl_push_enabled,
        pl_last_refreshed_at: listing.pl_last_refreshed_at,
        pl_synced_at: listing.pl_synced_at,
      }}
      client={client}
      report={report}
      canManageSubscription={canManageSubscription}
      currentSubscriptionId={
        (listing.stripe_subscription_id as string | null) ?? null
      }
      subscriptionOptions={subscriptionOptions}
      clientCustomerIds={clientCustomerIds}
    />
  )
}
