import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  sectionLabel,
  validateDecision,
  type OptimizationDecision,
  type OptimizationItem,
  type OptimizationReport,
} from "@/lib/listing-optimization"
import type { PortalViewer } from "@/lib/assembly-portal-session.server"
import {
  CHECKLIST_VERSION,
  gradeSections,
  scoreChecks,
  type CheckResult,
} from "@/lib/listing-optimization-checks"

export type OptimizationAction =
  | "SubmitListingReviewDraft"
  | "PublishListingReview"
  | "UnpublishListingReview"
  | "ArchiveListingReview"
  | "DecideSuggestion"
  | "MarkOwnerTaskDone"

/** Append-only ontology audit row. Failures are logged, never thrown. */
export async function logEvent(input: {
  reportId: string
  itemId?: string | null
  action: OptimizationAction
  actorType: "owner" | "staff" | "agent" | "system"
  actorId?: string | null
  details?: Record<string, unknown>
}): Promise<void> {
  const { error } = await createAdminClient()
    .from("listing_optimization_events")
    .insert({
      report_id: input.reportId,
      item_id: input.itemId ?? null,
      action: input.action,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      details: input.details ?? {},
    })
  if (error) console.error("listing optimization: event log failed", input.action, error.message)
}

const REPORT_COLUMNS = `id, listing_title, listing_url, cover_photo_url, overall_score,
  score_breakdown, section_grades, owner_line, summary, published_at, listing_id, checks`

const ITEM_COLUMNS = `id, report_id, section, kind, priority, sort_order, headline, rationale,
  current_value, proposed_value, options, photo_url, action_url, check_id, client_status, client_choice,
  client_note, decided_at, apply_status, adjustment_id`

type ItemRow = OptimizationItem & { report_id: string; adjustment_id: string | null }

function toItem(row: ItemRow): OptimizationItem {
  return {
    id: row.id,
    section: row.section,
    kind: row.kind,
    priority: row.priority,
    sort_order: row.sort_order,
    headline: row.headline,
    rationale: row.rationale,
    current_value: row.current_value,
    proposed_value: row.proposed_value,
    options: Array.isArray(row.options) ? row.options.filter((o) => typeof o === "string") : [],
    photo_url: row.photo_url,
    action_url: row.action_url ?? null,
    check_id: row.check_id ?? null,
    client_status: row.client_status,
    client_choice: row.client_choice,
    client_note: row.client_note,
    decided_at: row.decided_at,
    apply_status: row.apply_status,
  }
}

