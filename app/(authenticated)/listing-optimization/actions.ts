"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { checkCoverage, type CheckResult } from "@/lib/listing-optimization-checks"
import { logEvent, sendOwnerBundleMessage, sendReviewOwnerMessage } from "@/lib/listing-optimization.server"
import { MAX_OWNER_MESSAGE_LENGTH } from "@/lib/listing-optimization-message"

type Status = "draft" | "published" | "archived"

/**
 * Publishing is Fede's approval of every suggestion in the report: once an
 * owner accepts an item, it goes straight to the apply queue.
 */
export async function setOptimizationReportStatusAction(
  reportId: string,
  status: Status
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!["draft", "published", "archived"].includes(status)) {
    return { ok: false, error: "Invalid status" }
  }
  if (!(await hasPermission("listings", "edit"))) {
    return { ok: false, error: "You don't have permission to publish listing reviews." }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (status === "published") {
    const { data: report } = await supabase
      .from("listing_optimization_reports")
      .select("checks")
      .eq("id", reportId)
      .maybeSingle()
    const coverage = checkCoverage(Array.isArray(report?.checks) ? (report.checks as CheckResult[]) : [])
    if (!coverage.complete) {
      return {
        ok: false,
        error: `This review is partial: ${coverage.missing.length + coverage.notChecked.length} of ${coverage.total} standard checks weren't run (usually the host-view pass). Finish the audit before publishing.`,
      }
    }
  }

  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status === "published") {
    update.published_at = new Date().toISOString()
    update.published_by = user?.id ?? null
  }
  const { error } = await supabase
    .from("listing_optimization_reports")
    .update(update)
    .eq("id", reportId)
  if (error) return { ok: false, error: error.message }

  await logEvent({
    reportId,
    action:
      status === "published"
        ? "PublishListingReview"
        : status === "archived"
          ? "ArchiveListingReview"
          : "UnpublishListingReview",
    actorType: "staff",
    actorId: user?.id ?? null,
  })

  revalidatePath("/listing-optimization")
  revalidatePath(`/listing-optimization/${reportId}`)
  return { ok: true }
}

/** Saves the owner message (editable until it has been sent). */
export async function saveOwnerMessageAction(
  reportId: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPermission("listings", "edit"))) {
    return { ok: false, error: "You don't have permission to edit listing reviews." }
  }
  const trimmed = typeof text === "string" ? text.trim() : ""
  if (!trimmed) return { ok: false, error: "The message can't be empty." }
  if (trimmed.length > MAX_OWNER_MESSAGE_LENGTH) return { ok: false, error: "The message is too long." }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("listing_optimization_reports")
    .update({ owner_message: trimmed, updated_at: new Date().toISOString() })
    .eq("id", reportId)
    .is("owner_message_sent_at", null)
    .select("id")
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: "This message was already sent." }
  revalidatePath(`/listing-optimization/${reportId}`)
  return { ok: true }
}

/**
 * Publish & send: one click by Fede publishes the review and sends the saved
 * owner message to the client's Assembly chat. If publishing works but the
 * send fails, the review stays published and the message can be re-sent.
 */
export async function publishAndSendAction(
  reportId: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string; published?: boolean }> {
  const saved = await saveOwnerMessageAction(reportId, text)
  if (!saved.ok) return saved
  const published = await setOptimizationReportStatusAction(reportId, "published")
  if (!published.ok) return published
  const sent = await sendOwnerMessageAction(reportId)
  if (!sent.ok) return { ...sent, published: true }
  return { ok: true }
}

/** Sends the owner message for an already-published review (e.g. a retry). */
export async function sendOwnerMessageAction(
  reportId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPermission("listings", "edit"))) {
    return { ok: false, error: "You don't have permission to send listing review messages." }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const result = await sendReviewOwnerMessage({ reportId, actorUserId: user?.id ?? null })
  revalidatePath("/listing-optimization")
  revalidatePath(`/listing-optimization/${reportId}`)
  return result
}

/**
 * Owner-level Publish & send all: publishes the picked reviews of one owner
 * (drafts must have a complete checklist) and sends ONE Assembly message for
 * all of them. Already-published, unsent reviews can be included, which also
 * makes this the retry path when the send fails after publishing.
 */
export async function publishAndSendOwnerReviewsAction(
  clientId: string,
  reportIds: string[],
  text: string
): Promise<{ ok: true } | { ok: false; error: string; published?: boolean }> {
  if (!(await hasPermission("listings", "edit"))) {
    return { ok: false, error: "You don't have permission to publish listing reviews." }
  }
  const ids = [...new Set(Array.isArray(reportIds) ? reportIds : [])]
  if (ids.length === 0) return { ok: false, error: "Pick at least one review." }
  const trimmed = typeof text === "string" ? text.trim() : ""
  if (!trimmed) return { ok: false, error: "The message can't be empty." }
  if (trimmed.length > MAX_OWNER_MESSAGE_LENGTH) return { ok: false, error: "The message is too long." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: reports, error } = await supabase
    .from("listing_optimization_reports")
    .select("id, client_id, status, checks, owner_message_sent_at")
    .in("id", ids)
  if (error) return { ok: false, error: error.message }
  if (!reports || reports.length !== ids.length) return { ok: false, error: "Some reviews weren't found." }
  if (reports.some((r) => r.client_id !== clientId)) {
    return { ok: false, error: "All reviews must belong to the same owner." }
  }
  if (reports.some((r) => r.owner_message_sent_at)) {
    return { ok: false, error: "A message was already sent for one of these reviews. Reload the page." }
  }
  if (reports.some((r) => r.status !== "draft" && r.status !== "published")) {
    return { ok: false, error: "Archived reviews can't be sent." }
  }
  // Check every draft before publishing any, so a partial review doesn't
  // leave the owner with half the bundle published.
  const partial = reports.filter(
    (r) =>
      r.status === "draft" &&
      !checkCoverage(Array.isArray(r.checks) ? (r.checks as CheckResult[]) : []).complete
  )
  if (partial.length > 0) {
    return {
      ok: false,
      error: `${partial.length === 1 ? "One review is" : `${partial.length} reviews are`} partial. Finish the audit before publishing.`,
    }
  }

  let publishedAny = false
  for (const r of reports) {
    if (r.status === "published") continue
    const published = await setOptimizationReportStatusAction(r.id, "published")
    if (!published.ok) return { ...published, published: publishedAny }
    publishedAny = true
  }

  const sent = await sendOwnerBundleMessage({ clientId, reportIds: ids, text: trimmed, actorUserId: user?.id ?? null })
  revalidatePath("/listing-optimization")
  revalidatePath(`/listing-optimization/owner/${clientId}`)
  for (const id of ids) revalidatePath(`/listing-optimization/${id}`)
  if (!sent.ok) return { ...sent, published: true }
  return { ok: true }
}
