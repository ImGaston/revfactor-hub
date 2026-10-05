import "server-only"

// Support answers — I/O for the blind-first answer flow on /support/[id]:
//   1. the team saves its own answer (the suggested answer stays on the
//      server until then),
//   2. the first save unlocks the suggestion; Jev checks the team answer and
//      compares it with the suggestion,
//   3. the team consolidates and saves the final answer to send in Assembly.
// The Hub's suggested answer is still drafted in the background (capture
// `after()`, backfill, the Prepare/Regenerate button).
//
// Every function takes the Supabase client to use:
//   * the signed-in session client from the ticket page's Server Actions
//     (RLS applies: support:view / support:edit), or
//   * the service-role admin client from the capture API's `after()` hook and
//     the CRON_SECRET backfill route. RLS does not apply there, so the
//     explicit column projections below are the security boundary: no client
//     billing fields, no profiles beyond names, never select("*").
// THE LOCK: suggestion text (support_tickets.suggested_reply, a ledger body,
// a comparison snapshot) is read only after `hasSavedTeamAnswer`, and only
// loadSupportAnswerPanel decides what reaches the page.
// Nothing here sends anything to a client.

import type { SupabaseClient } from "@supabase/supabase-js"
import { isStepCount, Output, ToolLoopAgent } from "ai"

import { adjustmentStatusLabel, adjustmentTypeLabel } from "@/lib/adjustments"
import { isAiGatewayConfigured } from "@/lib/ai-gateway.server"
import { JEV_GATEWAY_MODEL } from "@/lib/jev"
import { isJevConfigured, jevDecide, scrubSecrets } from "@/lib/jev.server"
import { createKnowledgeSearch } from "@/lib/knowledge-retrieval.server"
import {
  SUPPORT_ANSWER_CHECK_VERSION,
  SUPPORT_ANSWER_MODEL_ID,
  SUPPORT_ANSWER_PORTFOLIO_LISTING_LIMIT,
  SUPPORT_ANSWER_TIMELINE_LIMIT,
  SUPPORT_ANSWER_VERDICT_LABEL,
  SUPPORT_ADDS_INSTRUCTIONS,
  SUPPORT_COMPARISON_VERSION,
  SUPPORT_DRAFT_INSTRUCTIONS,
  SUPPORT_HUB_DRAFT_PROMPT_VERSION,
  SUPPORT_MERGE_INSTRUCTIONS,
  SUPPORT_USED_SUGGESTION_LABEL,
  answerCheckQuestions,
  buildAddsPrompt,
  buildComparisonJevState,
  buildDraftPrompt,
  buildDraftSources,
  buildHubSuggestedReply,
  buildJevState,
  buildMergePrompt,
  comparisonQuestions,
  draftConfidenceQuestions,
  hasSavedTeamAnswer,
  hubDraftBlockReason,
  hubDraftViolations,
  interpretAnswerCheck,
  interpretComparison,
  interpretDraftConfidence,
  knowledgePassagesFromSources,
  linkedChangeControlled,
  listingFactName,
  markCitedSources,
  mergeViolations,
  parseAnswerCheckResults,
  parseComparisonResults,
  parseDraftConfidence,
  parseStoredSources,
  parseSuggestionAdds,
  parseSuggestionSnapshot,
  prepareSupportAnswer,
  suggestionAdoption,
  suggestionLockStatus,
  supportAddsOutputSchema,
  supportAnswerKnowledgeQuery,
  supportDraftOutputSchema,
  supportMergeOutputSchema,
  usedSuggestionBucket,
  validateSuggestionAdds,
  type SuggestionLockStatus,
  type SupportAnswerCheckResult,
  type SupportAnswerCheckTarget,
  type SupportAnswerContext,
  type SupportAnswerListingFact,
  type SupportAnswerSource,
  type SupportAnswerVerdict,
  type SupportComparisonResult,
  type SupportComparisonVerdict,
  type SupportDraftConfidence,
  type SupportFinalSource,
  type SupportSuggestionAdd,
  type SupportSuggestionSnapshot,
  type SupportUsedSuggestion,
} from "@/lib/support-answers"
import { ticketPropertyLabel } from "@/lib/support-display"
import {
  SUPPORT_ACTIVE_STATUSES,
  SUPPORT_CLOSED_STATUSES,
  maskContactDetails,
  suggestedReplyFreshness,
  suggestedReplySource,
  unfilledPlaceholders,
  type DraftFreshness,
  type SupportCategory,
  type SupportDraftSource,
  type SupportPropertyScope,
  type SupportRequestType,
  type SupportStatus,
  type SupportSuggestedReply,
} from "@/lib/support-tickets"

export { isAiGatewayConfigured }

const DRAFT_TIMEOUT_MS = 30_000
const PENDING_STALE_MS = 10 * 60_000
const AUTO_CONCURRENCY = 2
const SYSTEM_USER = "system:support-answers"
const MIGRATION_PENDING = "Support answer tables are missing (migration 20261004120000 is not applied yet)."
const LOCKED = "Save your own answer first."

// ---------------------------------------------------------------------------
// Configuration (never throws; pages show "not configured")
// ---------------------------------------------------------------------------

export function supportAnswerRuntimeStatus() {
  return {
    drafts: isAiGatewayConfigured(),
    check: isJevConfigured(),
    draftModel: SUPPORT_ANSWER_MODEL_ID,
    jevModel: JEV_GATEWAY_MODEL,
  }
}

type PgError = { code?: string; message?: string } | null

/** The migration isn't applied yet: degrade instead of breaking the ticket page. */
export function isMissingRelation(error: PgError): boolean {
  if (!error) return false
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /does not exist|could not find the table/i.test(error.message ?? "")
  )
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"
  return scrubSecrets(message).slice(0, 1000)
}

function gatewayTags(feature: string) {
  return [`feature:${feature}`, `environment:${process.env.VERCEL_ENV ?? "development"}`]
}

// ---------------------------------------------------------------------------
// Context: the ask, ticket facts, Hub listing facts, and approved knowledge
// ---------------------------------------------------------------------------

const LISTING_FACT_COLUMNS = `
  id, name, city, state, status, pl_base_price, pl_min_price, pl_max_price, pl_recommended_base_price,
  pl_occupancy_next_7, pl_market_occupancy_next_7, pl_occupancy_next_30, pl_market_occupancy_next_30,
  pl_wknd_occupancy_next_30, pl_market_wknd_occupancy_next_30, pl_mpi_next_30, pl_last_booked_date, pl_synced_at
`

// Explicit projection (the boundary on the admin path). No client row at all:
// the draft needs the requester's first name, never billing or contact data.
const CONTEXT_TICKET_COLUMNS = `
  id, ticket_number, client_id, category, request_type, status, merged_into, summary, client_message,
  time_window, property_scope, money_at_stake, requested_by_name, requested_at,
  suggested_reply_generated_at:suggested_reply->>generated_at,
  support_ticket_listings(listing_id, listings(${LISTING_FACT_COLUMNS})),
  support_ticket_commitments(description, due_at, rescheduled_to, status),
  adjustments!adjustments_support_ticket_id_fkey(type, status, target_value, controlled_at, listings(name))
`

