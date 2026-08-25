import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import { getProfile } from "@/lib/supabase/profile"
import { hasPermission } from "@/lib/permissions.server"
import { getListingReport } from "@/lib/report-builder/queries"
import { getRecentReservationsByListing, type Reservation } from "@/lib/reservations"
import { RecentReservationsCard } from "@/components/reservations/recent-reservations-card"
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
       clients:clients_basic(id, name, status)`
      )
      .eq("id", id)
      .single(),
    getProfile(),
  ])

  if (!listing) notFound()

  // Monthly Report Builder series for this listing (latest completed run),
  // plus the Rankbreeze association from the SEO metrics upload: the CSV maps
  // numeric Airbnb IDs → rankbreeze_id (policy in migration 040). Hub listings
  // may carry the Airbnb ID in listing_id or only inside airbnb_link (older
  // rows store a PriceLabs ID in listing_id), so we try both keys. Newest row
  // wins when an Airbnb ID was re-tracked under a new Rankbreeze listing.
  const airbnbIdCandidates = [
    listing.listing_id,
    (listing.airbnb_link as string | null)?.match(/\/rooms\/(\d+)/)?.[1],
  ].filter((v): v is string => !!v)

  // clients_basic hands every authenticated session the client's name, but
  // /clients/[id] reads the real `clients` table and calls notFound() when RLS
  // filters it out. So linking there is only safe with clients:view -- without
  // it (hostpricing, for one) the link would 404.
  const [canViewReservations, canViewClient] = await Promise.all([
    hasPermission("reservations", "view"),
    hasPermission("clients", "view"),
  ])

  const [report, rankbreezeResult, recentReservations] = await Promise.all([
    getListingReport(supabase, listing.listing_id),
    airbnbIdCandidates.length > 0
      ? supabase
          .from("seo_metrics_raw")
          .select("rankbreeze_id")
          .in("airbnb_id", airbnbIdCandidates)
          .not("rankbreeze_id", "is", null)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    canViewReservations
      ? getRecentReservationsByListing(supabase, id, 10)
      : Promise.resolve([] as Reservation[]),
  ])
  const rankbreezeId =
    (rankbreezeResult.data?.rankbreeze_id as string | undefined) ?? null

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
      canViewClient={canViewClient}
      report={report}
      rankbreezeId={rankbreezeId}
      canManageSubscription={canManageSubscription}
      currentSubscriptionId={
        (listing.stripe_subscription_id as string | null) ?? null
      }
      subscriptionOptions={subscriptionOptions}
      clientCustomerIds={clientCustomerIds}
      reservationsCard={
        canViewReservations ? (
          <RecentReservationsCard
            reservations={recentReservations}
            context="listing"
          />
        ) : null
      }
    />
  )
}