/** Published reports for one Hub client, newest first. Drafts never leave the Hub. */
export async function loadPublishedReports(hubClientId: string): Promise<OptimizationReport[]> {
  const supabase = createAdminClient()
  const { data: reports, error } = await supabase
    .from("listing_optimization_reports")
    .select(REPORT_COLUMNS)
    .eq("client_id", hubClientId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
  if (error) throw new Error(`Could not load reports: ${error.message}`)
  if (!reports || reports.length === 0) return []

  const { data: items, error: itemsError } = await supabase
    .from("listing_optimization_items")
    .select(ITEM_COLUMNS)
    .in(
      "report_id",
      reports.map((r) => r.id)
    )
    .order("sort_order", { ascending: true })
  if (itemsError) throw new Error(`Could not load suggestions: ${itemsError.message}`)

  return reports.map((r) => ({
    id: r.id,
    listing_title: r.listing_title,
    listing_url: r.listing_url,
    cover_photo_url: r.cover_photo_url,
    overall_score: r.overall_score,
    score_breakdown: r.score_breakdown ?? {},
    section_grades: r.section_grades ?? {},
    owner_line: r.owner_line,
    summary: r.summary,
    published_at: r.published_at,
    checks: Array.isArray(r.checks) ? (r.checks as CheckResult[]) : [],
    items: ((items ?? []) as ItemRow[]).filter((i) => i.report_id === r.id).map(toItem),
  }))
}

function adjustmentMessage(
  item: ItemRow,
  choice: string | null,
  note: string | null,
  channelManager: string | null
): string {
  const lines = [
    `Owner accepted a listing suggestion in the portal (${sectionLabel(item.section)}).`,
    `Suggestion: ${item.headline}`,
  ]
  if (item.current_value) lines.push(`Current: ${item.current_value}`)
  if (choice) lines.push(`Apply: ${choice}`)
  if (note) lines.push(`Owner note: ${note}`)
  lines.push(
    channelManager
      ? `This listing's content is synced from ${channelManager}: apply the change in ${channelManager}, not in Airbnb, or the next sync overwrites it. Then resolve this adjustment.`
      : "Apply through the co-host seat in Airbnb, then resolve this adjustment."
  )
  return lines.join("\n")
}

export type DecisionResult = { ok: true; item: OptimizationItem } | { ok: false; error: string }

/**
 * Records an owner decision. The caller must pass a viewer resolved from a
 * validated Assembly token; this function re-checks that the item belongs to
 * a published report of that viewer's Hub client.
 *
 * Accepting a `change` or `owner_choice` item queues an adjustment
 * (type listing_content, origin client). Publishing the report is Fede's
 * approval, so no second internal approval is required for content.
 */
export async function recordOwnerDecision(input: {
  viewer: PortalViewer
  itemId: string
  decision: OptimizationDecision
  choice?: string | null
  note?: string | null
}): Promise<DecisionResult> {
  const { viewer } = input
  if (viewer.isInternal || !viewer.assemblyClientId) {
    return { ok: false, error: "Only the property owner can approve suggestions." }
  }

  const supabase = createAdminClient()
  const { data: row, error } = await supabase
    .from("listing_optimization_items")
    .select(
      `${ITEM_COLUMNS}, listing_optimization_reports!inner(id, client_id, status, listing_id, channel_manager)`
    )
    .eq("id", input.itemId)
    .maybeSingle()
  if (error || !row) return { ok: false, error: "We couldn't find that suggestion." }

  const report = (
    row as unknown as {
      listing_optimization_reports: {
        id: string
        client_id: string
        status: string
        listing_id: string | null
        channel_manager: string | null
      }
    }
  ).listing_optimization_reports
  if (report.client_id !== viewer.hubClientId || report.status !== "published") {
    return { ok: false, error: "We couldn't find that suggestion." }
  }

  const item = row as unknown as ItemRow
  const checked = validateDecision({
    item: { ...item, options: Array.isArray(item.options) ? item.options : [] },
    decision: input.decision,
    choice: input.choice,
    note: input.note,
  })
  if (!checked.ok) return checked

  const now = new Date().toISOString()
  let adjustmentId = item.adjustment_id

  // Owner tasks are done by the owner in Airbnb; there is nothing for the team
  // to apply, so no adjustment is queued.
  const ownerTask = item.kind === "owner_task"

  if (input.decision === "accept" && !ownerTask) {
    if (!adjustmentId) {
      const { data: adj, error: adjError } = await supabase
        .from("adjustments")
        .insert({
          scope: report.listing_id ? "single_listing" : "portfolio",
          client_id: viewer.hubClientId,
          listing_id: report.listing_id,
          type: "listing_content",
          origin: "client",
          urgency: item.priority === "high" ? "high" : "medium",
          status: "open",
          requested_by: viewer.displayName,
          origin_message: adjustmentMessage(item, checked.choice, checked.note, report.channel_manager),
        })
        .select("id")
        .single()
      if (adjError || !adj) {
        console.error("listing optimization: adjustment insert failed", adjError)
        return { ok: false, error: "We couldn't save that. Please try again." }
      }
      adjustmentId = adj.id
    } else {
      // Re-accepting (e.g. a different title option) refreshes the ticket text
      // and reopens it if it had been rejected.
      await supabase
        .from("adjustments")
        .update({
          origin_message: adjustmentMessage(item, checked.choice, checked.note, report.channel_manager),
          status: "open",
          updated_at: now,
        })
        .eq("id", adjustmentId)
        .in("status", ["open", "rejected"])
    }
  } else if (adjustmentId) {
    // Declining or undoing withdraws a ticket the team hasn't started.
    await supabase
      .from("adjustments")
      .update({ status: "rejected", updated_at: now })
      .eq("id", adjustmentId)
      .eq("status", "open")
  }

  const update =
    input.decision === "reset"
      ? {
          client_status: "pending",
          client_choice: null,
          client_note: checked.note,
          decided_at: null,
          decided_by: null,
          apply_status: "not_started",
          updated_at: now,
        }
      : {
          client_status: input.decision === "accept" ? "accepted" : "declined",
          client_choice: checked.choice,
          client_note: checked.note,
          decided_at: now,
          decided_by: viewer.assemblyClientId,
          apply_status:
            input.decision === "accept" ? (ownerTask ? "applied" : "queued") : "not_started",
          adjustment_id: adjustmentId,
          updated_at: now,
        }

  const { data: saved, error: saveError } = await supabase
    .from("listing_optimization_items")
    .update(update)
    .eq("id", item.id)
    .select(ITEM_COLUMNS)
    .single()
  if (saveError || !saved) {
    console.error("listing optimization: decision save failed", saveError)
    return { ok: false, error: "We couldn't save that. Please try again." }
  }
  await logEvent({
    reportId: report.id,
    itemId: item.id,
    action: item.kind === "owner_task" && input.decision === "accept" ? "MarkOwnerTaskDone" : "DecideSuggestion",
    actorType: "owner",
    actorId: viewer.assemblyClientId,
    details: { decision: input.decision, choice: checked.choice, note: checked.note, adjustment_id: adjustmentId },
  })
  return { ok: true, item: toItem(saved as ItemRow) }
}

/**
 * Inserts a draft report and its items. Verifies the listing (if any) belongs
 * to the client. Never publishes. Uses the admin client: callers must have
 * authenticated the actor (API key scope or Hub permission) first.
 */
export async function createDraftReport(
  input: import("@/lib/listing-optimization-input").DraftReportInput,
  createdBy: string | null = null
): Promise<{ ok: true; reportId: string } | { ok: false; status: number; error: string }> {
  const supabase = createAdminClient()

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", input.client_id)
    .maybeSingle()
  if (!client) return { ok: false, status: 404, error: "Client not found" }

  if (input.listing_id) {
    const { data: listing } = await supabase
      .from("listings")
      .select("id, client_id")
      .eq("id", input.listing_id)
      .maybeSingle()
    if (!listing || listing.client_id !== input.client_id) {
      return { ok: false, status: 422, error: "Listing does not belong to this client" }
    }
  }

  // Numbers come from the checklist, never from the submitter.
  const scored = input.checks.length > 0 ? scoreChecks(input.checks) : null
  const { data: report, error } = await supabase
    .from("listing_optimization_reports")
    .insert({
      client_id: input.client_id,
      listing_id: input.listing_id,
      ...input.report,
      ...(scored
        ? {
            overall_score: scored.overall,
            score_breakdown: scored.breakdown,
            section_grades: gradeSections(input.checks),
          }
        : {}),
      checks: input.checks,
      checklist_version: CHECKLIST_VERSION,
      status: "draft",
      source: input.source,
      created_by: createdBy,
    })
    .select("id")
    .single()
  if (error || !report) {
    console.error("listing optimization: report insert failed", error)
    return { ok: false, status: 500, error: "Could not create report" }
  }

  const { error: itemsError } = await supabase.from("listing_optimization_items").insert(
    input.items.map((item) => ({ ...item, report_id: report.id }))
  )
  if (itemsError) {
    console.error("listing optimization: items insert failed", itemsError)
    await supabase.from("listing_optimization_reports").delete().eq("id", report.id)
    return { ok: false, status: 500, error: "Could not create report items" }
  }
  await logEvent({
    reportId: report.id,
    action: "SubmitListingReviewDraft",
    actorType: input.source === "manual" ? "staff" : "agent",
    actorId: createdBy,
    details: { source: input.source, items: input.items.length, checks: input.checks.length },
  })
  return { ok: true, reportId: report.id }
}

export type StaffReportRow = {
  id: string
  client_id: string
  client_name: string | null
  listing_title: string
  status: "draft" | "published" | "archived"
  overall_score: number | null
  source: string
  created_at: string
  published_at: string | null
  counts: { total: number; pending: number; accepted: number; declined: number; live: number }
}

/** Staff list (RLS: listings:view). */
export async function loadStaffReports(): Promise<StaffReportRow[]> {
  const { createClient } = await import("@/lib/supabase/server")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("listing_optimization_reports")
    .select(
      `id, client_id, listing_title, status, overall_score, source, created_at, published_at,
       clients:clients_basic(name),
       listing_optimization_items(kind, client_status, apply_status)`
    )
    .order("created_at", { ascending: false })
  if (error) throw new Error(`Could not load reports: ${error.message}`)
  return (data ?? []).map((r) => {
    const items = ((r as { listing_optimization_items?: { kind: string; client_status: string; apply_status: string }[] })
      .listing_optimization_items ?? []).filter((i) => i.kind !== "info")
    const client = (r as { clients?: { name: string } | { name: string }[] | null }).clients
    const clientName = Array.isArray(client) ? client[0]?.name : client?.name
    return {
      id: r.id,
      client_id: r.client_id,
      client_name: clientName ?? null,
      listing_title: r.listing_title,
      status: r.status,
      overall_score: r.overall_score,
      source: r.source,
      created_at: r.created_at,
      published_at: r.published_at,
      counts: {
        total: items.length,
        pending: items.filter((i) => i.client_status === "pending").length,
        accepted: items.filter((i) => i.client_status === "accepted").length,
        declined: items.filter((i) => i.client_status === "declined").length,
        live: items.filter((i) => i.apply_status === "verified").length,
      },
    }
  })
}

/** One report in the owner-facing shape, for staff preview (RLS: listings:view). */
export async function loadStaffReport(
  id: string
): Promise<{
  report: OptimizationReport
  status: string
  clientName: string | null
  channelManager: string | null
} | null> {
  const { createClient } = await import("@/lib/supabase/server")
  const supabase = await createClient()
  const { data: r } = await supabase
    .from("listing_optimization_reports")
    .select(`${REPORT_COLUMNS}, status, channel_manager, clients:clients_basic(name)`)
    .eq("id", id)
    .maybeSingle()
  if (!r) return null
  const { data: items } = await supabase
    .from("listing_optimization_items")
    .select(ITEM_COLUMNS)
    .eq("report_id", id)
    .order("sort_order", { ascending: true })
  const client = (r as { clients?: { name: string } | { name: string }[] | null }).clients
  return {
    status: r.status,
    channelManager: (r as { channel_manager?: string | null }).channel_manager ?? null,
    clientName: (Array.isArray(client) ? client[0]?.name : client?.name) ?? null,
    report: {
      id: r.id,
      listing_title: r.listing_title,
      listing_url: r.listing_url,
      cover_photo_url: r.cover_photo_url,
      overall_score: r.overall_score,
      score_breakdown: r.score_breakdown ?? {},
      section_grades: r.section_grades ?? {},
      owner_line: r.owner_line,
      summary: r.summary,
      published_at: r.published_at,
      checks: Array.isArray(r.checks) ? (r.checks as CheckResult[]) : [],
      items: ((items ?? []) as ItemRow[]).map(toItem),
    },
  }
}