type ListingFactRow = {
  id: string
  name: string
  city: string | null
  state: string | null
  status: string | null
  pl_base_price: number | null
  pl_min_price: number | null
  pl_max_price: number | null
  pl_recommended_base_price: number | null
  pl_occupancy_next_7: number | null
  pl_market_occupancy_next_7: number | null
  pl_occupancy_next_30: number | null
  pl_market_occupancy_next_30: number | null
  pl_wknd_occupancy_next_30: number | null
  pl_market_wknd_occupancy_next_30: number | null
  pl_mpi_next_30: number | null
  pl_last_booked_date: string | null
  pl_synced_at: string | null
}

type ContextTicketRow = {
  id: string
  ticket_number: number
  client_id: string
  category: SupportCategory
  request_type: SupportRequestType
  status: SupportStatus
  merged_into: string | null
  summary: string
  client_message: string | null
  time_window: string | null
  property_scope: SupportPropertyScope
  money_at_stake: boolean
  requested_by_name: string | null
  requested_at: string
  suggested_reply_generated_at: string | null
  support_ticket_listings: { listing_id: string; listings: ListingFactRow | null }[] | null
  support_ticket_commitments: { description: string; due_at: string; rescheduled_to: string | null; status: string }[] | null
  adjustments:
    | {
        type: string
        status: string
        target_value: string | null
        controlled_at: string | null
        listings: { name: string } | { name: string }[] | null
      }[]
    | null
}

function toListingFact(row: ListingFactRow): SupportAnswerListingFact {
  return {
    id: row.id,
    name: listingFactName(row.name),
    city: row.city,
    state: row.state,
    status: row.status,
    base_price: row.pl_base_price,
    min_price: row.pl_min_price,
    max_price: row.pl_max_price,
    recommended_base_price: row.pl_recommended_base_price,
    occupancy_next_7: row.pl_occupancy_next_7,
    market_occupancy_next_7: row.pl_market_occupancy_next_7,
    occupancy_next_30: row.pl_occupancy_next_30,
    market_occupancy_next_30: row.pl_market_occupancy_next_30,
    weekend_occupancy_next_30: row.pl_wknd_occupancy_next_30,
    market_weekend_occupancy_next_30: row.pl_market_wknd_occupancy_next_30,
    mpi_next_30: row.pl_mpi_next_30,
    last_booked_date: row.pl_last_booked_date,
    synced_at: row.pl_synced_at,
  }
}

async function loadKnowledge(
  supabase: SupabaseClient,
  query: string,
  userLabel: string
): Promise<{ passages: SupportAnswerContext["knowledge"]; note: string | null }> {
  if (!query.trim()) return { passages: [], note: null }
  try {
    // The four agent gates, same as Agent Studio; hybrid retrieval applies them again
    const { data: articles, error } = await supabase
      .from("knowledge_articles")
      .select(
        "id, title, slug, excerpt, content_html, canonical_question, approved_answer, escalation_guidance, updated_at"
      )
      .eq("status", "published")
      .eq("agent_enabled", true)
      .eq("review_status", "approved")
      .eq("audience", "client_safe")
      .order("updated_at", { ascending: false })
      .limit(200)
    if (error) return { passages: [], note: "The knowledge base could not be read." }
    const search = createKnowledgeSearch({
      supabase,
      articles: articles ?? [],
      userId: userLabel,
      mode: isAiGatewayConfigured() ? "hybrid" : "keyword",
    })
    const output = await search(query)
    return { passages: knowledgePassagesFromSources(output.results), note: output.diagnostics.fallbackReason }
  } catch (error) {
    console.error("[support-answers] knowledge retrieval failed:", errorText(error))
    return { passages: [], note: "Knowledge retrieval failed." }
  }
}

/** Everything a draft, check, comparison, or merge reads for one ticket; null when not visible. */
export async function loadSupportAnswerContext(
  supabase: SupabaseClient,
  ticketId: string,
  userLabel: string
): Promise<(SupportAnswerContext & { hasDraft: boolean }) | null> {
  const { data, error } = await supabase
    .from("support_tickets")
    .select(CONTEXT_TICKET_COLUMNS)
    .eq("id", ticketId)
    .maybeSingle()
  if (error) throw new Error(`support answer context failed: ${error.message}`)
  if (!data) return null
  const t = data as unknown as ContextTicketRow

  const knowledgeQuery = supportAnswerKnowledgeQuery(t)
  const [events, portfolio, knowledge] = await Promise.all([
    supabase
      .from("support_ticket_events")
      .select("event_type, body, occurred_at")
      .eq("ticket_id", t.id)
      .order("occurred_at", { ascending: false })
      .limit(SUPPORT_ANSWER_TIMELINE_LIMIT),
    t.property_scope === "portfolio"
      ? supabase
          .from("listings")
          .select(LISTING_FACT_COLUMNS)
          .eq("client_id", t.client_id)
          .eq("status", "active")
          .order("name")
          .limit(SUPPORT_ANSWER_PORTFOLIO_LISTING_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    loadKnowledge(supabase, knowledgeQuery, userLabel),
  ])
  if (events.error) throw new Error(`support answer timeline failed: ${events.error.message}`)
  if (portfolio.error) throw new Error(`support answer listings failed: ${portfolio.error.message}`)

  const ticketListings = (t.support_ticket_listings ?? []).flatMap((l) => (l.listings ? [l.listings] : []))
  const listingRows =
    t.property_scope === "portfolio" ? ((portfolio.data ?? []) as unknown as ListingFactRow[]) : ticketListings
  const adjustments = (t.adjustments ?? []).map((a) => {
    const listing = Array.isArray(a.listings) ? a.listings[0] : a.listings
    return {
      type: adjustmentTypeLabel(a.type),
      status: adjustmentStatusLabel(a.status),
      target_value: a.target_value,
      controlled_at: a.controlled_at,
      listing_name: listing?.name ? listingFactName(listing.name) : null,
    }
  })

  return {
    ticket: {
      id: t.id,
      ticket_number: t.ticket_number,
      category: t.category,
      request_type: t.request_type,
      status: t.status,
      merged_into: t.merged_into,
      summary: t.summary,
      client_message: t.client_message,
      time_window: t.time_window,
      money_at_stake: t.money_at_stake,
      requested_by_name: t.requested_by_name,
      requested_at: t.requested_at,
      property_label: ticketPropertyLabel({
        property_scope: t.property_scope,
        support_ticket_listings: (t.support_ticket_listings ?? []).map((l) => ({
          listing_id: l.listing_id,
          listings: l.listings ? { id: l.listings.id, name: l.listings.name } : null,
        })),
      }),
    },
    listings: listingRows.map(toListingFact),
    adjustments,
    promises: (t.support_ticket_commitments ?? [])
      .filter((c) => c.status === "open")
      .map((c) => ({ description: c.description, due_at: c.rescheduled_to ?? c.due_at, status: c.status })),
    timeline: ((events.data ?? []) as { event_type: string; body: string | null; occurred_at: string }[])
      .reverse()
      .map((e) => ({ type: e.event_type, occurred_at: e.occurred_at, body: e.body })),
    knowledge: knowledge.passages,
    knowledgeNote: knowledge.note,
    changeControlled: linkedChangeControlled(t.adjustments ?? []),
    hasDraft: !!t.suggested_reply_generated_at,
  }
}

// ---------------------------------------------------------------------------
// AI Gateway agents (drafting, "what the suggestion adds", merging)
// ---------------------------------------------------------------------------

function createSupportAnswerAgent(userLabel: string) {
  return new ToolLoopAgent({
    id: "revfactor-support-answer",
    model: SUPPORT_ANSWER_MODEL_ID,
    reasoning: "none",
    instructions: SUPPORT_DRAFT_INSTRUCTIONS,
    providerOptions: { gateway: { user: userLabel, tags: gatewayTags("support-answer") } },
    output: Output.object({ schema: supportDraftOutputSchema }),
    stopWhen: isStepCount(1),
    maxOutputTokens: 900,
  })
}

function createAddsAgent(userLabel: string) {
  return new ToolLoopAgent({
    id: "revfactor-support-suggestion-adds",
    model: SUPPORT_ANSWER_MODEL_ID,
    reasoning: "none",
    instructions: SUPPORT_ADDS_INSTRUCTIONS,
    providerOptions: { gateway: { user: userLabel, tags: gatewayTags("support-suggestion-adds") } },
    output: Output.object({ schema: supportAddsOutputSchema }),
    stopWhen: isStepCount(1),
    maxOutputTokens: 600,
  })
}

function createMergeAgent(userLabel: string) {
  return new ToolLoopAgent({
    id: "revfactor-support-answer-merge",
    model: SUPPORT_ANSWER_MODEL_ID,
    reasoning: "none",
    instructions: SUPPORT_MERGE_INSTRUCTIONS,
    providerOptions: { gateway: { user: userLabel, tags: gatewayTags("support-answer-merge") } },
    output: Output.object({ schema: supportMergeOutputSchema }),
    stopWhen: isStepCount(1),
    maxOutputTokens: 1000,
  })
}

type WrittenDraft = {
  text: string
  sources: SupportAnswerSource[]
  inputTokens: number
  outputTokens: number
}

/** One draft plus one repair attempt; a draft that still breaks a rule is not stored. */
async function writeDraft(context: SupportAnswerContext, userLabel: string): Promise<WrittenDraft> {
  const sources = buildDraftSources(context)
  const validIds = new Set(sources.map((s) => s.id))
  let violations: string[] = []
  let inputTokens = 0
  let outputTokens = 0

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await createSupportAnswerAgent(userLabel).generate({
      prompt: buildDraftPrompt(context, sources, violations),
      timeout: { totalMs: DRAFT_TIMEOUT_MS, stepMs: DRAFT_TIMEOUT_MS },
    })
    inputTokens += result.usage.inputTokens ?? 0
    outputTokens += result.usage.outputTokens ?? 0
    const text = result.output.reply.trim()
    violations = hubDraftViolations(text, context)
    if (violations.length === 0) {
      const cited = result.output.used_source_ids.filter((id) => validIds.has(id))
      return { text, sources: markCitedSources(sources, cited), inputTokens, outputTokens }
    }
  }
  throw new Error(`The draft broke the house rules: ${violations.join("; ")}`)
}

