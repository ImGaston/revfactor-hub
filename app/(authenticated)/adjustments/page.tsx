import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import type { Adjustment } from "@/lib/types"
import { AdjustmentsView } from "./adjustments-view"

const ADJUSTMENT_SELECT = `
  id, public_token, scope, client_id, listing_id, type, target_value,
  date_from, date_to, booking_window, urgency, origin, requested_by, origin_message,
  status, resolver_id, resolved_at, reviewer_id, controlled_at, created_by,
  created_at, updated_at,
  clients:clients_basic(id, name),
  listings(id, name, listing_id, pricelabs_link, airbnb_link),
  resolver:profiles!adjustments_resolver_id_fkey(full_name, email),
  reviewer:profiles!adjustments_reviewer_id_fkey(full_name, email)
`

export default async function AdjustmentsPage() {
  const canView = await hasPermission("adjustments", "view")
  if (!canView) redirect("/")

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: adjustments }, { data: commentStats }, { data: profile }, canControl, canCreate, canEdit] =
    await Promise.all([
      supabase
        .from("adjustments")
        .select(ADJUSTMENT_SELECT)
        .order("created_at", { ascending: false })
        .limit(500),
      // Flat query merged in code — PostgREST embedding of GROUP BY views is fragile
      supabase
        .from("adjustment_comment_stats")
        .select("adjustment_id, comment_count, last_comment_origin"),
      supabase.from("profiles").select("role").eq("id", user?.id ?? "").single(),
      hasPermission("adjustments", "control"),
      hasPermission("adjustments", "create"),
      hasPermission("adjustments", "edit"),
    ])

  const statsById = new Map(
    (commentStats ?? []).map((s) => [s.adjustment_id as string, s])
  )
  const withStats = (adjustments ?? []).map((a) => ({
    ...a,
    comment_stats: statsById.get(a.id) ?? null,
  }))

  return (
    <AdjustmentsView
      adjustments={withStats as unknown as Adjustment[]}
      canControl={canControl}
      canCreate={canCreate}
      canEdit={canEdit}
      isHostpricing={profile?.role === "hostpricing"}
      whatsappInviteUrl={process.env.WHATSAPP_GROUP_INVITE_URL ?? null}
    />
  )
}
