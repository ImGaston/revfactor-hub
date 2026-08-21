// Read helpers for the Wins dashboard.
//
// Every one of these runs through the caller's Supabase session, so the RLS
// policies on win_* are the access boundary. The Assembly deep link is the one
// value that is NOT derived here for everyone: the page decides whether to
// resolve it, based on wins:control.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  WINS_RULES_V1,
  rawInputsFromEvidence,
  ruleSetFromRow,
  type CandidateRawInputs,
  type WinCandidate,
  type WinCategory,
  type WinConfidence,
  type WinDetectionRun,
  type WinEventType,
  type WinEvidence,
  type WinReviewState,
  type WinsRules,
} from "@/lib/wins"

const RUN_SELECT =
  "id, as_of_date, period_start, period_end, rules_version, report_run_id, reservations_fetched_at, reservations_max_booked_date, status, candidate_count, currency, error_reason, completed_at"

const CANDIDATE_SELECT =
  "id, run_id, hub_listing_id, pricelabs_listing_id, client_id, listing_name_snapshot, client_name_snapshot, category, confidence, pickup_trend, reason_codes, is_blocked, priority_rank, evidence, created_at"

export const WINS_PAGE_SIZE = 50

export async function getLatestWinsRun(
  supabase: SupabaseClient
): Promise<WinDetectionRun | null> {
  const { data } = await supabase
    .from("win_detection_runs")
    .select(RUN_SELECT)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as WinDetectionRun) ?? null
}

export type WinsFilters = {
  category?: WinCategory | null
  confidence?: WinConfidence | null
  clientId?: string | null
  state?: WinReviewState | null
  hasChat?: "yes" | "no" | null
  readyOnly?: boolean
  search?: string | null
  page?: number
}

export type WinsPage = {
  candidates: WinCandidate[]
  count: number
  page: number
  pageSize: number
}

/**
 * One page of candidates for a run, with review state merged in code.
 *
 * The merge is deliberate: PostgREST embeds across a table that has no foreign
 * key back to win_candidates would need a view, and this project already
 * learned that embedding aggregate views is fragile (see the comment in
 * adjustments/page.tsx about adjustment_comment_stats).
 */
export async function getWinsPage(
  supabase: SupabaseClient,
  runId: string,
  filters: WinsFilters = {}
): Promise<WinsPage> {
  const page = Math.max(1, filters.page ?? 1)
  const from = (page - 1) * WINS_PAGE_SIZE

  let query = supabase
    .from("win_candidates")
    .select(CANDIDATE_SELECT, { count: "exact" })
    .eq("run_id", runId)

  if (filters.readyOnly) {
    // The default queue: real wins, unblocked. Confidence and review state are
    // filtered after the review merge, since state lives in another table.
    query = query.in("category", ["double_win", "yoy_positive_steady"]).eq("is_blocked", false)
  } else if (filters.category) {
    query = query.eq("category", filters.category)
  }
  if (filters.confidence) query = query.eq("confidence", filters.confidence)
  if (filters.clientId) query = query.eq("client_id", filters.clientId)
  if (filters.search) {
    const term = `%${filters.search.replace(/[%_]/g, "")}%`
    query = query.or(
      `listing_name_snapshot.ilike.${term},client_name_snapshot.ilike.${term}`
    )
  }

  const { data, count } = await query
    .order("priority_rank", { ascending: true })
    .range(from, from + WINS_PAGE_SIZE - 1)

  const candidates = (data ?? []) as WinCandidate[]
  const reviews = await getReviewStates(
    supabase,
    candidates.map((c) => c.hub_listing_id).filter((id): id is string => Boolean(id))
  )

  let merged = candidates.map((c) => ({
    ...c,
    review_state: (c.hub_listing_id ? reviews.get(c.hub_listing_id) : undefined) ?? "new",
  }))

  if (filters.state) merged = merged.filter((c) => c.review_state === filters.state)
  if (filters.readyOnly) {
    merged = merged.filter(
      (c) =>
        (c.confidence === "high" || c.confidence === "medium") &&
        (c.review_state === "new" || c.review_state === "in_review")
    )
  }

  return { candidates: merged, count: count ?? merged.length, page, pageSize: WINS_PAGE_SIZE }
}

