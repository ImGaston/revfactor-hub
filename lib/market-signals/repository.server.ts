import type { SupabaseClient } from "@supabase/supabase-js"

import {
  marketSignalBriefOutputSchema,
  type MarketSignalBriefOutput,
} from "@/lib/market-signals/brief"

export class MarketSignalsPersistenceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MarketSignalsPersistenceUnavailableError"
  }
}

export type MarketSignalsMarketSummary = {
  id: string
  slug: string
  name: string
  status: "draft" | "active" | "inactive"
  managementMode: "agent" | "human"
  kind: "urban" | "destination" | "cabin" | "coastal" | "mixed"
  radiusMiles: number
  approvedListings: number
  proposedListings: number
  activeSources: number
  staleSources: number
  sources: MarketSignalsSourceSummary[]
  latestJob: MarketSignalsJobSummary | null
}

export type MarketSignalsJobSummary = {
  status: "queued" | "running" | "succeeded" | "failed"
  reason: "scheduled" | "manual" | "recovery" | "inventory_refresh"
  attempts: number
  createdAt: string
  completedAt: string | null
  durationMs: number | null
  error: string | null
}

export type MarketSignalsSourceSummary = {
  id: string
  type: string
  name: string
  isActive: boolean
  lastStatus: "ok" | "stale" | "rate_limited" | "error" | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  rowsRead: number | null
  rowsChanged: number | null
  lastError: string | null
}

export type MarketSignalsQueueItem = {
  id: string
  eventId: string
  marketId: string
  marketName: string
  title: string
  category: string
  state: string
  startAt: string
  endAt: string
  firstSeenAt: string
  lastSeenAt: string
  actionGate: "watch" | "review_now" | "unwind"
  materialityScore: number
  vulnerabilityScore: number | null
  evidenceFreshness: "current" | "stale" | "unknown"
  evidenceCount: number
  latestDecision: string | null
  latestDecisionAt: string | null
  latestDecisionReason: string | null
  adjustmentId: string | null
  evaluatedListings: number
  exposedListings: number
  topListings: MarketSignalsTopListing[]
  brief: MarketSignalsBrief | null
}

export type MarketSignalsBrief = {
  id: string
  status: "pending" | "completed" | "failed"
  modelId: string
  generatedAt: string | null
  error: string | null
  output: MarketSignalBriefOutput | null
}

export type MarketSignalsTopListing = {
  listingId: string
  name: string
  score: number
  occupancyPct: number
  marketOccupancyPct: number | null
  metricSource:
    | "pricelabs_rolling_7"
    | "pricelabs_rolling_30"
    | "report_builder_month"
}

export type MarketSignalsWorkspace = {
  persistence: "ready" | "unavailable"
  persistenceMessage: string | null
  generatedAt: string
  markets: MarketSignalsMarketSummary[]
  queue: MarketSignalsQueueItem[]
}

type MarketRow = {
  id: string
  slug: string
  name: string
  status: MarketSignalsMarketSummary["status"]
  management_mode: MarketSignalsMarketSummary["managementMode"]
  market_kind: MarketSignalsMarketSummary["kind"]
  radius_miles: number | string
}

type MembershipRow = {
  market_id: string
  membership_status: "proposed" | "approved" | "excluded"
}

type SourceRow = {
  id: string
  market_id: string | null
  source_type: string
  name: string
  is_active: boolean
  last_status: "ok" | "stale" | "rate_limited" | "error" | null
  last_attempt_at: string | null
  last_success_at: string | null
  last_rows_read: number | null
  last_rows_changed: number | null
  last_error: string | null
  cadence_minutes: number
}

type EventRelation = {
  id: string
  title: string
  category: string
  state: string
  start_at: string
  end_at: string
  first_seen_at: string
  last_seen_at: string
}

type MarketRelation = {
  id: string
  name: string
}

