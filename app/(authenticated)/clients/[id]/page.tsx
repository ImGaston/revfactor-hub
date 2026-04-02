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

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, name, status, billing_amount, onboarding_date, ending_date, autopayment_set_up, stripe_dashboard, email, assembly_link, assembly_client_id, assembly_company_id, listings(id, name, listing_id, pricelabs_link, airbnb_link, city, state), tasks(id, title, status, owner, tag, profiles(full_name, email))"
    )
    .eq("id", id)
    .single()

  if (!client) notFound()

  return (
    <ClientDetailPage
      client={client}
      isSuperAdmin={profile?.role === "super_admin"}
      assemblyConfigured={isAssemblyConfigured()}
      onLinkAssembly={linkAssemblyClientAction}
      onUnlinkAssembly={unlinkAssemblyClientAction}
    />
  )
}
