import "server-only"

// Support answers — I/O for the Hub's suggested answer (AI Gateway), the
// owner's answer, and the Jev answer check. Every function takes the
// Supabase client to use:
//   * the signed-in session client from the ticket page's Server Actions
//     (RLS applies: support:view / support:edit), or
//   * the service-role admin client from the capture API's `after()` hook and
//     the CRON_SECRET backfill route. RLS does not apply there, so the
//     explicit column projections below are the security boundary: no client
//     billing fields, no profiles beyond names, never select("*").
// Nothing here sends anything to a client. Drafts and checks are advisory.

import type { SupabaseClient } from "@supabase/supabase-js"
import { isStepCount, Output, ToolLoopAgent } from "ai"

import { adjustmentStatusLabel, adjustmentTypeLabel } from "@/lib/adjustments"
import { JEV_MODEL } from "@/lib/jev"
import { isJevConfigured, jevDecide, scrubSecrets } from "@/lib/jev.server"
import { createKnowledgeSearch } from "@/lib/knowledge-retrieval.server"
import {
  SUPPORT_ANSWER_CHECK_VERSION,
  SUPPORT_ANSWER_MODEL_ID,
  SUPPORT_ANSWER_PORTFOLIO_LISTING_LIMIT,
  SUPPORT_ANSWER_TIMELINE_LIMIT,
  SUPPORT_ANSWER_VERDICT_LABEL,
  SUPPORT_DRAFT_INSTRUCTIONS,
  SUPPORT_HUB_DRAFT_PROMPT_VERSION,
  buildDraftPrompt,
  buildDraftSources,
  buildHubSuggestedReply,
  buildJevState,
  answerCheckQuestions,
  draftConfidenceQuestions,
  hubDraftBlockReason,
  hubDraftViolations,
  interpretAnswerCheck,
  interpretDraftConfidence,
  knowledgePassagesFromSources,
  linkedChangeControlled,
  listingFactName,
  markCitedSources,
  parseAnswerCheckResults,
  parseDraftConfidence,
  parseStoredSources,
  prepareSupportAnswer,
  supportAnswerKnowledgeQuery,
  supportDraftOutputSchema,
  type SupportAnswerCheckResult,
  type SupportAnswerContext,
  type SupportAnswerListingFact,
  type SupportAnswerSource,
  type SupportAnswerVerdict,
  type SupportDraftConfidence,
} from "@/lib/support-answers"
import { ticketPropertyLabel } from "@/lib/support-display"
import {
  SUPPORT_ACTIVE_STATUSES,
  SUPPORT_CLOSED_STATUSES,
  type SupportCategory,
  type SupportPropertyScope,
  type SupportRequestType,
  type SupportStatus,
} from "@/lib/support-tickets"

const DRAFT_TIMEOUT_MS = 30_000
const PENDING_STALE_MS = 10 * 60_000
const AUTO_CONCURRENCY = 2
const SYSTEM_USER = "system:support-answers"
const MIGRATION_PENDING = "Support answer tables are missing (migration 20261004120000 is not applied yet)."

// ---------------------------------------------------------------------------
// Configuration (never throws; pages show "not configured")
// ---------------------------------------------------------------------------

/** Same rule as Market Signals briefs: a local key, or Vercel OIDC in deployments. */
export function isAiGatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL)
}

