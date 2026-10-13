"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { hasPermission } from "@/lib/permissions.server"
import { checkCoverage, type CheckResult } from "@/lib/listing-optimization-checks"
import { logEvent } from "@/lib/listing-optimization.server"

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