export async function getReviewStates(
  supabase: SupabaseClient,
  listingIds: string[]
): Promise<Map<string, WinReviewState>> {
  if (listingIds.length === 0) return new Map()
  const { data } = await supabase
    .from("win_reviews")
    .select("hub_listing_id, state")
    .in("hub_listing_id", listingIds)
  return new Map(
    (data ?? []).map((r) => [r.hub_listing_id as string, r.state as WinReviewState])
  )
}

/** Category and confidence counts for the KPI row, across the whole run. */
export async function getWinsSummary(
  supabase: SupabaseClient,
  runId: string
): Promise<Record<WinCategory, number> & { total: number }> {
  const { data } = await supabase
    .from("win_candidates")
    .select("category")
    .eq("run_id", runId)
    .limit(2000)

  const base = {
    double_win: 0,
    yoy_positive_steady: 0,
    market_compass_candidate: 0,
    conflicting_signal: 0,
    insufficient_data: 0,
    no_win: 0,
    total: 0,
  }
  for (const row of data ?? []) {
    const key = row.category as WinCategory
    base[key] = (base[key] ?? 0) + 1
    base.total++
  }
  return base
}

export async function getWinCandidate(
  supabase: SupabaseClient,
  candidateId: string
): Promise<WinCandidate | null> {
  const { data } = await supabase
    .from("win_candidates")
    .select(CANDIDATE_SELECT)
    .eq("id", candidateId)
    .maybeSingle()
  if (!data) return null

  const candidate = data as WinCandidate
  if (candidate.hub_listing_id) {
    const reviews = await getReviewStates(supabase, [candidate.hub_listing_id])
    candidate.review_state = reviews.get(candidate.hub_listing_id) ?? "new"
  }
  return candidate
}

/**
 * Resolve the Assembly chat link for a client.
 *
 * Callers must gate on wins:control before using the result — the link is the
 * one piece of this feature that points at a real client conversation.
 */
export async function getClientChatTargets(
  supabase: SupabaseClient,
  clientIds: string[]
): Promise<Map<string, { assembly_client_id: string | null; assembly_company_id: string | null }>> {
  if (clientIds.length === 0) return new Map()
  const { data } = await supabase
    .from("clients")
    .select("id, assembly_client_id, assembly_company_id")
    .in("id", clientIds)
  return new Map(
    (data ?? []).map((c) => [
      c.id as string,
      {
        assembly_client_id: (c.assembly_client_id as string) ?? null,
        assembly_company_id: (c.assembly_company_id as string) ?? null,
      },
    ])
  )
}

export type WinEventRow = {
  id: string
  event_type: WinEventType
  created_at: string
  actor_id: string | null
  actor_name?: string | null
}

export async function getWinEvents(
  supabase: SupabaseClient,
  candidateId: string,
  limit = 20
): Promise<WinEventRow[]> {
  const { data } = await supabase
    .from("win_events")
    // FK-hinted: win_events has a second profiles-adjacent path through
    // win_message_drafts, and a bare embed would be ambiguous.
    .select("id, event_type, created_at, actor_id, profiles!win_events_actor_id_fkey(full_name)")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(limit)

  return (data ?? []).map((row) => {
    const profile = row.profiles as { full_name?: string | null } | null
    return {
      id: row.id as string,
      event_type: row.event_type as WinEventType,
      created_at: row.created_at as string,
      actor_id: (row.actor_id as string) ?? null,
      actor_name: profile?.full_name ?? null,
    }
  })
}

export type WinDraftRow = {
  id: string
  template_key: string
  template_version: string
  generated_body: string
  edited_body: string | null
  evidence_snapshot: unknown
  created_at: string
}