async function scoreDraft(
  context: SupportAnswerContext,
  text: string
): Promise<{ confidence: SupportDraftConfidence; raw: Record<string, unknown> | null }> {
  if (!isJevConfigured()) return { confidence: { status: "not_configured" }, raw: null }
  const hasKnowledge = context.knowledge.length > 0
  const decided = await jevDecide(buildJevState(context, text), draftConfidenceQuestions(hasKnowledge))
  if (!decided.ok) {
    if (decided.reason === "not_configured") return { confidence: { status: "not_configured" }, raw: null }
    console.error("[support-answers] draft confidence failed:", decided.error)
    return { confidence: { status: "failed", error: decided.error }, raw: null }
  }
  return {
    confidence: {
      ...interpretDraftConfidence(decided.answers, {
        changeControlled: context.changeControlled,
        hasKnowledge,
        model: decided.model,
      }),
      model_version: decided.modelVersion,
      transport: decided.transport,
    },
    raw: decided.raw,
  }
}

// ---------------------------------------------------------------------------
// Generating and storing a Hub draft (background; unchanged by the lock)
// ---------------------------------------------------------------------------

export type SupportDraftOrigin = "auto" | "backfill" | "manual"

export type SuggestedAnswerResult =
  | { ticketId: string; status: "generated"; generationId: string; applied: boolean; confidence: SupportDraftConfidence }
  | { ticketId: string; status: "skipped"; reason: string }
  | { ticketId: string; status: "not_configured" }
  | { ticketId: string; status: "failed"; error: string; generationId: string | null }

/** At most one automatic draft per ticket (unique index); a failed or stuck backfill attempt is retried. */
async function claimAutomatic(
  admin: SupabaseClient,
  ticketId: string,
  origin: "auto" | "backfill"
): Promise<string | null> {
  const { data, error } = await admin
    .from("support_suggested_answers")
    .insert({
      ticket_id: ticketId,
      origin,
      status: "pending",
      model: SUPPORT_ANSWER_MODEL_ID,
      prompt_version: SUPPORT_HUB_DRAFT_PROMPT_VERSION,
    })
    .select("id")
    .single()
  if (!error && data) return (data as { id: string }).id
  if (isMissingRelation(error)) throw new Error(MIGRATION_PENDING)
  if (error?.code !== "23505") throw new Error(`draft claim failed: ${error?.message ?? "unknown error"}`)
  if (origin !== "backfill") return null

  const { data: existing, error: existingError } = await admin
    .from("support_suggested_answers")
    .select("id, status, updated_at")
    .eq("ticket_id", ticketId)
    .in("origin", ["auto", "backfill"])
    .maybeSingle()
  if (existingError || !existing) return null
  const row = existing as { id: string; status: string; updated_at: string }
  const stale = row.status === "pending" && Date.now() - Date.parse(row.updated_at) > PENDING_STALE_MS
  if (row.status !== "failed" && !stale) return null

  // Optimistic: only the caller that sees the same row state reclaims it
  const { data: reclaimed } = await admin
    .from("support_suggested_answers")
    .update({ status: "pending", origin, error_message: null })
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("updated_at", row.updated_at)
    .select("id")
  return ((reclaimed ?? []) as { id: string }[])[0]?.id ?? null
}

async function claimManual(supabase: SupabaseClient, ticketId: string, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("support_suggested_answers")
    .insert({
      ticket_id: ticketId,
      origin: "manual",
      status: "pending",
      model: SUPPORT_ANSWER_MODEL_ID,
      prompt_version: SUPPORT_HUB_DRAFT_PROMPT_VERSION,
      created_by: userId,
    })
    .select("id")
    .single()
  if (isMissingRelation(error)) throw new Error(MIGRATION_PENDING)
  if (error || !data) throw new Error(`draft claim failed: ${error?.message ?? "unknown error"}`)
  return (data as { id: string }).id
}

/**
 * Generate the Hub's suggested answer for one ticket. Returns no draft text,
 * so it is safe to call before the team has answered.
 * - `manual` (Prepare/Regenerate): replaces whatever draft is on the ticket.
 * - `auto` / `backfill`: at most once per ticket, only when the ticket has no
 *   draft, and the write is conditional so it never replaces a bot draft.
 */
