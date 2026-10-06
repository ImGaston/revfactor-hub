import { redirect } from "next/navigation"
import { hasPermission } from "@/lib/permissions.server"
import { getProfile } from "@/lib/supabase/profile"
import { createClient } from "@/lib/supabase/server"
import { getChurnData } from "@/lib/churn.server"
import { reportDate } from "@/lib/churn"
import { ChurnView } from "./churn-view"

export default async function ChurnPage() {
  const [
    profile,
    canView,
    canViewClients,
    canViewListings,
    canEdit,
    canEditListings,
    canEditClients,
  ] = await Promise.all([
    getProfile(),
    hasPermission("churn", "view"),
    hasPermission("clients", "view"),
    hasPermission("listings", "view"),
    hasPermission("churn", "edit"),
    hasPermission("listings", "edit"),
    hasPermission("clients", "edit"),
  ])
  if (!profile || !canView || !canViewClients || !canViewListings) redirect("/")
  const isSuperAdmin = profile.role === "super_admin"
  const supabase = await createClient()
  const data = await getChurnData(supabase, isSuperAdmin)
  return (
    <ChurnView
      {...data}
      asOf={reportDate()}
      isSuperAdmin={isSuperAdmin}
      canTagExits={canEdit && canEditListings}
      canEditClients={canEdit && canEditClients}
    />
  )
}
