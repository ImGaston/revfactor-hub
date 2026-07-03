import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import type { Adjustment } from "@/lib/types"
import { AdjustmentsView } from "./adjustments-view"

const ADJUSTMENT_SELECT = `
  id, public_token, scope, client_id, listing_id, tag, target_value,
  date_from, date_to, booking_window, urgency, requested_by, origin_message,
  status, resolver_id, resolved_at, reviewer_id, controlled_at, created_by,
  created_at, updated_at,
  clients(id, name),
  listings(id, name, listing_id, pricelabs_link, airbnb_link),
  resolver:profiles!adjustments_resolver_id_fkey(full_name, email),
  reviewer:profiles!adjustments_reviewer_id_fkey(full_name, email)
`

export default async function AdjustmentsPage() {
  const canView = await hasPermission("adjustments", "view")
  if (!canView) redirect("/")

  const supabase = await createClient()

  const [{ data: adjustments }, canControl, canCreate] = await Promise.all([
    supabase
      .from("adjustments")
      .select(ADJUSTMENT_SELECT)
      .order("created_at", { ascending: false })
      .limit(500),
    hasPermission("adjustments", "control"),
    hasPermission("adjustments", "create"),
  ])

  return (
    <AdjustmentsView
      adjustments={(adjustments ?? []) as unknown as Adjustment[]}
      canControl={canControl}
      canCreate={canCreate}
      whatsappInviteUrl={process.env.WHATSAPP_GROUP_INVITE_URL ?? null}
    />
  )
}