export async function generateSuggestedAnswer(
  supabase: SupabaseClient,
  ticketId: string,
  options: { origin: SupportDraftOrigin; userId: string | null; now?: () => Date }
): Promise<SuggestedAnswerResult> {
  if (!isAiGatewayConfigured()) return { ticketId, status: "not_configured" }
  if (options.origin === "manual" && !options.userId)
    return { ticketId, status: "skipped", reason: "A manual draft needs a signed-in user." }
  const userLabel = options.userId ?? SYSTEM_USER
  const now = options.now ?? (() => new Date())

  const context = await loadSupportAnswerContext(supabase, ticketId, userLabel)
  if (!context) return { ticketId, status: "skipped", reason: "Ticket not found." }
  const blocked = hubDraftBlockReason(context.ticket)
  if (blocked) return { ticketId, status: "skipped", reason: blocked }
  if (options.origin !== "manual" && context.hasDraft)
    return { ticketId, status: "skipped", reason: "The ticket already has a draft." }

  const generationId =
    options.origin === "manual"
      ? await claimManual(supabase, ticketId, options.userId as string)
      : await claimAutomatic(supabase, ticketId, options.origin)
  if (!generationId) return { ticketId, status: "skipped", reason: "A draft was already generated automatically." }

  const startedAt = Date.now()
  try {
    const draft = await writeDraft(context, userLabel)
    const scored = await scoreDraft(context, draft.text)
    const generatedAt = now()
    const reply = buildHubSuggestedReply({ text: draft.text, sources: draft.sources, generationId, generatedAt })

    const { error: completeError } = await supabase
      .from("support_suggested_answers")
      .update({
        status: "completed",
        body: reply.text,
        sources: draft.sources,
        confidence: scored.confidence,
        jev_response: scored.raw,
        input_tokens: draft.inputTokens,
        output_tokens: draft.outputTokens,
        generation_ms: Date.now() - startedAt,
        completed_at: generatedAt.toISOString(),
      })
      .eq("id", generationId)
    if (completeError) throw new Error(`draft save failed: ${completeError.message}`)

    // Draft-only writes leave updated_at alone (migration 20260930200000)
    let apply = supabase.from("support_tickets").update({ suggested_reply: reply }).eq("id", ticketId)
    if (options.origin !== "manual") apply = apply.is("suggested_reply", null)
    const { data: applied, error: applyError } = await apply.select("id")
    if (applyError) throw new Error(`draft apply failed: ${applyError.message}`)
    const wasApplied = ((applied ?? []) as { id: string }[]).length > 0
    if (wasApplied) {
      const { error: flagError } = await supabase
        .from("support_suggested_answers")
        .update({ applied: true })
        .eq("id", generationId)
      if (flagError) console.error("[support-answers] applied flag failed:", flagError.message)
    }
    return { ticketId, status: "generated", generationId, applied: wasApplied, confidence: scored.confidence }
  } catch (error) {
    const message = errorText(error)
    await supabase
      .from("support_suggested_answers")
      .update({ status: "failed", error_message: message, generation_ms: Date.now() - startedAt })
      .eq("id", generationId)
    return { ticketId, status: "failed", error: message, generationId }
  }
}

/** The capture hook and the backfill: small concurrency, never throws. */
export async function generateAutomaticSuggestedAnswers(
  admin: SupabaseClient,
  ticketIds: string[],
  origin: "auto" | "backfill"
): Promise<SuggestedAnswerResult[]> {
  const ids = [...new Set(ticketIds)]
  if (!isAiGatewayConfigured()) return ids.map((ticketId) => ({ ticketId, status: "not_configured" as const }))
  const results: SuggestedAnswerResult[] = []
  for (let offset = 0; offset < ids.length; offset += AUTO_CONCURRENCY) {
    const batch = ids.slice(offset, offset + AUTO_CONCURRENCY)
    results.push(
      ...(await Promise.all(
        batch.map(async (ticketId): Promise<SuggestedAnswerResult> => {
          try {
            return await generateSuggestedAnswer(admin, ticketId, { origin, userId: null })
          } catch (error) {
            return { ticketId, status: "failed", error: errorText(error), generationId: null }
          }
        })
      ))
    )
  }
  return results
}

/**
 * Open tickets with no draft and no finished automatic attempt, oldest ask
 * first. Idempotent: a ticket drops out once it has a draft or a completed
 * automatic generation.
 */
export async function listTicketsNeedingHubDraft(
  admin: SupabaseClient,
  limit: number
): Promise<{ id: string; ticket_number: number }[]> {
  const { data, error } = await admin
    .from("support_tickets")
    .select("id, ticket_number")
    .in("status", SUPPORT_ACTIVE_STATUSES)
    .is("merged_into", null)
    .is("suggested_reply", null)
    .not("category", "in", "(billing,offboarding)")
    .neq("request_type", "check_in")
    .order("requested_at", { ascending: true })
    .limit(500)
  if (error) throw new Error(`draft backfill list failed: ${error.message}`)
  const tickets = (data ?? []) as { id: string; ticket_number: number }[]

  const done = new Set<string>()
  for (let offset = 0; offset < tickets.length; offset += 100) {
    const chunk = tickets.slice(offset, offset + 100).map((t) => t.id)
    const { data: attempts, error: attemptsError } = await admin
      .from("support_suggested_answers")
      .select("ticket_id, status, updated_at")
      .in("ticket_id", chunk)
      .in("origin", ["auto", "backfill"])
    if (attemptsError) throw new Error(`draft backfill attempts failed: ${attemptsError.message}`)
    for (const a of (attempts ?? []) as { ticket_id: string; status: string; updated_at: string }[]) {
      const freshPending = a.status === "pending" && Date.now() - Date.parse(a.updated_at) <= PENDING_STALE_MS
      if (a.status === "completed" || freshPending) done.add(a.ticket_id)
    }
  }
  return tickets.filter((t) => !done.has(t.id)).slice(0, Math.max(0, limit))
}

// ---------------------------------------------------------------------------
// The team's answer row and the (server-side) suggestion
// ---------------------------------------------------------------------------

const ANSWER_COLUMNS =
  "ticket_id, first_body, first_saved_at, suggestion_at_unlock, body, updated_at, final_body, final_source, final_saved_at, suggestion_at_final, suggestion_adoption, used_suggestion"

type AnswerRow = {
  ticket_id: string
  first_body: string
  first_saved_at: string
  suggestion_at_unlock: unknown
  body: string
  updated_at: string
  final_body: string | null
  final_source: SupportFinalSource | null
  final_saved_at: string | null
  suggestion_at_final: unknown
  suggestion_adoption: number | string | null
  used_suggestion: SupportUsedSuggestion | null
}

type TicketGate = {
  status: SupportStatus
  category: SupportCategory
  request_type: SupportRequestType
  merged_into: string | null
}

async function loadTicketGate(supabase: SupabaseClient, ticketId: string): Promise<TicketGate | null> {
  const { data, error } = await supabase
    .from("support_tickets")
    .select("status, category, request_type, merged_into")
    .eq("id", ticketId)
    .maybeSingle()
  if (error) throw new Error(`support ticket lookup failed: ${error.message}`)
  return (data as TicketGate | null) ?? null
}

function closedError(gate: TicketGate | null): string | null {
  if (!gate) return "Ticket not found."
  if (gate.merged_into || SUPPORT_CLOSED_STATUSES.includes(gate.status)) return "This ticket is closed."
  return null
}