type ImpactRow = {
  id: string
  event_id: string
  market_id: string
  action_gate: MarketSignalsQueueItem["actionGate"]
  materiality_score: number | string
  vulnerability_score: number | string | null
  score_components: unknown
  evidence_freshness: MarketSignalsQueueItem["evidenceFreshness"]
  event: EventRelation | EventRelation[]
  market: MarketRelation | MarketRelation[]
}

type EvidenceRow = { event_id: string }

type ReviewRow = {
  impact_id: string
  decision: string
  reason: string
  brief_id: string | null
  adjustment_id: string | null
  created_at: string
}

type BriefRow = {
  id: string
  impact_id: string
  status: MarketSignalsBrief["status"]
  model_id: string
  output: unknown
  error_message: string | null
  generated_at: string | null
  created_at: string
}

type JobRow = {
  market_id: string
  status: MarketSignalsJobSummary["status"]
  reason: MarketSignalsJobSummary["reason"]
  attempts: number
  created_at: string
  completed_at: string | null
  duration_ms: number | null
  last_error: string | null
}

function relationOne<T>(relation: T | T[]) {
  return Array.isArray(relation) ? relation[0] : relation
}

function vulnerabilitySummary(value: unknown): {
  evaluatedListings: number
  exposedListings: number
  topListings: MarketSignalsTopListing[]
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { evaluatedListings: 0, exposedListings: 0, topListings: [] }
  }
  const vulnerability = (value as Record<string, unknown>).vulnerability
  if (
    !vulnerability ||
    typeof vulnerability !== "object" ||
    Array.isArray(vulnerability)
  ) {
    return { evaluatedListings: 0, exposedListings: 0, topListings: [] }
  }
  const summary = vulnerability as Record<string, unknown>
  const topListings = Array.isArray(summary.topListings)
    ? summary.topListings.flatMap((value): MarketSignalsTopListing[] => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return []
        }
        const row = value as Record<string, unknown>
        if (
          typeof row.listingId !== "string" ||
          typeof row.name !== "string" ||
          typeof row.score !== "number" ||
          typeof row.occupancyPct !== "number" ||
          ![
            "pricelabs_rolling_7",
            "pricelabs_rolling_30",
            "report_builder_month",
          ].includes(String(row.metricSource))
        ) {
          return []
        }
        return [
          {
            listingId: row.listingId,
            name: row.name,
            score: row.score,
            occupancyPct: row.occupancyPct,
            marketOccupancyPct:
              typeof row.marketOccupancyPct === "number"
                ? row.marketOccupancyPct
                : null,
            metricSource:
              row.metricSource as MarketSignalsTopListing["metricSource"],
          },
        ]
      })
    : []

  return {
    evaluatedListings:
      typeof summary.evaluatedListings === "number"
        ? summary.evaluatedListings
        : 0,
    exposedListings:
      typeof summary.exposedListings === "number" ? summary.exposedListings : 0,
    topListings,
  }
}

function unavailable(message: string): MarketSignalsWorkspace {
  return {
    persistence: "unavailable",
    persistenceMessage: message,
    generatedAt: new Date().toISOString(),
    markets: [],
    queue: [],
  }
}

function queryError(scope: string, message: string): never {
  if (
    message.includes("revenue_markets") ||
    message.includes("market_event_") ||
    message.includes("market_signal_reviews") ||
    message.includes("market_signal_briefs") ||
    message.includes("market_signal_jobs")
  ) {
    throw new MarketSignalsPersistenceUnavailableError(
      "Market Signals persistence is not applied yet. Review and apply migration 076 before enabling ingestion."
    )
  }
  throw new Error(`Failed to read ${scope}: ${message}`)
}

