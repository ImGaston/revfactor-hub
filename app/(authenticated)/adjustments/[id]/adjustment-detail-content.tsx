import { notFound, redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import type {
  Adjustment,
  AdjustmentComment,
  AdjustmentStatusHistoryEntry,
} from "@/lib/types"
import { AdjustmentDetail } from "./adjustment-detail"

// Internal detail view — richer than the public card at /a/[token], which
// stays the only sharing surface. clients_basic keeps client fields minimal.
const DETAIL_SELECT = `
  id, public_token, scope, client_id, listing_id, type, target_value,
  date_from, date_to, booking_window, urgency, origin, requested_by, origin_message,
  status, resolver_id, resolved_at, reviewer_id, controlled_at, created_by,
  created_at, updated_at,
  clients:clients_basic(id, name),
  listings(id, name, listing_id, pricelabs_link, airbnb_link),
  resolver:profiles!adjustments_resolver_id_fkey(full_name, email),
  reviewer:profiles!adjustments_reviewer_id_fkey(full_name, email),
  creator:profiles!adjustments_created_by_fkey(full_name, email)
`

// Shared server component: fetches everything the adjustment detail needs.
// Used by the full page (/adjustments/[id]) and by the intercepted modal
// route (@modal/(.)adjustments/[id]).
export async function AdjustmentDetailContent({
  id,
  variant = "page",
}: {
  id: string
  variant?: "page" | "modal"
}) {
  // The intercepting route bypasses the list page — re-check the gate here
  const canView = await hasPermission("adjustments", "view")
  if (!canView) redirect("/")

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [
    { data: adjustment },
    { data: comments },
    { data: history },
    canEdit,
    canControl,
    canCreateTask,
  ] = await Promise.all([
    supabase.from("adjustments").select(DETAIL_SELECT).eq("id", id).single(),
    // RLS hides internal thread replies (parent_id set) from non-control roles.
    // profiles needs the FK hint: the reactions junction adds a second
    // comment→profiles path and PostgREST would 300 on the bare embed.
    supabase
      .from("adjustment_comments")
      .select(
        "*, profiles!adjustment_comments_author_id_fkey(full_name, email, avatar_url), adjustment_comment_reactions(emoji, user_id)"
      )
      .eq("adjustment_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("adjustment_status_history")
      .select("*, changed_by_profile:profiles(full_name, email, avatar_url)")
      .eq("adjustment_id", id)
      .order("created_at", { ascending: true }),
    hasPermission("adjustments", "edit"),
    hasPermission("adjustments", "control"),
    hasPermission("tasks", "create"),
  ])

  if (!adjustment) notFound()

  return (
    <AdjustmentDetail
      adjustment={adjustment as unknown as Adjustment}
      comments={(comments ?? []) as unknown as AdjustmentComment[]}
      history={(history ?? []) as unknown as AdjustmentStatusHistoryEntry[]}
      canEdit={canEdit}
      canControl={canControl}
      canCreateTask={canCreateTask}
      currentUserId={user.id}
      variant={variant}
    />
  )
}