async function loadAnswerRow(
  supabase: SupabaseClient,
  ticketId: string
): Promise<{ row: AnswerRow | null; missing: boolean }> {
  const { data, error } = await supabase
    .from("support_ticket_answers")
    .select(ANSWER_COLUMNS)
    .eq("ticket_id", ticketId)
    .maybeSingle()
  if (isMissingRelation(error)) return { row: null, missing: true }
  if (error) throw new Error(`answer lookup failed: ${error.message}`)
  return { row: (data as AnswerRow | null) ?? null, missing: false }
}

/**
 * The ticket's current draft, read on the server. Callers only pass its text
 * on once the team has a saved answer (or to snapshot it at unlock).
 */
async function readSuggestion(supabase: SupabaseClient, ticketId: string): Promise<SupportSuggestedReply | null> {
  const { data, error } = await supabase.from("support_tickets").select("suggested_reply").eq("id", ticketId).maybeSingle()
  if (error) throw new Error(`suggestion lookup failed: ${error.message}`)
  const reply = (data as { suggested_reply: SupportSuggestedReply | null } | null)?.suggested_reply
  return reply && typeof reply.text === "string" && reply.text.trim() ? reply : null
}

function snapshotOf(reply: SupportSuggestedReply | null): SupportSuggestionSnapshot | null {
  if (!reply) return null
  return {
    text: reply.text,
    source: suggestedReplySource(reply) ?? "bot",
    generation_id: reply.generation_id ?? null,
    generated_at: reply.generated_at,
  }
}

async function recordEvent(
  supabase: SupabaseClient,
  row: { ticket_id: string; event_type: string; actor_id: string; body?: string | null; payload?: Record<string, unknown> }
) {
  const { error } = await supabase.from("support_ticket_events").insert({ payload: {}, ...row })
  if (error) console.error(`[support-answers] ${row.event_type} event failed:`, error.message)
}

export type SaveAnswerResult =
  | { ok: true; changed: boolean; body: string; unlocked: boolean }
  | { ok: false; error: string }

/**
 * Save the team's answer. The first save stores the blind first answer,
 * snapshots the suggestion as it is right now, and unlocks it (timeline:
 * `suggestion_unlocked`). Later saves update the answer under review.
 */
export async function saveSupportAnswer(
  supabase: SupabaseClient,
  ticketId: string,
  text: unknown,
  userId: string
): Promise<SaveAnswerResult> {
  const prepared = prepareSupportAnswer(text)
  if (!prepared.ok) return prepared
  const gate = await loadTicketGate(supabase, ticketId)
  const closed = closedError(gate)
  if (closed) return { ok: false, error: closed }

  const { row, missing } = await loadAnswerRow(supabase, ticketId)
  if (missing) return { ok: false, error: "Answers aren't set up yet (migration pending)." }

  if (!row) {
    const suggestion = hubDraftBlockReason(gate as TicketGate) ? null : snapshotOf(await readSuggestion(supabase, ticketId))
    const { error } = await supabase.from("support_ticket_answers").insert({
      ticket_id: ticketId,
      first_body: prepared.value,
      body: prepared.value,
      first_saved_by: userId,
      updated_by: userId,
      suggestion_at_unlock: suggestion,
    })
    if (error?.code === "23505") return { ok: false, error: "Someone just saved the first answer. Reload the page." }
    if (error) throw new Error(`answer save failed: ${error.message}`)
    await recordEvent(supabase, {
      ticket_id: ticketId,
      event_type: "answer_saved",
      actor_id: userId,
      payload: { characters: prepared.value.length, first: true },
    })
    await recordEvent(supabase, {
      ticket_id: ticketId,
      event_type: "suggestion_unlocked",
      actor_id: userId,
      body: suggestion
        ? `Answered first, then unlocked the ${suggestion.source === "hub" ? "Hub" : "bot"} draft`
        : "Answered first; no suggested answer was ready",
      payload: {
        blind_first: true,
        suggestion_available: !!suggestion,
        suggestion_source: suggestion?.source ?? null,
        generation_id: suggestion?.generation_id ?? null,
        suggestion_generated_at: suggestion?.generated_at ?? null,
      },
    })
    return { ok: true, changed: true, body: prepared.value, unlocked: true }
  }

  if (row.body === prepared.value) return { ok: true, changed: false, body: prepared.value, unlocked: false }
  const { error } = await supabase
    .from("support_ticket_answers")
    .update({ body: prepared.value, updated_by: userId })
    .eq("ticket_id", ticketId)
  if (error) throw new Error(`answer save failed: ${error.message}`)
  await recordEvent(supabase, {
    ticket_id: ticketId,
    event_type: "answer_saved",
    actor_id: userId,
    payload: { characters: prepared.value.length, first: false },
  })
  return { ok: true, changed: true, body: prepared.value, unlocked: false }
}

// ---------------------------------------------------------------------------
// Step 2: Jev check of an answer, and the comparison with the suggestion
// ---------------------------------------------------------------------------

export type AnswerCheckRunResult =
  | { status: "checked"; checkId: string; verdict: SupportAnswerVerdict; results: SupportAnswerCheckResult[] }
  | { status: "not_configured" }
  | { status: "failed"; error: string }

async function checkWithContext(
  supabase: SupabaseClient,
  context: SupportAnswerContext,
  answerText: string,
  target: SupportAnswerCheckTarget,
  userId: string
): Promise<AnswerCheckRunResult> {
  if (!isJevConfigured()) return { status: "not_configured" }
  const hasKnowledge = context.knowledge.length > 0
  const state = buildJevState(context, answerText)
  const decided = await jevDecide(state, answerCheckQuestions(hasKnowledge))
  if (!decided.ok) {
    if (decided.reason === "not_configured") return { status: "not_configured" }
    console.error("[support-answers] answer check failed:", decided.error)
    return { status: "failed", error: decided.error }
  }

  const { results, verdict } = interpretAnswerCheck(decided.answers, {
    reply: answerText,
    changeControlled: context.changeControlled,
    hasKnowledge,
  })
  const { data, error } = await supabase
    .from("support_answer_checks")
    .insert({
      ticket_id: context.ticket.id,
      target,
      answer_snapshot: answerText,
      results,
      verdict,
      model: decided.model,
      model_version: decided.modelVersion,
      transport: decided.transport,
      question_set: SUPPORT_ANSWER_CHECK_VERSION,
      request_state: state,
      jev_response: decided.raw,
      knowledge_sources: context.knowledge.map((k) => ({ id: k.id, title: k.title, slug: k.slug })),
      duration_ms: decided.durationMs,
      created_by: userId,
    })
    .select("id")
    .single()
  if (isMissingRelation(error)) return { status: "failed", error: MIGRATION_PENDING }
  if (error || !data) throw new Error(`answer check save failed: ${error?.message ?? "unknown error"}`)
  const checkId = (data as { id: string }).id

  await recordEvent(supabase, {
    ticket_id: context.ticket.id,
    event_type: "answer_checked",
    actor_id: userId,
    body: `AI check of the ${target === "final" ? "final" : "team"} answer: ${SUPPORT_ANSWER_VERDICT_LABEL[verdict]}`,
    payload: {
      check_id: checkId,
      target,
      verdict,
      model: decided.model,
      model_version: decided.modelVersion,
      transport: decided.transport,
      problems: results.filter((r) => r.outcome === "problem").map((r) => r.key),
    },
  })
  return { status: "checked", checkId, verdict, results }
}