export async function getMarketSignalsWorkspace(
  supabase: SupabaseClient
): Promise<MarketSignalsWorkspace> {
  try {
    const marketsResult = await supabase
      .from("revenue_markets")
      .select(
        "id, slug, name, status, management_mode, market_kind, radius_miles"
      )
      .order("name")

    if (marketsResult.error) {
      queryError("Market Signals markets", marketsResult.error.message)
    }

    const [
      membershipsResult,
      sourcesResult,
      impactsResult,
      evidenceResult,
      reviewsResult,
      briefsResult,
      jobsResult,
    ] = await Promise.all([
      supabase
        .from("revenue_market_listings")
        .select("market_id, membership_status"),
      supabase.from("revenue_market_sources").select(
        `
            id, market_id, source_type, name, is_active, last_status,
            last_attempt_at, last_success_at, last_rows_read,
            last_rows_changed, last_error, cadence_minutes
          `
      ),
      supabase
        .from("market_event_impacts")
        .select(
          `
              id,
              event_id,
              market_id,
              action_gate,
              materiality_score,
              vulnerability_score,
              score_components,
              evidence_freshness,
              event:market_events!inner(
                id, title, category, state, start_at, end_at,
                first_seen_at, last_seen_at
              ),
              market:revenue_markets!inner(id, name)
            `
        )
        .eq("status", "active")
        .order("action_gate", { ascending: true })
        .order("vulnerability_score", {
          ascending: false,
          nullsFirst: false,
        })
        .order("materiality_score", { ascending: false })
        .order("impact_start", { ascending: true })
        .limit(300),
      supabase.from("market_event_evidence").select("event_id"),
      supabase
        .from("market_signal_reviews")
        .select(
          "impact_id, decision, reason, brief_id, adjustment_id, created_at"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("market_signal_briefs")
        .select(
          "id, impact_id, status, model_id, output, error_message, generated_at, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("market_signal_jobs")
        .select(
          "market_id, status, reason, attempts, created_at, completed_at, duration_ms, last_error"
        )
        .order("created_at", { ascending: false })
        .limit(500),
    ])

    for (const [scope, result] of [
      ["market memberships", membershipsResult],
      ["market sources", sourcesResult],
      ["market event impacts", impactsResult],
      ["market event evidence", evidenceResult],
      ["market reviews", reviewsResult],
      ["Signal Briefs", briefsResult],
      ["Market Signal jobs", jobsResult],
    ] as const) {
      if (result.error) queryError(scope, result.error.message)
    }

    const memberships = (membershipsResult.data ?? []) as MembershipRow[]
    const sources = (sourcesResult.data ?? []) as SourceRow[]
    const evidence = (evidenceResult.data ?? []) as EvidenceRow[]
    const reviews = (reviewsResult.data ?? []) as ReviewRow[]
    const briefs = (briefsResult.data ?? []) as BriefRow[]
    const jobs = (jobsResult.data ?? []) as JobRow[]
    const evidenceCounts = new Map<string, number>()
    const latestReviews = new Map<string, ReviewRow>()
    const latestBriefs = new Map<string, BriefRow>()
    const latestJobs = new Map<string, JobRow>()

    for (const row of evidence) {
      evidenceCounts.set(
        row.event_id,
        (evidenceCounts.get(row.event_id) ?? 0) + 1
      )
    }
    for (const review of reviews) {
      if (!latestReviews.has(review.impact_id)) {
        latestReviews.set(review.impact_id, review)
      }
    }
    for (const brief of briefs) {
      if (!latestBriefs.has(brief.impact_id)) {
        latestBriefs.set(brief.impact_id, brief)
      }
    }
    for (const job of jobs) {
      if (!latestJobs.has(job.market_id)) latestJobs.set(job.market_id, job)
    }

    const markets = ((marketsResult.data ?? []) as MarketRow[]).map(
      (market) => {
        const marketMemberships = memberships.filter(
          (membership) => membership.market_id === market.id
        )
        const marketSources = sources.filter(
          (source) => source.market_id === market.id
        )
        const latestJob = latestJobs.get(market.id)
        const sourceSummaries = marketSources.map((source) => ({
          id: source.id,
          type: source.source_type,
          name: source.name,
          isActive: source.is_active,
          lastStatus: source.last_status,
          lastAttemptAt: source.last_attempt_at,
          lastSuccessAt: source.last_success_at,
          rowsRead: source.last_rows_read,
          rowsChanged: source.last_rows_changed,
          lastError: source.last_error,
        }))
        return {
          id: market.id,
          slug: market.slug,
          name: market.name,
          status: market.status,
          managementMode: market.management_mode,
          kind: market.market_kind,
          radiusMiles: Number(market.radius_miles),
          approvedListings: marketMemberships.filter(
            (membership) => membership.membership_status === "approved"
          ).length,
          proposedListings: marketMemberships.filter(
            (membership) => membership.membership_status === "proposed"
          ).length,
          activeSources: marketSources.filter((source) => source.is_active)
            .length,
          staleSources: marketSources.filter(
            (source) =>
              source.is_active &&
              (source.last_status !== "ok" ||
                source.last_success_at == null ||
                Date.now() - new Date(source.last_success_at).getTime() >
                  source.cadence_minutes * 2 * 60_000)
          ).length,
          sources: sourceSummaries,
          latestJob: latestJob
            ? {
                status: latestJob.status,
                reason: latestJob.reason,
                attempts: latestJob.attempts,
                createdAt: latestJob.created_at,
                completedAt: latestJob.completed_at,
                durationMs: latestJob.duration_ms,
                error: latestJob.last_error,
              }
            : null,
        }
      }
    )

    const queue = ((impactsResult.data ?? []) as unknown as ImpactRow[])
      .map((impact): MarketSignalsQueueItem | null => {
        const event = relationOne(impact.event)
        const market = relationOne(impact.market)
        if (!event || !market) return null
        const latestReview = latestReviews.get(impact.id)
        const latestBrief = latestBriefs.get(impact.id)
        const currentReview =
          latestReview?.brief_id != null &&
          latestReview.brief_id === latestBrief?.id
            ? latestReview
            : null
        const parsedBrief = marketSignalBriefOutputSchema.safeParse(
          latestBrief?.output
        )
        const vulnerability = vulnerabilitySummary(impact.score_components)
        return {
          id: impact.id,
          eventId: event.id,
          marketId: market.id,
          marketName: market.name,
          title: event.title,
          category: event.category,
          state: event.state,
          startAt: event.start_at,
          endAt: event.end_at,
          firstSeenAt: event.first_seen_at,
          lastSeenAt: event.last_seen_at,
          actionGate: impact.action_gate,
          materialityScore: Number(impact.materiality_score),
          vulnerabilityScore:
            impact.vulnerability_score == null
              ? null
              : Number(impact.vulnerability_score),
          evidenceFreshness: impact.evidence_freshness,
          evidenceCount: evidenceCounts.get(event.id) ?? 0,
          latestDecision: currentReview?.decision ?? null,
          latestDecisionAt: currentReview?.created_at ?? null,
          latestDecisionReason: currentReview?.reason ?? null,
          adjustmentId: currentReview?.adjustment_id ?? null,
          evaluatedListings: vulnerability.evaluatedListings,
          exposedListings: vulnerability.exposedListings,
          topListings: vulnerability.topListings,
          brief: latestBrief
            ? {
                id: latestBrief.id,
                status: latestBrief.status,
                modelId: latestBrief.model_id,
                generatedAt: latestBrief.generated_at,
                error: latestBrief.error_message,
                output: parsedBrief.success ? parsedBrief.data : null,
              }
            : null,
        }
      })
      .filter((item): item is MarketSignalsQueueItem => item !== null)

    return {
      persistence: "ready",
      persistenceMessage: null,
      generatedAt: new Date().toISOString(),
      markets,
      queue,
    }
  } catch (error) {
    if (error instanceof MarketSignalsPersistenceUnavailableError) {
      return unavailable(error.message)
    }
    throw error
  }
}
