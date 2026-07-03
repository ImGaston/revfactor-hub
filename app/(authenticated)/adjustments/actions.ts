"use server"

import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { NOTE_REQUIRED_STATUSES } from "@/lib/adjustments"
import type { AdjustmentStatus } from "@/lib/types"
import { revalidatePath } from "next/cache"

function revalidateAdjustment(publicToken?: string | null) {
  revalidatePath("/adjustments")
  if (publicToken) revalidatePath(`/a/${publicToken}`)
}

export async function createAdjustment(formData: FormData) {
  const scope = formData.get("scope") as string
  const clientId = formData.get("client_id") as string
  const listingId = (formData.get("listing_id") as string) || null
  const tag = formData.get("tag") as string
  const targetValue = (formData.get("target_value") as string) || null
  const dateFrom = (formData.get("date_from") as string) || null
  const dateTo = (formData.get("date_to") as string) || null
  const bookingWindow = (formData.get("booking_window") as string) || null
  const urgency = (formData.get("urgency") as string) || "medium"
  const requestedBy = (formData.get("requested_by") as string) || null
  const originMessage = (formData.get("origin_message") as string) || null

  if (!clientId) return { error: "Client is required" }
  if (!tag) return { error: "Tag is required" }
  if (scope === "single_listing" && !listingId)
    return { error: "Listing is required for single-listing adjustments" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data, error } = await supabase
    .from("adjustments")
    .insert({
      scope,
      client_id: clientId,
      listing_id: scope === "single_listing" ? listingId : null,
      tag,
      target_value: targetValue,
      date_from: dateFrom,
      date_to: dateTo,
      booking_window: bookingWindow,
      urgency,
      requested_by: requestedBy,
      origin_message: originMessage,
      created_by: user.id,
    })
    .select("id, public_token")
    .single()

  if (error) return { error: error.message }

  revalidateAdjustment(data.public_token)
  return { success: true, id: data.id, publicToken: data.public_token }
}

export async function duplicateAdjustment(adjustmentId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: source, error: fetchError } = await supabase
    .from("adjustments")
    .select(
      "scope, client_id, listing_id, tag, target_value, date_from, date_to, booking_window, urgency, requested_by, origin_message"
    )
    .eq("id", adjustmentId)
    .single()

  if (fetchError || !source) return { error: fetchError?.message ?? "Adjustment not found" }

  const { data, error } = await supabase
    .from("adjustments")
    .insert({ ...source, created_by: user.id })
    .select("id, public_token")
    .single()

  if (error) return { error: error.message }

  revalidateAdjustment(data.public_token)
  return { success: true, id: data.id, publicToken: data.public_token }
}

export async function updateAdjustmentStatus(
  adjustmentId: string,
  newStatus: AdjustmentStatus,
  note?: string
) {
  const trimmedNote = note?.trim() ?? ""
  if (NOTE_REQUIRED_STATUSES.includes(newStatus) && !trimmedNote) {
    return { error: "A note explaining the reason is required for this status" }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: current, error: fetchError } = await supabase
    .from("adjustments")
    .select("status, public_token")
    .eq("id", adjustmentId)
    .single()

  if (fetchError || !current) return { error: fetchError?.message ?? "Adjustment not found" }
  if (current.status === newStatus) return { success: true }

  const update: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }

  if (newStatus === "controlled") {
    if (current.status !== "resolved")
      return { error: "Only resolved adjustments can be marked as done" }
    const canControl = await hasPermission("adjustments", "control")
    if (!canControl) return { error: "You don't have permission to control adjustments" }
    update.reviewer_id = user.id
    update.controlled_at = new Date().toISOString()
  }

  if (newStatus === "resolved") {
    update.resolver_id = user.id
    update.resolved_at = new Date().toISOString()
    update.reviewer_id = null
    update.controlled_at = null
  }

  // Reopening clears the two-step closure trail
  if (newStatus === "open" || newStatus === "in_progress") {
    update.resolver_id = null
    update.resolved_at = null
    update.reviewer_id = null
    update.controlled_at = null
  }

  const { error } = await supabase
    .from("adjustments")
    .update(update)
    .eq("id", adjustmentId)

  if (error) return { error: error.message }

  if (trimmedNote) {
    const { error: noteError } = await supabase.from("adjustment_comments").insert({
      adjustment_id: adjustmentId,
      author_id: user.id,
      content: trimmedNote,
    })
    if (noteError) return { error: noteError.message }
  }

  revalidateAdjustment(current.public_token)
  return { success: true }
}

export async function deleteAdjustment(adjustmentId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("adjustments").delete().eq("id", adjustmentId)
  if (error) return { error: error.message }
  revalidatePath("/adjustments")
  return { success: true }
}

export async function addAdjustmentComment(adjustmentId: string, content: string) {
  const trimmed = content.trim()
  if (!trimmed) return { error: "Comment is empty" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: adjustment } = await supabase
    .from("adjustments")
    .select("public_token")
    .eq("id", adjustmentId)
    .single()

  const { error } = await supabase.from("adjustment_comments").insert({
    adjustment_id: adjustmentId,
    author_id: user.id,
    content: trimmed,
  })

  if (error) return { error: error.message }
  revalidateAdjustment(adjustment?.public_token)
  return { success: true }
}

export async function deleteAdjustmentComment(commentId: string) {
  const supabase = await createClient()
  const { data: comment } = await supabase
    .from("adjustment_comments")
    .select("adjustment_id, adjustments(public_token)")
    .eq("id", commentId)
    .single()

  const { error } = await supabase
    .from("adjustment_comments")
    .delete()
    .eq("id", commentId)

  if (error) return { error: error.message }

  const adjustments = comment?.adjustments as { public_token: string } | { public_token: string }[] | null
  const token = Array.isArray(adjustments) ? adjustments[0]?.public_token : adjustments?.public_token
  revalidateAdjustment(token)
  return { success: true }
}

// Lazy lookup data for the create dialog (fetched when the dialog opens)
export async function getAdjustmentFormOptions() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, listings(id, name, status)")
    .order("name")

  if (error) return { error: error.message, clients: [] }

  const clients = (data ?? []).map((client) => ({
    id: client.id,
    name: client.name,
    listings: (client.listings ?? [])
      .filter((l) => l.status !== "inactive")
      .map((l) => ({ id: l.id, name: l.name })),
  }))

  return { clients }
}