export type ComparisonRunResult =
  | {
      status: "compared"
      comparisonId: string
      verdict: SupportComparisonVerdict | null
      results: SupportComparisonResult[]
      adds: SupportSuggestionAdd[]
      jevStatus: "ok" | "not_configured" | "failed"
      addsStatus: "ok" | "not_configured" | "failed"
    }
  | { status: "not_configured" }
  | { status: "no_suggestion" }

async function writeAdds(
  context: SupportAnswerContext,
  teamAnswer: string,
  suggestion: string,
  userLabel: string
): Promise<SupportSuggestionAdd[]> {
  const result = await createAddsAgent(userLabel).generate({
    prompt: buildAddsPrompt(context, teamAnswer, suggestion),
    timeout: { totalMs: DRAFT_TIMEOUT_MS, stepMs: DRAFT_TIMEOUT_MS },
  })
  return validateSuggestionAdds(result.output.adds, { suggestion, teamAnswer })
}

async function compareWithContext(
  supabase: SupabaseClient,
  context: SupportAnswerContext,
  teamAnswer: string,
  suggestion: SupportSuggestionSnapshot,
  userId: string
): Promise<ComparisonRunResult> {
  const jevReady = isJevConfigured()
  const gatewayReady = isAiGatewayConfigured()
  if (!jevReady && !gatewayReady) return { status: "not_configured" }

  const state = buildComparisonJevState(context, teamAnswer, suggestion.text)
  const startedAt = Date.now()
  const [jev, adds] = await Promise.all([
    jevReady ? jevDecide(state, comparisonQuestions()) : Promise.resolve(null),
    gatewayReady
      ? writeAdds(context, teamAnswer, suggestion.text, userId).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error: errorText(error) })
        )
      : Promise.resolve(null),
  ])

  const jevStatus = jev?.ok ? "ok" : jev && jev.reason !== "not_configured" ? "failed" : "not_configured"
  const interpretation = jev?.ok ? interpretComparison(jev.answers) : null
  const addsStatus = adds?.ok ? "ok" : adds ? "failed" : "not_configured"
  const errors = [jev && !jev.ok ? jev.error : null, adds && !adds.ok ? adds.error : null].filter(Boolean)
  if (errors.length) console.error("[support-answers] comparison:", errors.join(" | "))

  const { data, error } = await supabase
    .from("support_answer_comparisons")
    .insert({
      ticket_id: context.ticket.id,
      team_answer_snapshot: teamAnswer,
      suggestion_snapshot: suggestion,
      jev_status: jevStatus,
      results: interpretation?.results ?? [],
      verdict: interpretation?.verdict ?? null,
      model: jev?.ok ? jev.model : null,
      model_version: jev?.ok ? jev.modelVersion : null,
      transport: jev?.ok ? jev.transport : null,
      question_set: SUPPORT_COMPARISON_VERSION,
      request_state: state,
      jev_response: jev?.ok ? jev.raw : null,
      adds: adds?.ok ? adds.value : [],
      adds_status: addsStatus,
      adds_model: adds?.ok ? SUPPORT_ANSWER_MODEL_ID : null,
      error_message: errors.length ? errors.join(" | ").slice(0, 1000) : null,
      duration_ms: Date.now() - startedAt,
      created_by: userId,
    })
    .select("id")
    .single()
  if (isMissingRelation(error)) return { status: "not_configured" }
  if (error || !data) throw new Error(`comparison save failed: ${error?.message ?? "unknown error"}`)
  return {
    status: "compared",
    comparisonId: (data as { id: string }).id,
    verdict: interpretation?.verdict ?? null,
    results: interpretation?.results ?? [],
    adds: adds?.ok ? adds.value : [],
    jevStatus,
    addsStatus,
  }
}

export type ReviewRunResult =
  | { status: "locked" | "not_found"; error: string }
  | { status: "reviewed"; check: AnswerCheckRunResult; comparison: ComparisonRunResult }

/**
 * Step 2, after the first save (and on demand after edits): check the team's
 * saved answer and compare it with the suggestion. Requires the unlock.
 */
export async function runSupportAnswerReview(
  supabase: SupabaseClient,
  ticketId: string,
  userId: string
): Promise<ReviewRunResult> {
  const { row, missing } = await loadAnswerRow(supabase, ticketId)
  if (missing) return { status: "locked", error: MIGRATION_PENDING }
  if (!row || !hasSavedTeamAnswer(row)) return { status: "locked", error: LOCKED }
  const context = await loadSupportAnswerContext(supabase, ticketId, userId)
  if (!context) return { status: "not_found", error: "Ticket not found." }

  const reply = hubDraftBlockReason(context.ticket) ? null : await readSuggestion(supabase, ticketId)
  const suggestion = snapshotOf(reply)
  const [check, comparison] = await Promise.all([
    checkWithContext(supabase, context, row.body, "team", userId),
    suggestion
      ? compareWithContext(supabase, context, row.body, suggestion, userId)
      : Promise.resolve<ComparisonRunResult>({ status: "no_suggestion" }),
  ])

  // The first suggestion seen after an unlock with none ready becomes the snapshot
  if (suggestion && !row.suggestion_at_unlock) {
    const { error } = await supabase
      .from("support_ticket_answers")
      .update({ suggestion_at_unlock: suggestion, updated_by: userId })
      .eq("ticket_id", ticketId)
      .is("suggestion_at_unlock", null)
    if (error) console.error("[support-answers] unlock snapshot failed:", error.message)
  }
  return { status: "reviewed", check, comparison }
}

// ---------------------------------------------------------------------------
// Step 3: merge, check, and save the final answer
// ---------------------------------------------------------------------------

export type FinalCheckResult = AnswerCheckRunResult | { status: "locked"; error: string } | { status: "invalid"; error: string }

export async function runSupportFinalCheck(
  supabase: SupabaseClient,
  ticketId: string,
  text: unknown,
  userId: string
): Promise<FinalCheckResult> {
  const prepared = prepareSupportAnswer(text)
  if (!prepared.ok) return { status: "invalid", error: prepared.error }
  if (!isJevConfigured()) return { status: "not_configured" }
  const { row, missing } = await loadAnswerRow(supabase, ticketId)
  if (missing || !row || !hasSavedTeamAnswer(row)) return { status: "locked", error: missing ? MIGRATION_PENDING : LOCKED }
  const context = await loadSupportAnswerContext(supabase, ticketId, userId)
  if (!context) return { status: "failed", error: "Ticket not found." }
  return checkWithContext(supabase, context, prepared.value, "final", userId)
}

export type MergeResult =
  | { ok: true; text: string; addedPoints: string[] }
  | { ok: false; error: string; notConfigured?: boolean }

/**
 * "Merge with AI": the team's answer plus what the suggestion adds. The
 * team's facts win; numbers, billing wording, and live claims are checked in
 * code (one repair attempt, then fail closed). Returns text, stores nothing.
 */