export async function getLatestDraft(
  supabase: SupabaseClient,
  candidateId: string
): Promise<WinDraftRow | null> {
  const { data } = await supabase
    .from("win_message_drafts")
    .select(
      "id, template_key, template_version, generated_body, edited_body, evidence_snapshot, created_at"
    )
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as WinDraftRow) ?? null
}

/** Client options for the filter dropdown, from the RLS-safe minimal view. */
export async function getWinClientOptions(
  supabase: SupabaseClient,
  runId: string
): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from("win_candidates")
    .select("client_id, client_name_snapshot")
    .eq("run_id", runId)
    .not("client_id", "is", null)
    .limit(2000)

  const seen = new Map<string, string>()
  for (const row of data ?? []) {
    const id = row.client_id as string
    if (!seen.has(id)) seen.set(id, (row.client_name_snapshot as string) ?? "Unnamed client")
  }
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Rule sets
// ---------------------------------------------------------------------------

const RULE_SET_SELECT =
  "id, version, note, pickup_up_threshold, pickup_down_threshold, pickup_window_days, min_stly_revenue, extreme_yoy_pct, revpar_index_win_floor, revpar_index_qa_ceiling, max_staleness_days, occ_up_pp_threshold, adr_down_pct_threshold, is_active, created_at, created_by"

export type WinRuleSetRow = {
  id: string
  version: number
  note: string | null
  is_active: boolean
  created_at: string
  created_by: string | null
  author_name?: string | null
} & Record<string, unknown>

/**
 * The rule set detection should use.
 *
 * Falls back to the seeded constant if the table is empty or unreadable, so a
 * missing migration degrades to the documented defaults instead of failing the
 * run outright.
 */
export async function getActiveRules(
  supabase: SupabaseClient
): Promise<{ rules: WinsRules; rowId: string | null }> {
  const { data } = await supabase
    .from("win_rule_sets")
    .select(RULE_SET_SELECT)
    .eq("is_active", true)
    .maybeSingle()

  if (!data) return { rules: WINS_RULES_V1, rowId: null }
  return { rules: ruleSetFromRow(data), rowId: data.id as string }
}

/** Every published version, newest first, with the author's name resolved. */
export async function getRuleSetHistory(
  supabase: SupabaseClient,
  limit = 20
): Promise<WinRuleSetRow[]> {
  const { data } = await supabase
    .from("win_rule_sets")
    .select(`${RULE_SET_SELECT}, profiles!win_rule_sets_created_by_fkey(full_name)`)
    .order("version", { ascending: false })
    .limit(limit)

  return (data ?? []).map((row) => {
    const profile = row.profiles as { full_name?: string | null } | null
    return { ...row, author_name: profile?.full_name ?? null } as WinRuleSetRow
  })
}

/**
 * Raw inputs for the rules editor's impact preview, from the latest completed
 * run. Only the fields evaluateCandidate reads, plus the codes it cannot
 * derive, so the payload stays small enough to re-evaluate in the browser.
 */
export type PreviewCandidate = {
  id: string
  listing_name: string
  raw: CandidateRawInputs
  staticReasonCodes: string[]
}

export async function getRuleImpactSample(
  supabase: SupabaseClient,
  runId: string,
  stalenessDays: number
): Promise<PreviewCandidate[]> {
  const rows: PreviewCandidate[] = []
  const CHUNK = 1000
  for (let offset = 0; ; offset += CHUNK) {
    const { data } = await supabase
      .from("win_candidates")
      .select("id, listing_name_snapshot, reason_codes, evidence")
      .eq("run_id", runId)
      .order("priority_rank", { ascending: true })
      .range(offset, offset + CHUNK - 1)

    const page = data ?? []
    for (const row of page) {
      rows.push({
        id: row.id as string,
        listing_name: row.listing_name_snapshot as string,
        raw: rawInputsFromEvidence(row.evidence as WinEvidence, stalenessDays),
        staticReasonCodes: (row.reason_codes as string[]) ?? [],
      })
    }
    if (page.length < CHUNK) break
  }
  return rows
}
