"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hasPermission } from "@/lib/permissions.server"
import {
  NOTE_REQUIRED_STATUSES,
  OPEN_STATUSES,
  validateAdjustmentInput,
} from "@/lib/adjustments"
import type { AdjustmentCommentOrigin, AdjustmentStatus } from "@/lib/types"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"

function revalidateAdjustment(
  adjustmentId?: string | null,
  publicToken?: string | null
) {
  revalidatePath("/adjustments")
  if (adjustmentId) revalidatePath(`/adjustments/${adjustmentId}`)
  if (publicToken) revalidatePath(`/a/${publicToken}`)
}

// Comment origin comes from the author's role, never from the client.
// "client" stays reserved — owners have no Hub login today.
async function commentOriginForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<AdjustmentCommentOrigin> {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()
  return data?.role === "hostpricing" ? "hostpricing" : "internal"
}

// Conditional per-type validation + hidden-field clearing lives in the shared normalizer
function parseAdjustmentForm(formData: FormData) {
  return validateAdjustmentInput({
    scope: formData.get("scope") as string,
    clientId: formData.get("client_id") as string,
    listingId: (formData.get("listing_id") as string) || null,
    type: formData.get("type") as string,
    targetValue: (formData.get("target_value") as string) || null,
    dateFrom: (formData.get("date_from") as string) || null,
    dateTo: (formData.get("date_to") as string) || null,
    bookingWindow: (formData.get("booking_window") as string) || null,
    origin: (formData.get("origin") as string) || "internal",
  })
}

export async function createAdjustment(formData: FormData) {
  const parsed = parseAdjustmentForm(formData)
  if ("error" in parsed) return { error: parsed.error }
  const urgency = (formData.get("urgency") as string) || "medium"
  const requestedBy = (formData.get("requested_by") as string) || null
  const originMessage = (formData.get("origin_message") as string) || null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  // HostPricing users always file as hostpricing — the origin select in the
  // dialog is hidden for them, but the server is the real gate
  if ((await commentOriginForUser(supabase, user.id)) === "hostpricing")
    parsed.value.origin = "hostpricing"

  const { data, error } = await supabase
    .from("adjustments")
    .insert({
      ...parsed.value,
      urgency,
      requested_by: requestedBy,
      origin_message: originMessage,
      created_by: user.id,
    })
    .select("id, public_token")
    .single()

  if (error) return { error: error.message }

  revalidateAdjustment(data.id, data.public_token)
  return { success: true, id: data.id, publicToken: data.public_token }
}