export async function mergeSupportAnswers(
  supabase: SupabaseClient,
  ticketId: string,
  userId: string
): Promise<MergeResult> {
  if (!isAiGatewayConfigured()) return { ok: false, error: "AI merging is not configured.", notConfigured: true }
  const { row, missing } = await loadAnswerRow(supabase, ticketId)
  if (missing || !row || !hasSavedTeamAnswer(row)) return { ok: false, error: missing ? MIGRATION_PENDING : LOCKED }
  const context = await loadSupportAnswerContext(supabase, ticketId, userId)
  if (!context) return { ok: false, error: "Ticket not found." }
  const blocked = hubDraftBlockReason(context.ticket)
  if (blocked) return { ok: false, error: blocked }
  const suggestion = await readSuggestion(supabase, ticketId)
  if (!suggestion) return { ok: false, error: "There is no suggested answer to merge." }

  let violations: string[] = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await createMergeAgent(userId).generate({
      prompt: buildMergePrompt(context, row.body, suggestion.text, violations),
      timeout: { totalMs: DRAFT_TIMEOUT_MS, stepMs: DRAFT_TIMEOUT_MS },
    })
    const merged = result.output.merged.trim()
    violations = mergeViolations(merged, { teamAnswer: row.body, suggestion: suggestion.text, context })
    if (violations.length === 0)
      return { ok: true, text: maskContactDetails(merged), addedPoints: result.output.added_points.map(maskContactDetails) }
  }
  return { ok: false, error: `The merge broke the house rules: ${violations.join("; ")}. Edit by hand instead.` }
}

export type FinalSaveResult =
  | { ok: true; changed: boolean; body: string; usedSuggestion: SupportUsedSuggestion; adoption: number | null }
  | { ok: false; error: string }

/**
 * Save the answer to send in Assembly, with the suggestion as shown and the
 * derived draft usage (none / partly / mostly, see `suggestionAdoption`).
 */
export async function saveSupportFinalAnswer(
  supabase: SupabaseClient,
  ticketId: string,
  text: unknown,
  source: SupportFinalSource,
  userId: string
): Promise<FinalSaveResult> {
  const prepared = prepareSupportAnswer(text)
  if (!prepared.ok) return prepared
  const gate = await loadTicketGate(supabase, ticketId)
  const closed = closedError(gate)
  if (closed) return { ok: false, error: closed }
  const { row, missing } = await loadAnswerRow(supabase, ticketId)
  if (missing || !row || !hasSavedTeamAnswer(row)) return { ok: false, error: missing ? MIGRATION_PENDING : LOCKED }

  const suggestion = hubDraftBlockReason(gate as TicketGate) ? null : snapshotOf(await readSuggestion(supabase, ticketId))
  const adoption = suggestionAdoption({ suggestion: suggestion?.text ?? null, teamFirst: row.first_body, final: prepared.value })
  const usedSuggestion = usedSuggestionBucket(adoption)
  if (row.final_body === prepared.value && row.final_source === source)
    return { ok: true, changed: false, body: prepared.value, usedSuggestion, adoption }

  const { error } = await supabase
    .from("support_ticket_answers")
    .update({
      final_body: prepared.value,
      final_source: source,
      suggestion_at_final: suggestion,
      suggestion_adoption: adoption,
      used_suggestion: usedSuggestion,
      updated_by: userId,
    })
    .eq("ticket_id", ticketId)
  if (error) throw new Error(`final answer save failed: ${error.message}`)
  await recordEvent(supabase, {
    ticket_id: ticketId,
    event_type: "answer_finalized",
    actor_id: userId,
    body: `Final answer saved · ${SUPPORT_USED_SUGGESTION_LABEL[usedSuggestion].toLowerCase()}`,
    payload: {
      final_source: source,
      used_suggestion: usedSuggestion,
      suggestion_adoption: adoption,
      suggestion_source: suggestion?.source ?? null,
      generation_id: suggestion?.generation_id ?? null,
      changed_since_first: prepared.value !== row.first_body,
    },
  })
  return { ok: true, changed: true, body: prepared.value, usedSuggestion, adoption }
}

// ---------------------------------------------------------------------------
// Ticket page read model. THE LOCK lives here: before the team has a saved
// answer, nothing returned carries suggestion text, sources, or scores.
// ---------------------------------------------------------------------------