export function supportAnswerRuntimeStatus() {
  return {
    drafts: isAiGatewayConfigured(),
    check: isJevConfigured(),
    draftModel: SUPPORT_ANSWER_MODEL_ID,
    jevModel: JEV_MODEL,
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

/** Everything a draft or a check reads for one ticket; null when not visible. */
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
  const listingRows = t.property_scope === "portfolio" ? ((portfolio.data ?? []) as unknown as ListingFactRow[]) : ticketListings
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
// Writing the draft (AI Gateway) and scoring it (Jev)
// ---------------------------------------------------------------------------

function createSupportAnswerAgent(userLabel: string) {
  return new ToolLoopAgent({
    id: "revfactor-support-answer",
    model: SUPPORT_ANSWER_MODEL_ID,
    reasoning: "none",
    instructions: SUPPORT_DRAFT_INSTRUCTIONS,
    providerOptions: {
      gateway: {
        user: userLabel,
        tags: ["feature:support-answer", `environment:${process.env.VERCEL_ENV ?? "development"}`],
      },
    },
    output: Output.object({ schema: supportDraftOutputSchema }),
    stopWhen: isStepCount(1),
    maxOutputTokens: 900,
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
    confidence: interpretDraftConfidence(decided.answers, {
      changeControlled: context.changeControlled,
      hasKnowledge,
      model: decided.model,
    }),
    raw: decided.raw,
  }
}

// ---------------------------------------------------------------------------
// Generating and storing a Hub draft
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
 * Generate the Hub's suggested answer for one ticket.
 * - `manual` (the Generate/Regenerate button): replaces whatever draft is on
 *   the ticket, Hub or bot. Runs with the user's session.
 * - `auto` / `backfill`: at most once per ticket, only when the ticket has no
 *   draft, and the write is conditional so it never replaces a bot draft
 *   that landed meanwhile. Runs with the admin client.
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
// The owner's answer
// ---------------------------------------------------------------------------

async function loadOpenTicket(
  supabase: SupabaseClient,
  ticketId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("support_tickets")
    .select("id, status, merged_into")
    .eq("id", ticketId)
    .maybeSingle()
  if (error) throw new Error(`support ticket lookup failed: ${error.message}`)
  if (!data) return { ok: false, error: "Ticket not found." }
  const row = data as { status: SupportStatus; merged_into: string | null }
  if (row.merged_into || SUPPORT_CLOSED_STATUSES.includes(row.status))
    return { ok: false, error: "This ticket is closed." }
  return { ok: true }
}

export async function saveSupportAnswer(
  supabase: SupabaseClient,
  ticketId: string,
  text: unknown,
  userId: string
): Promise<{ ok: true; changed: boolean; body: string } | { ok: false; error: string }> {
  const prepared = prepareSupportAnswer(text)
  if (!prepared.ok) return prepared
  const ticket = await loadOpenTicket(supabase, ticketId)
  if (!ticket.ok) return ticket

  const { data: current, error: currentError } = await supabase
    .from("support_ticket_answers")
    .select("body")
    .eq("ticket_id", ticketId)
    .maybeSingle()
  if (isMissingRelation(currentError)) return { ok: false, error: "Answers aren't set up yet (migration pending)." }
  if (currentError) throw new Error(`answer lookup failed: ${currentError.message}`)
  if ((current as { body: string } | null)?.body === prepared.value)
    return { ok: true, changed: false, body: prepared.value }

  const { error } = await supabase
    .from("support_ticket_answers")
    .upsert({ ticket_id: ticketId, body: prepared.value, updated_by: userId }, { onConflict: "ticket_id" })
  if (error) throw new Error(`answer save failed: ${error.message}`)

  const { error: eventError } = await supabase.from("support_ticket_events").insert({
    ticket_id: ticketId,
    event_type: "answer_saved",
    actor_id: userId,
    payload: { characters: prepared.value.length },
  })
  if (eventError) console.error("[support-answers] answer_saved event failed:", eventError.message)
  return { ok: true, changed: true, body: prepared.value }
}

// ---------------------------------------------------------------------------
// The Jev answer check
// ---------------------------------------------------------------------------

export type AnswerCheckRunResult =
  | { status: "checked"; checkId: string; verdict: SupportAnswerVerdict; results: SupportAnswerCheckResult[] }
  | { status: "not_configured" }
  | { status: "failed"; error: string }

/**
 * Check the owner's answer against the client's ask, the ticket facts, and
 * approved knowledge. Stores the snapshot, gated results, verdict, redacted
 * state, and full Jev response, and records `answer_checked` on the timeline.
 */
export async function runSupportAnswerCheck(
  supabase: SupabaseClient,
  ticketId: string,
  answerText: string,
  userId: string
): Promise<AnswerCheckRunResult> {
  if (!isJevConfigured()) return { status: "not_configured" }
  const context = await loadSupportAnswerContext(supabase, ticketId, userId)
  if (!context) return { status: "failed", error: "Ticket not found." }

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
      ticket_id: ticketId,
      answer_snapshot: answerText,
      results,
      verdict,
      model: decided.model,
      question_set: SUPPORT_ANSWER_CHECK_VERSION,
      request_state: state,
      jev_response: decided.raw,
      knowledge_sources: context.knowledge.map((k) => ({ id: k.id, title: k.title, slug: k.slug })),
      duration_ms: decided.durationMs,
      created_by: userId,
    })
    .select("id")
    .single()
  if (isMissingRelation(error)) return { status: "failed", error: "Answer checks aren't set up yet (migration pending)." }
  if (error || !data) throw new Error(`answer check save failed: ${error?.message ?? "unknown error"}`)
  const checkId = (data as { id: string }).id

  const { error: eventError } = await supabase.from("support_ticket_events").insert({
    ticket_id: ticketId,
    event_type: "answer_checked",
    actor_id: userId,
    body: `AI answer check: ${SUPPORT_ANSWER_VERDICT_LABEL[verdict]}`,
    payload: {
      check_id: checkId,
      verdict,
      model: decided.model,
      problems: results.filter((r) => r.outcome === "problem").map((r) => r.key),
    },
  })
  if (eventError) console.error("[support-answers] answer_checked event failed:", eventError.message)
  return { status: "checked", checkId, verdict, results }
}

// ---------------------------------------------------------------------------
// Ticket page read model
// ---------------------------------------------------------------------------

type ProfileRef = { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null

function profileName(ref: ProfileRef): string | null {
  const p = Array.isArray(ref) ? ref[0] : ref
  if (!p) return null
  return p.full_name?.trim() || p.email
}

export type SupportAnswerPanelData = {
  /** False until the migration is applied; the page hides the new tools */
  schemaReady: boolean
  answer: { body: string; updatedAt: string; updatedByName: string | null } | null
  latestCheck: {
    id: string
    verdict: SupportAnswerVerdict
    results: SupportAnswerCheckResult[]
    answerSnapshot: string
    model: string
    createdAt: string
    createdByName: string | null
  } | null
  generations: {
    id: string
    status: "pending" | "completed" | "failed"
    origin: SupportDraftOrigin
    sources: SupportAnswerSource[]
    confidence: SupportDraftConfidence | null
    model: string
    errorMessage: string | null
    createdAt: string
    createdByName: string | null
  }[]
}

const EMPTY_PANEL: SupportAnswerPanelData = { schemaReady: false, answer: null, latestCheck: null, generations: [] }

/** The answer panel's rows, read with the signed-in session (RLS applies). */
export async function loadSupportAnswerPanel(
  supabase: SupabaseClient,
  ticketId: string
): Promise<SupportAnswerPanelData> {
  const [answer, check, generations] = await Promise.all([
    supabase
      .from("support_ticket_answers")
      .select("body, updated_at, editor:profiles!support_ticket_answers_updated_by_fkey(full_name, email)")
      .eq("ticket_id", ticketId)
      .maybeSingle(),
    supabase
      .from("support_answer_checks")
      .select(
        "id, verdict, results, answer_snapshot, model, created_at, checker:profiles!support_answer_checks_created_by_fkey(full_name, email)"
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("support_suggested_answers")
      .select(
        "id, status, origin, sources, confidence, model, error_message, created_at, creator:profiles!support_suggested_answers_created_by_fkey(full_name, email)"
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(5),
  ])
  if ([answer.error, check.error, generations.error].some(isMissingRelation)) return EMPTY_PANEL
  for (const result of [answer, check, generations]) {
    if (result.error) throw new Error(`support answer panel failed: ${result.error.message}`)
  }

  const a = answer.data as { body: string; updated_at: string; editor: ProfileRef } | null
  const c = check.data as {
    id: string
    verdict: SupportAnswerVerdict
    results: unknown
    answer_snapshot: string
    model: string
    created_at: string
    checker: ProfileRef
  } | null

  return {
    schemaReady: true,
    answer: a ? { body: a.body, updatedAt: a.updated_at, updatedByName: profileName(a.editor) } : null,
    latestCheck: c
      ? {
          id: c.id,
          verdict: c.verdict,
          results: parseAnswerCheckResults(c.results),
          answerSnapshot: c.answer_snapshot,
          model: c.model,
          createdAt: c.created_at,
          createdByName: profileName(c.checker),
        }
      : null,
    generations: (
      (generations.data ?? []) as {
        id: string
        status: "pending" | "completed" | "failed"
        origin: SupportDraftOrigin
        sources: unknown
        confidence: unknown
        model: string
        error_message: string | null
        created_at: string
        creator: ProfileRef
      }[]
    ).map((g) => ({
      id: g.id,
      status: g.status,
      origin: g.origin,
      sources: parseStoredSources(g.sources),
      confidence: parseDraftConfidence(g.confidence),
      model: g.model,
      errorMessage: g.error_message,
      createdAt: g.created_at,
      createdByName: profileName(g.creator),
    })),
  }
}
