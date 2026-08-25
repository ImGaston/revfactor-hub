"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import {
  sanitizeViewParams,
  viewParamsAreEmpty,
  VIEW_NAME_MAX,
} from "@/lib/reservation-views"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function createReservationView(name: string, params: unknown) {
  // RLS enforces this too, but the in-code check gives a readable error
  // instead of a policy violation.
  if (!(await hasPermission("reservations", "view"))) {
    return { error: "Not authorized" }
  }

  const trimmed = name.trim()
  if (!trimmed) return { error: "View name is required" }
  if (trimmed.length > VIEW_NAME_MAX) {
    return { error: `View name must be at most ${VIEW_NAME_MAX} characters` }
  }

  const clean = sanitizeViewParams(params)
  if (!clean || viewParamsAreEmpty(clean)) {
    return { error: "Set at least one filter before saving a view" }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { error } = await supabase.from("reservation_views").insert({
    name: trimmed,
    params: clean,
    created_by: user.id,
  })
  if (error) {
    if (error.code === "23505") {
      return { error: "A view with that name already exists" }
    }
    return { error: error.message }
  }

  revalidatePath("/reservations")
  return { success: true }
}

export async function deleteReservationView(id: string) {
  if (!UUID_RE.test(id)) return { error: "Invalid view id" }

  const supabase = await createClient()
  // RLS restricts DELETE to the creator or super_admin; a filtered-out row
  // deletes nothing, so check the returned rows to report it honestly.
  const { data, error } = await supabase
    .from("reservation_views")
    .delete()
    .eq("id", id)
    .select("id")
  if (error) return { error: error.message }
  if (!data || data.length === 0) {
    return { error: "View not found, or only its creator can delete it" }
  }

  revalidatePath("/reservations")
  return { success: true }
}
