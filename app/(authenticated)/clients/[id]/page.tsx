import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/lib/supabase/profile"
import { isAssemblyConfigured } from "@/lib/assembly"
import { notFound } from "next/navigation"
import { ClientDetailPage } from "@/components/clients/client-detail-page"
import {
  linkAssemblyClientAction,
  unlinkAssemblyClientAction,
} from "@/app/(authenticated)/settings/clients/actions"

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

  const [{ data: client }, { data: credentials }] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, status, billing_amount, onboarding_date, ending_date, autopayment_set_up, stripe_dashboard, email, assembly_link, assembly_client_id, assembly_company_id, dashboard_token, listings(id, name, status, listing_id, pricelabs_link, airbnb_link, city, state, pl_occupancy_next_7, pl_market_occupancy_next_7, pl_occupancy_next_30, pl_market_occupancy_next_30, pl_mpi_next_30, pl_last_booked_date), tasks(id, title, status, owner, tags, profiles(full_name, email))"
      )
      .eq("id", id)
      .single(),
    supabase
      .from("client_credentials")
      .select("*")
      .eq("client_id", id)
      .order("software")
      .order("name"),
  ])

  if (!client) notFound()

  const filteredClient = {
    ...client,
    listings: (client.listings ?? []).filter((l: { status?: string }) => l.status !== "inactive"),
  }

  return (
    <ClientDetailPage
      client={filteredClient}
      credentials={credentials ?? []}
      isSuperAdmin={profile?.role === "super_admin"}
      assemblyConfigured={isAssemblyConfigured()}
      onLinkAssembly={linkAssemblyClientAction}
      onUnlinkAssembly={unlinkAssemblyClientAction}
    />
  )
}