export async function updateAdjustment(adjustmentId: string, formData: FormData) {
  const parsed = parseAdjustmentForm(formData)
  if ("error" in parsed) return { error: parsed.error }
  const urgency = (formData.get("urgency") as string) || "medium"
  const requestedBy = (formData.get("requested_by") as string) || null
  const originMessage = (formData.get("origin_message") as string) || null

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
  if (!OPEN_STATUSES.includes(current.status as AdjustmentStatus))
    return { error: "The change was already made — reopen the adjustment to edit it" }

  const { error } = await supabase
    .from("adjustments")
    .update({
      ...parsed.value,
      urgency,
      requested_by: requestedBy,
      origin_message: originMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", adjustmentId)

  if (error) return { error: error.message }

  revalidateAdjustment(adjustmentId, current.public_token)
  return { success: true }
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
      "scope, client_id, listing_id, type, target_value, date_from, date_to, booking_window, urgency, origin, requested_by, origin_message"
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

  revalidateAdjustment(data.id, data.public_token)
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

  // Reopening (or getting blocked on info) clears the two-step closure trail,
  // so `controlled` stays reachable only from a fresh `resolved`
  if (
    newStatus === "open" ||
    newStatus === "in_progress" ||
    newStatus === "needs_info"
  ) {
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

  const { error: historyError } = await supabase
    .from("adjustment_status_history")
    .insert({
      adjustment_id: adjustmentId,
      from_status: current.status,
      to_status: newStatus,
      changed_by: user.id,
      note: trimmedNote || null,
    })
  if (historyError) return { error: historyError.message }

  if (trimmedNote) {
    // Inserted directly (not via addAdjustmentComment) so the mandatory
    // needs_info note can't auto-revert the status it just set
    const { error: noteError } = await supabase.from("adjustment_comments").insert({
      adjustment_id: adjustmentId,
      author_id: user.id,
      content: trimmedNote,
      origin: await commentOriginForUser(supabase, user.id),
    })
    if (noteError) return { error: noteError.message }
  }

  revalidateAdjustment(adjustmentId, current.public_token)
  return { success: true }
}

export async function deleteAdjustment(adjustmentId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from("adjustments").delete().eq("id", adjustmentId)
  if (error) return { error: error.message }
  revalidatePath("/adjustments")
  return { success: true }
}

export async function addAdjustmentComment(
  adjustmentId: string,
  content: string,
  parentId?: string | null
) {
  const trimmed = content.trim()
  if (!trimmed) return { error: "Comment is empty" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: adjustment } = await supabase
    .from("adjustments")
    .select("status, public_token")
    .eq("id", adjustmentId)
    .single()

  const origin = await commentOriginForUser(supabase, user.id)

  // parent_id != null = internal thread reply; RLS additionally requires
  // adjustments:control for those rows
  const { error } = await supabase.from("adjustment_comments").insert({
    adjustment_id: adjustmentId,
    author_id: user.id,
    content: trimmed,
    origin,
    parent_id: parentId ?? null,
  })

  if (error) return { error: error.message }

  // needs_info means "waiting on the internal team to say something" — an
  // internal reply IS the unblocking information, so the ticket reopens
  // automatically. A hostpricing reply doesn't (it's not the info asked for),
  // and neither does an internal-thread reply — its audience can't see it.
  if (
    !parentId &&
    adjustment?.status === "needs_info" &&
    origin === "internal" &&
    (await hasPermission("adjustments", "edit"))
  ) {
    const { error: revertError } = await supabase
      .from("adjustments")
      .update({ status: "open", updated_at: new Date().toISOString() })
      .eq("id", adjustmentId)
    // The comment is already posted — a failed revert shouldn't fail the action
    if (!revertError) {
      await supabase.from("adjustment_status_history").insert({
        adjustment_id: adjustmentId,
        from_status: "needs_info",
        to_status: "open",
        changed_by: user.id,
        note: "Auto-reopened by internal reply",
      })
    }
  }

  revalidateAdjustment(adjustmentId, adjustment?.public_token)
  return { success: true }
}

export async function toggleAdjustmentCommentReaction(
  commentId: string,
  emoji: string
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: removed, error: deleteError } = await supabase
    .from("adjustment_comment_reactions")
    .delete()
    .eq("comment_id", commentId)
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .select("emoji")

  if (deleteError) return { error: deleteError.message }

  if (!removed || removed.length === 0) {
    const { error } = await supabase.from("adjustment_comment_reactions").insert({
      comment_id: commentId,
      user_id: user.id,
      emoji,
    })
    if (error) return { error: error.message }
  }

  const { data: comment } = await supabase
    .from("adjustment_comments")
    .select("adjustment_id, adjustments(public_token)")
    .eq("id", commentId)
    .single()
  const parent = comment?.adjustments as
    | { public_token: string }
    | { public_token: string }[]
    | null
  const token = Array.isArray(parent) ? parent[0]?.public_token : parent?.public_token
  revalidateAdjustment(comment?.adjustment_id, token)
  return { success: true }
}

// "Create task" on an adjustment comment: spins the message off into a task
// (client/listing inherited from the adjustment) and links it back.
export async function createTaskFromAdjustmentComment(commentId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }
  if (!(await hasPermission("tasks", "create")))
    return { error: "You don't have permission to create tasks" }

  const { data: comment, error: fetchError } = await supabase
    .from("adjustment_comments")
    .select(
      "id, content, linked_task_id, adjustment_id, adjustments(id, public_token, client_id, listing_id, type, target_value)"
    )
    .eq("id", commentId)
    .single()

  if (fetchError || !comment) return { error: fetchError?.message ?? "Comment not found" }
  if (comment.linked_task_id) return { error: "This comment already has a task" }

  const adjustment = Array.isArray(comment.adjustments)
    ? comment.adjustments[0]
    : comment.adjustments
  const title =
    comment.content.length > 80 ? `${comment.content.slice(0, 80)}…` : comment.content

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      title,
      description: `${comment.content}\n\nFrom adjustment comment: /adjustments/${comment.adjustment_id}`,
      client_id: adjustment?.client_id ?? null,
      status: "todo",
      sort_order: 0,
      tags: [],
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  if (adjustment?.listing_id) {
    await supabase
      .from("task_listings")
      .insert({ task_id: task.id, listing_id: adjustment.listing_id })
  }

  // linked_task_id is set with the admin client: the comment UPDATE policy is
  // author-only, but any task creator may link a task to someone else's
  // comment. Guarded by the tasks:create check above.
  const { error: linkError } = await createAdminClient()
    .from("adjustment_comments")
    .update({ linked_task_id: task.id })
    .eq("id", commentId)
  if (linkError) return { error: linkError.message }

  revalidatePath("/tasks")
  revalidateAdjustment(comment.adjustment_id, adjustment?.public_token)
  return { success: true, taskId: task.id }
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
  revalidateAdjustment(comment?.adjustment_id, token)
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