type ProfileRef = { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null

function profileName(ref: ProfileRef): string | null {
  const p = Array.isArray(ref) ? ref[0] : ref
  if (!p) return null
  return p.full_name?.trim() || p.email
}

export type SupportAnswerCheckView = {
  id: string
  target: SupportAnswerCheckTarget
  verdict: SupportAnswerVerdict
  results: SupportAnswerCheckResult[]
  answerSnapshot: string
  model: string
  modelVersion: string | null
  createdAt: string
  createdByName: string | null
}

export type SupportUnlockedSuggestion = {
  text: string
  source: SupportDraftSource
  generatedAt: string
  skill: string | null
  basis: string[]
  freshness: DraftFreshness
  gaps: string[]
  /** Hub drafts only */
  sources: SupportAnswerSource[] | null
  confidence: SupportDraftConfidence | null
  createdByName: string | null
}

export type SupportAnswerPanelData = {
  /** False until the migration is applied; the page hides the new tools */
  schemaReady: boolean
  /** The team has a saved answer, so the suggestion may be shown */
  unlocked: boolean
  /** Step 1's lock line: never text */
  lock: { status: SuggestionLockStatus; message: string }
  draftPending: boolean
  lastDraftError: string | null
  answer: {
    firstBody: string
    firstSavedAt: string
    firstSavedByName: string | null
    body: string
    updatedAt: string
    updatedByName: string | null
    final: {
      body: string
      source: SupportFinalSource | null
      savedAt: string | null
      savedByName: string | null
      usedSuggestion: SupportUsedSuggestion | null
      adoption: number | null
    } | null
  } | null
  /** Only when unlocked */
  suggestion: SupportUnlockedSuggestion | null
  teamCheck: SupportAnswerCheckView | null
  finalCheck: SupportAnswerCheckView | null
  /** Only when unlocked */
  comparison: {
    id: string
    verdict: SupportComparisonVerdict | null
    results: SupportComparisonResult[]
    adds: SupportSuggestionAdd[]
    jevStatus: "ok" | "not_configured" | "failed"
    addsStatus: "ok" | "not_configured" | "failed"
    teamAnswerSnapshot: string
    suggestionText: string
    model: string | null
    createdAt: string
    createdByName: string | null
  } | null
}

const EMPTY_PANEL: SupportAnswerPanelData = {
  schemaReady: false,
  unlocked: false,
  lock: { status: "missing", message: "" },
  draftPending: false,
  lastDraftError: null,
  answer: null,
  suggestion: null,
  teamCheck: null,
  finalCheck: null,
  comparison: null,
}

const PANEL_ANSWER_COLUMNS = `${ANSWER_COLUMNS},
  first_author:profiles!support_ticket_answers_first_saved_by_fkey(full_name, email),
  editor:profiles!support_ticket_answers_updated_by_fkey(full_name, email),
  finalizer:profiles!support_ticket_answers_final_saved_by_fkey(full_name, email)`

const CHECK_COLUMNS =
  "id, target, verdict, results, answer_snapshot, model, model_version, created_at, checker:profiles!support_answer_checks_created_by_fkey(full_name, email)"

// Metadata only: the lock is decided before any suggestion text is read
const PANEL_TICKET_COLUMNS =
  "status, category, request_type, merged_into, last_client_message_at, last_team_message_at, suggested_reply_generated_at:suggested_reply->>generated_at"

type CheckRow = {
  id: string
  target: SupportAnswerCheckTarget
  verdict: SupportAnswerVerdict
  results: unknown
  answer_snapshot: string
  model: string
  model_version: string | null
  created_at: string
  checker: ProfileRef
}

function toCheckView(row: CheckRow | null): SupportAnswerCheckView | null {
  if (!row) return null
  return {
    id: row.id,
    target: row.target,
    verdict: row.verdict,
    results: parseAnswerCheckResults(row.results),
    answerSnapshot: row.answer_snapshot,
    model: row.model,
    modelVersion: row.model_version,
    createdAt: row.created_at,
    createdByName: profileName(row.checker),
  }
}

function latestCheck(supabase: SupabaseClient, ticketId: string, target: SupportAnswerCheckTarget) {
  return supabase
    .from("support_answer_checks")
    .select(CHECK_COLUMNS)
    .eq("ticket_id", ticketId)
    .eq("target", target)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
}

/** The answer panel, read with the signed-in session (RLS applies). */
export async function loadSupportAnswerPanel(
  supabase: SupabaseClient,
  ticketId: string,
  now: Date = new Date()
): Promise<SupportAnswerPanelData> {
  const [answer, ticket, teamCheck, finalCheck, generations] = await Promise.all([
    supabase.from("support_ticket_answers").select(PANEL_ANSWER_COLUMNS).eq("ticket_id", ticketId).maybeSingle(),
    supabase.from("support_tickets").select(PANEL_TICKET_COLUMNS).eq("id", ticketId).maybeSingle(),
    latestCheck(supabase, ticketId, "team"),
    latestCheck(supabase, ticketId, "final"),
    supabase
      .from("support_suggested_answers")
      .select("id, status, error_message, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(5),
  ])
  if ([answer.error, teamCheck.error, finalCheck.error, generations.error].some(isMissingRelation)) return EMPTY_PANEL
  for (const result of [answer, ticket, teamCheck, finalCheck, generations]) {
    if (result.error) throw new Error(`support answer panel failed: ${result.error.message}`)
  }
  const meta = ticket.data as
    | (TicketGate & {
        last_client_message_at: string | null
        last_team_message_at: string | null
        suggested_reply_generated_at: string | null
      })
    | null
  if (!meta) return EMPTY_PANEL

  const a = answer.data as
    | (AnswerRow & { first_author: ProfileRef; editor: ProfileRef; finalizer: ProfileRef })
    | null
  const gens = (generations.data ?? []) as { id: string; status: string; error_message: string | null; created_at: string }[]
  const latestGen = gens[0] ?? null
  const blockReason = hubDraftBlockReason(meta)
  const draftPending =
    !!latestGen && latestGen.status === "pending" && now.getTime() - Date.parse(latestGen.created_at) < PENDING_STALE_MS
  const draftAt = meta.suggested_reply_generated_at ? Date.parse(meta.suggested_reply_generated_at) : NaN
  const lastDraftError =
    latestGen?.status === "failed" && (Number.isNaN(draftAt) || Date.parse(latestGen.created_at) > draftAt)
      ? latestGen.error_message
      : null
  const unlocked = hasSavedTeamAnswer(a)

  const panel: SupportAnswerPanelData = {
    schemaReady: true,
    unlocked,
    lock: suggestionLockStatus({
      blockReason,
      hasDraft: !!meta.suggested_reply_generated_at,
      pendingGeneration: draftPending,
      draftsConfigured: isAiGatewayConfigured(),
    }),
    draftPending,
    lastDraftError,
    answer: a
      ? {
          firstBody: a.first_body,
          firstSavedAt: a.first_saved_at,
          firstSavedByName: profileName(a.first_author),
          body: a.body,
          updatedAt: a.updated_at,
          updatedByName: profileName(a.editor),
          final: a.final_body
            ? {
                body: a.final_body,
                source: a.final_source,
                savedAt: a.final_saved_at,
                savedByName: profileName(a.finalizer),
                usedSuggestion: a.used_suggestion,
                adoption: a.suggestion_adoption === null ? null : Number(a.suggestion_adoption),
              }
            : null,
        }
      : null,
    suggestion: null,
    teamCheck: toCheckView(teamCheck.data as CheckRow | null),
    finalCheck: toCheckView(finalCheck.data as CheckRow | null),
    comparison: null,
  }
  if (!unlocked || blockReason) return panel

  // Unlocked: now, and only now, read the suggestion text and its comparison
  const [reply, comparison] = await Promise.all([
    readSuggestion(supabase, ticketId),
    supabase
      .from("support_answer_comparisons")
      .select(
        "id, verdict, results, adds, jev_status, adds_status, team_answer_snapshot, suggestion_snapshot, model, created_at, creator:profiles!support_answer_comparisons_created_by_fkey(full_name, email)"
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (comparison.error && !isMissingRelation(comparison.error))
    throw new Error(`support comparison load failed: ${comparison.error.message}`)

  if (reply) {
    const source = suggestedReplySource(reply) ?? "bot"
    type GenerationDetail = { sources: unknown; confidence: unknown; creator: ProfileRef }
    let generation: GenerationDetail | null = null
    if (source === "hub" && reply.generation_id) {
      const { data, error } = await supabase
        .from("support_suggested_answers")
        .select("sources, confidence, creator:profiles!support_suggested_answers_created_by_fkey(full_name, email)")
        .eq("id", reply.generation_id)
        .maybeSingle()
      if (error) throw new Error(`support draft detail failed: ${error.message}`)
      generation = (data as GenerationDetail | null) ?? null
    }
    const sources = generation ? parseStoredSources(generation.sources) : []
    panel.suggestion = {
      text: reply.text,
      source,
      generatedAt: reply.generated_at,
      skill: reply.skill,
      basis: reply.basis ?? [],
      freshness: suggestedReplyFreshness(reply.generated_at, meta),
      gaps: unfilledPlaceholders(reply.text),
      sources: sources.length ? sources : null,
      confidence: generation ? parseDraftConfidence(generation.confidence) : null,
      createdByName: generation ? profileName(generation.creator) : null,
    }
  }

  const c = comparison.data as {
    id: string
    verdict: SupportComparisonVerdict | null
    results: unknown
    adds: unknown
    jev_status: "ok" | "not_configured" | "failed"
    adds_status: "ok" | "not_configured" | "failed"
    team_answer_snapshot: string
    suggestion_snapshot: unknown
    model: string | null
    created_at: string
    creator: ProfileRef
  } | null
  if (c) {
    panel.comparison = {
      id: c.id,
      verdict: c.verdict,
      results: parseComparisonResults(c.results),
      adds: parseSuggestionAdds(c.adds),
      jevStatus: c.jev_status,
      addsStatus: c.adds_status,
      teamAnswerSnapshot: c.team_answer_snapshot,
      suggestionText: parseSuggestionSnapshot(c.suggestion_snapshot)?.text ?? "",
      model: c.model,
      createdAt: c.created_at,
      createdByName: profileName(c.creator),
    }
  }
  return panel
}
