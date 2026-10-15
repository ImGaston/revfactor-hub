import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  sectionLabel,
  validateDecision,
  type OptimizationDecision,
  type OptimizationItem,
  type OptimizationReport,
  type OwnerReviewRow,
} from "@/lib/listing-optimization"
import type { PortalViewer } from "@/lib/assembly-portal-session.server"
import { buildOwnerMessage } from "@/lib/listing-optimization-message"
import {
  addAssemblyTagOption,
  findAssemblyInternalUserIdByEmail,
  getCompanyChannels,
  getOrCreateMessageChannel,
  sendAssemblyMessage,
} from "@/lib/assembly"
import {
  CHECKLIST_VERSION,
  checkCoverage,
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
  | "NotifyOwnerOfReview"
  | "GrantListingReviewApp"

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
    .select("id, name")
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
      owner_message: buildOwnerMessage({
        ownerName: client.name,
        items: input.items,
        channelManager: input.report.channel_manager,
      }),
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

type OwnerTarget = { type: "client" | "company"; id: string }

/**
 * The client's Assembly chat: the company channel when the client belongs to
 * one, else their individual channel. `target` is who that chat reaches.
 */
async function resolveOwnerChannel(
  clientId: string
): Promise<
  | { ok: true; channelId: string; target: OwnerTarget; clientName: string | null }
  | { ok: false; error: string }
> {
  const { data: client } = await createAdminClient()
    .from("clients")
    .select("name, assembly_client_id, assembly_company_id")
    .eq("id", clientId)
    .maybeSingle()
  if (!client?.assembly_client_id) {
    return { ok: false, error: "This client isn't linked to Assembly yet." }
  }
  try {
    const company = client.assembly_company_id
      ? (await getCompanyChannels(client.assembly_client_id)).find(
          (c) => c.companyId === client.assembly_company_id
        )
      : undefined
    const channelId = company?.id ?? (await getOrCreateMessageChannel(client.assembly_client_id)).id
    const target: OwnerTarget = company
      ? { type: "company", id: client.assembly_company_id as string }
      : { type: "client", id: client.assembly_client_id }
    return { ok: true, channelId, target, clientName: (client.name as string | null) ?? null }
  } catch (error) {
    console.error("listing optimization: assembly channel lookup failed", error)
    return { ok: false, error: "Couldn't find the client's Assembly chat." }
  }
}

/**
 * Gives the message's recipient access to the Listing Review custom app by
 * adding a tag in Assembly: the app's visibility rule is "client or company
 * tags include Listing Review", and the fixed client list can't be edited
 * through the API. Tags the same target the message goes to. Skipped (ok)
 * until ASSEMBLY_LISTING_REVIEW_TAG_FIELD and _TAG_OPTION are set, so the
 * Assembly field can be created after this ships.
 */
async function grantListingReviewApp(input: {
  reportIds: string[]
  target: OwnerTarget
  clientName: string | null
  actorUserId: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientField = process.env.ASSEMBLY_LISTING_REVIEW_TAG_FIELD?.trim()
  const option = process.env.ASSEMBLY_LISTING_REVIEW_TAG_OPTION?.trim()
  if (!clientField || !option) return { ok: true }
  const fieldKey =
    input.target.type === "company"
      ? process.env.ASSEMBLY_LISTING_REVIEW_COMPANY_TAG_FIELD?.trim() || clientField
      : clientField

  let granted: Awaited<ReturnType<typeof addAssemblyTagOption>>
  try {
    granted = await addAssemblyTagOption({
      entityType: input.target.type,
      entityId: input.target.id,
      fieldKey,
      option,
    })
  } catch (error) {
    console.error("listing optimization: listing review app grant failed", input.target, error)
    const firstName = input.clientName?.trim().split(/\s+/)[0] || "the owner"
    return {
      ok: false,
      error: `Couldn't give ${firstName} access to the Listing Review app in Assembly. The message wasn't sent.`,
    }
  }

  await Promise.all(
    input.reportIds.map((reportId) =>
      logEvent({
        reportId,
        action: "GrantListingReviewApp",
        actorType: "staff",
        actorId: input.actorUserId,
        details: {
          target_type: input.target.type,
          target_id: input.target.id,
          field_key: granted.fieldKey,
          option_id: granted.optionId,
          option_key: granted.optionKey,
          already_tagged: granted.alreadyTagged,
        },
      })
    )
  )
  return { ok: true }
}

/**
 * Sends ONE message for several published reviews of the same owner
 * (owner-level "Publish & send all"). Every review in the bundle is stamped
 * with the same send time, Assembly message id and text, so none of them can
 * be sent again, and each gets a NotifyOwnerOfReview event naming the bundle.
 * The owner is first given the Listing Review app (grantListingReviewApp); if
 * that fails nothing is sent. Callers must have checked the staff user's permission.
 */
/**
 * Assembly sender for a staff-triggered message: the clicking user's own
 * Assembly team account (matched by email), so the owner sees who sent it.
 * Falls back to the API key's owner when there's no match.
 */
async function senderIdForStaff(actorUserId: string | null): Promise<string | undefined> {
  if (!actorUserId) return undefined
  try {
    const supabase = createAdminClient()
    const { data } = await supabase.from("profiles").select("email").eq("id", actorUserId).maybeSingle()
    return (await findAssemblyInternalUserIdByEmail(data?.email as string | undefined)) ?? undefined
  } catch (error) {
    console.error("listing optimization: assembly sender lookup failed", error)
    return undefined
  }
}

export async function sendOwnerBundleMessage(input: {
  clientId: string
  reportIds: string[]
  text: string
  actorUserId: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = input.text.trim()
  if (!text) return { ok: false, error: "The message is empty." }
  const ids = [...new Set(input.reportIds)]
  if (ids.length === 0) return { ok: false, error: "Pick at least one review." }

  const supabase = createAdminClient()
  const { data: reports, error } = await supabase
    .from("listing_optimization_reports")
    .select("id, client_id, status, owner_message_sent_at")
    .in("id", ids)
  if (error) return { ok: false, error: "Couldn't load the reviews." }
  if (!reports || reports.length !== ids.length) return { ok: false, error: "Some reviews weren't found." }
  if (reports.some((r) => r.client_id !== input.clientId)) {
    return { ok: false, error: "All reviews must belong to the same owner." }
  }
  if (reports.some((r) => r.status !== "published")) {
    return { ok: false, error: "Publish every review before sending the message." }
  }
  if (reports.some((r) => r.owner_message_sent_at)) {
    return { ok: false, error: "A message was already sent for one of these reviews." }
  }

  const channel = await resolveOwnerChannel(input.clientId)
  if (!channel.ok) return channel
  const grant = await grantListingReviewApp({
    reportIds: ids,
    target: channel.target,
    clientName: channel.clientName,
    actorUserId: input.actorUserId,
  })
  if (!grant.ok) return grant

  let messageId: string | null = null
  try {
    const sent = await sendAssemblyMessage(channel.channelId, text, await senderIdForStaff(input.actorUserId))
    messageId = sent?.id ?? null
  } catch (sendError) {
    console.error("listing optimization: assembly bundle send failed", sendError)
    return { ok: false, error: "Assembly didn't accept the message. Try again." }
  }

  const { error: stampError } = await supabase
    .from("listing_optimization_reports")
    .update({
      owner_message: text,
      owner_message_sent_at: new Date().toISOString(),
      owner_message_sent_by: input.actorUserId,
      owner_message_assembly_id: messageId,
    })
    .in("id", ids)
    .is("owner_message_sent_at", null)
  if (stampError) console.error("listing optimization: bundle stamp failed", stampError)
  await Promise.all(
    ids.map((reportId) =>
      logEvent({
        reportId,
        action: "NotifyOwnerOfReview",
        actorType: "staff",
        actorId: input.actorUserId,
        details: { channel_id: channel.channelId, assembly_message_id: messageId, bundle: ids },
      })
    )
  )
  return { ok: true }
}


/**
 * One owner's reviews that can still go out with the owner message: drafts
 * and published reviews whose message hasn't been sent (RLS: listings:view).
 */
export async function loadOwnerReviews(clientId: string): Promise<{
  clientName: string | null
  pending: OwnerReviewRow[]
  sentCount: number
} | null> {
  const { createClient } = await import("@/lib/supabase/server")
  const supabase = await createClient()
  const [{ data: client }, { data: rows, error }] = await Promise.all([
    supabase.from("clients_basic").select("name").eq("id", clientId).maybeSingle(),
    supabase
      .from("listing_optimization_reports")
      .select(
        `id, listing_title, status, overall_score, channel_manager, checks, owner_message_sent_at, created_at,
         listings(name),
         listing_optimization_items(section, kind, priority, sort_order, headline, check_id)`
      )
      .eq("client_id", clientId)
      .in("status", ["draft", "published"])
      .order("created_at", { ascending: true }),
  ])
  if (error) throw new Error(`Could not load reviews: ${error.message}`)
  if (!client && (!rows || rows.length === 0)) return null
  const all = rows ?? []
  const pending = all
    .filter((r) => !r.owner_message_sent_at)
    .map((r) => {
      const listing = (r as { listings?: { name: string } | { name: string }[] | null }).listings
      const listingName = (Array.isArray(listing) ? listing[0]?.name : listing?.name) ?? r.listing_title
      const coverage = checkCoverage(Array.isArray(r.checks) ? (r.checks as CheckResult[]) : [])
      return {
        id: r.id,
        listingName,
        listingTitle: r.listing_title,
        status: r.status as "draft" | "published",
        overallScore: r.overall_score,
        channelManager: r.channel_manager ?? null,
        coverage: { checked: coverage.checked, total: coverage.total, complete: coverage.complete },
        items: ((r as { listing_optimization_items?: OwnerReviewRow["items"] }).listing_optimization_items ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order),
      }
    })
  return { clientName: client?.name ?? null, pending, sentCount: all.length - pending.length }
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
  owner_message_sent_at: string | null
  counts: { total: number; pending: number; accepted: number; declined: number; live: number; applied: number; toApply: number }
}

/** Staff list (RLS: listings:view). */
export async function loadStaffReports(): Promise<StaffReportRow[]> {
  const { createClient } = await import("@/lib/supabase/server")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("listing_optimization_reports")
    .select(
      `id, client_id, listing_title, status, overall_score, source, created_at, published_at, owner_message_sent_at,
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
      owner_message_sent_at: r.owner_message_sent_at ?? null,
      counts: {
        total: items.length,
        pending: items.filter((i) => i.client_status === "pending").length,
        accepted: items.filter((i) => i.client_status === "accepted").length,
        declined: items.filter((i) => i.client_status === "declined").length,
        live: items.filter((i) => i.apply_status === "verified").length,
        applied: items.filter((i) => i.client_status === "accepted" && (i.apply_status === "applied" || i.apply_status === "verified")).length,
        // Accepted work still on us: not applied, verified or skipped yet.
        toApply: items.filter((i) => i.client_status === "accepted" && !["applied", "verified", "skipped"].includes(i.apply_status)).length,
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
  clientId: string
  clientName: string | null
  channelManager: string | null
  ownerMessage: string | null
  ownerMessageSentAt: string | null
} | null> {
  const { createClient } = await import("@/lib/supabase/server")
  const supabase = await createClient()
  const { data: r } = await supabase
    .from("listing_optimization_reports")
    .select(
      `${REPORT_COLUMNS}, client_id, status, channel_manager, owner_message, owner_message_sent_at, clients:clients_basic(name)`
    )
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
    clientId: (r as { client_id: string }).client_id,
    channelManager: (r as { channel_manager?: string | null }).channel_manager ?? null,
    ownerMessage: (r as { owner_message?: string | null }).owner_message ?? null,
    ownerMessageSentAt: (r as { owner_message_sent_at?: string | null }).owner_message_sent_at ?? null,
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

/**
 * Sends a published review's owner message to the client's Assembly chat
 * (the company channel when the client belongs to one, else their individual
 * channel), after giving that recipient the Listing Review app
 * (grantListingReviewApp; nothing is sent if that fails). Callers must have
 * checked the staff user's permission. Sends at most once per review; logs
 * NotifyOwnerOfReview.
 */
export async function sendReviewOwnerMessage(input: {
  reportId: string
  actorUserId: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminClient()
  const { data: report } = await supabase
    .from("listing_optimization_reports")
    .select("id, client_id, status, owner_message, owner_message_sent_at")
    .eq("id", input.reportId)
    .maybeSingle()
  if (!report) return { ok: false, error: "Review not found." }
  if (report.status !== "published") return { ok: false, error: "Publish the review before sending the message." }
  if (report.owner_message_sent_at) return { ok: false, error: "The message was already sent." }
  const text = report.owner_message?.trim()
  if (!text) return { ok: false, error: "The message is empty." }

  const channel = await resolveOwnerChannel(report.client_id)
  if (!channel.ok) return channel
  const grant = await grantListingReviewApp({
    reportIds: [report.id],
    target: channel.target,
    clientName: channel.clientName,
    actorUserId: input.actorUserId,
  })
  if (!grant.ok) return grant
  const channelId = channel.channelId

  let messageId: string | null = null
  try {
    const sent = await sendAssemblyMessage(channelId, text, await senderIdForStaff(input.actorUserId))
    messageId = sent?.id ?? null
  } catch (error) {
    console.error("listing optimization: assembly send failed", error)
    return { ok: false, error: "Assembly didn't accept the message. Try again." }
  }

  await supabase
    .from("listing_optimization_reports")
    .update({
      owner_message_sent_at: new Date().toISOString(),
      owner_message_sent_by: input.actorUserId,
      owner_message_assembly_id: messageId,
    })
    .eq("id", report.id)
  await logEvent({
    reportId: report.id,
    action: "NotifyOwnerOfReview",
    actorType: "staff",
    actorId: input.actorUserId,
    details: { channel_id: channelId, assembly_message_id: messageId },
  })
  return { ok: true }
}

const DECISION_SESSION_MINUTES = 30

/**
 * Tell the team in Slack when an owner starts accepting suggestions, so the
 * work (already queued as listing_content adjustments) gets picked up. One
 * message per decision session: skipped when the same review had another
 * decision in the last 30 minutes. Needs SLACK_LISTING_REVIEWS_CHANNEL_ID;
 * without it (or without a Slack token) this is a silent skip.
 */
export async function notifyTeamOfOwnerDecision(itemId: string): Promise<void> {
  const channelId = process.env.SLACK_LISTING_REVIEWS_CHANNEL_ID?.trim()
  if (!channelId) return
  try {
    const supabase = createAdminClient()
    const { data: item } = await supabase
      .from("listing_optimization_items")
      .select("report_id, listing_optimization_reports!inner(id, listing_title, client_id, clients:clients_basic(name))")
      .eq("id", itemId)
      .maybeSingle()
    if (!item) return
    const report = (item as unknown as {
      listing_optimization_reports: { id: string; listing_title: string; clients: { name: string } | { name: string }[] | null }
    }).listing_optimization_reports
    const since = new Date(Date.now() - DECISION_SESSION_MINUTES * 60_000).toISOString()
    const { count } = await supabase
      .from("listing_optimization_events")
      .select("id", { count: "exact", head: true })
      .eq("report_id", report.id)
      .in("action", ["DecideSuggestion", "MarkOwnerTaskDone"])
      .gte("created_at", since)
    // The decision that triggered this call is already logged; anything more means an ongoing session.
    if ((count ?? 0) > 1) return
    const { count: accepted } = await supabase
      .from("listing_optimization_items")
      .select("id", { count: "exact", head: true })
      .eq("report_id", report.id)
      .eq("client_status", "accepted")
    const client = Array.isArray(report.clients) ? report.clients[0]?.name : report.clients?.name
    const { postSlackMessage } = await import("@/lib/slack")
    await postSlackMessage({
      channelId,
      text: `${client ?? "An owner"} is accepting listing changes on "${report.listing_title}" (${accepted ?? 0} accepted so far). They're queued in Adjustments as Listing content: https://hub.revfactor.io/listing-optimization/${report.id}`,
    })
  } catch (error) {
    console.error("listing optimization: decision notification failed", error)
  }
}

