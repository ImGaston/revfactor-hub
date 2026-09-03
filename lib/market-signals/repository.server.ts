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
  stateLabels: string[]
  localityLabels: string[]
  approvedListings: number
  proposedListings: number
  activeSources: number
  staleSources: number
  sources: MarketSignalsSourceSummary[]
  latestJob: MarketSignalsJobSummary | null
}

export type MarketSignalsFoundationSource = {
  key: string
  name: string
  providerClass:
    | "official"
    | "structured_provider"
    | "aggregator"
    | "discovery"
    | "reference"
  status:
    | "research"
    | "credentials_pending"
    | "pilot"
    | "active"
    | "reference_only"
    | "disabled"
}

export type MarketSignalsFoundationSummary = {
  available: boolean
  primaryAssignments: number
  unmappedActiveListings: number
  stateCount: number
  localityCount: number
  openMarketProposals: number
  sourceCatalog: MarketSignalsFoundationSource[]
  dueDateWatches: number
  pendingConditionalEvents: number
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
  sourceUrl: string | null
  isActive: boolean
  lastStatus: "ok" | "stale" | "rate_limited" | "error" | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  rowsRead: number | null
  rowsChanged: number | null
  lastError: string | null
}

export type MarketSignalsUniversitySummary = {
  id: string
  slug: string
  name: string
  officialDomain: string
  city: string
  region: string
  marketId: string | null
  marketName: string | null
  relevanceStatus: "active" | "watch" | "excluded"
  distanceMiles: number | null
  eventTypes: string[]
  demandRationale: string
  sources: Array<{
    id: string
    name: string
    sourceUrl: string | null
    eventTypes: string[]
    sourceRole: "canonical" | "corroborating" | null
    isActive: boolean
  }>
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

export type MarketSignalsRecoveryItem = {
  eventId: string
  title: string
  category: string
  state: string
  startAt: string
  endAt: string
  city: string
  region: string | null
  countryCode: string
  predictHQFirstObservedAt: string
  predictHQLastObservedAt: string
  sourceTypes: string[]
  replacementSourceTypes: string[]
  marketNames: string[]
  status: "pending" | "recovered"
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
  universities: MarketSignalsUniversitySummary[]
  queue: MarketSignalsQueueItem[]
  predictHQRecovery: MarketSignalsRecoveryItem[]
  foundation: MarketSignalsFoundationSummary
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

type SourceInstitutionRow = {
  id: string
  institution_id: string | null
}

type AssignmentAuditRow = {
  listing_id: string
  approved_primary_count: number | string
}

type StateRow = {
  id: string
  code: string
  name: string
}

type MarketStateRow = {
  market_id: string
  state_id: string
  relationship_type: "primary" | "secondary"
}

type LocalityRow = {
  market_id: string
  state_id: string
  name: string
}

type MarketProposalRow = { id: string }

type SourceCatalogRow = {
  provider_key: string
  name: string
  provider_class: MarketSignalsFoundationSource["providerClass"]
  implementation_status: MarketSignalsFoundationSource["status"]
}

type FoundationIdRow = { id: string }

type SourceRow = {
  id: string
  market_id: string | null
  institution_id: string | null
  source_type: string
  name: string
  source_url: string | null
  query_config: unknown
  is_active: boolean
  last_status: "ok" | "stale" | "rate_limited" | "error" | null
  last_attempt_at: string | null
  last_success_at: string | null
  last_rows_read: number | null
  last_rows_changed: number | null
  last_error: string | null
  cadence_minutes: number
}

type InstitutionRow = {
  id: string
  slug: string
  name: string
  official_domain: string
  city: string
  region: string
}

type MarketInstitutionRow = {
  market_id: string
  institution_id: string
  relevance_status: MarketSignalsUniversitySummary["relevanceStatus"]
  distance_miles: number | string | null
  event_types: string[]
  demand_rationale: string
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

type RecoveryRow = {
  event_id: string
  title: string
  category: string
  state: string
  start_at: string
  end_at: string
  city: string
  region: string | null
  country_code: string
  predicthq_first_observed_at: string
  predicthq_last_observed_at: string
  source_types: string[]
  replacement_source_types: string[]
  market_names: string[]
  recovery_status: MarketSignalsRecoveryItem["status"]
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
    universities: [],
    queue: [],
    predictHQRecovery: [],
    foundation: {
      available: false,
      primaryAssignments: 0,
      unmappedActiveListings: 0,
      stateCount: 0,
      localityCount: 0,
      openMarketProposals: 0,
      sourceCatalog: [],
      dueDateWatches: 0,
      pendingConditionalEvents: 0,
    },
  }
}

type OptionalQueryResult<T> = {
  data: T[] | null
  error: { code?: string; message: string } | null
}

function optionalRows<T>(scope: string, result: OptionalQueryResult<T>) {
  if (!result.error) {
    return { available: true, rows: result.data ?? [] }
  }

  const unavailableCodes = new Set(["42P01", "42703", "PGRST204", "PGRST205"])
  if (
    unavailableCodes.has(result.error.code ?? "") ||
    /does not exist|schema cache|could not find/i.test(result.error.message)
  ) {
    return { available: false, rows: [] as T[] }
  }

  throw new Error(`Failed to read ${scope}: ${result.error.message}`)
}

function queryError(scope: string, message: string): never {
  if (
    message.includes("revenue_markets") ||
    message.includes("revenue_market_institutions") ||
    message.includes("market_signal_institutions") ||
    message.includes("market_event_") ||
    message.includes("market_signal_reviews") ||
    message.includes("market_signal_briefs") ||
    message.includes("market_signal_jobs")
  ) {
    throw new MarketSignalsPersistenceUnavailableError(
      "Market Signals persistence is not current. Review and apply the pending Market Signals migrations before enabling ingestion."
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

    const nowIso = new Date().toISOString()
    const [
      membershipsResult,
      sourcesResult,
      sourceInstitutionsResult,
      institutionsResult,
      marketInstitutionsResult,
      impactsResult,
      evidenceResult,
      reviewsResult,
      briefsResult,
      jobsResult,
      recoveryResult,
      assignmentAuditResult,
      statesResult,
      marketStatesResult,
      localitiesResult,
      marketProposalsResult,
      sourceCatalogResult,
      dateWatchesResult,
      eventConditionsResult,
    ] = await Promise.all([
      supabase
        .from("revenue_market_listings")
        .select("market_id, membership_status"),
      supabase.from("revenue_market_sources").select(
        `
            id, market_id, source_type, name, source_url,
            query_config, is_active, last_status,
            last_attempt_at, last_success_at, last_rows_read,
            last_rows_changed, last_error, cadence_minutes
          `
      ),
      supabase.from("revenue_market_sources").select("id, institution_id"),
      supabase
        .from("market_signal_institutions")
        .select("id, slug, name, official_domain, city, region")
        .eq("status", "active")
        .order("name"),
      supabase
        .from("revenue_market_institutions")
        .select(
          "market_id, institution_id, relevance_status, distance_miles, event_types, demand_rationale"
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
      supabase
        .from("market_event_source_recovery")
        .select(
          `
            event_id, title, category, state, start_at, end_at, city, region,
            country_code, predicthq_first_observed_at,
            predicthq_last_observed_at, source_types,
            replacement_source_types, market_names, recovery_status
          `
        )
        .order("recovery_status", { ascending: true })
        .order("start_at", { ascending: true })
        .limit(1000),
      supabase
        .from("market_listing_assignment_audit")
        .select("listing_id, approved_primary_count")
        .limit(5000),
      supabase
        .from("revenue_market_states")
        .select("id, code, name")
        .eq("status", "active")
        .order("name"),
      supabase
        .from("revenue_market_state_memberships")
        .select("market_id, state_id, relationship_type"),
      supabase
        .from("revenue_market_localities")
        .select("market_id, state_id, name")
        .eq("status", "active")
        .order("name"),
      supabase
        .from("revenue_market_proposals")
        .select("id")
        .in("status", ["draft", "needs_review", "approved"])
        .limit(5000),
      supabase
        .from("market_signal_source_catalog")
        .select("provider_key, name, provider_class, implementation_status")
        .order("name"),
      supabase
        .from("market_event_series_watches")
        .select("id")
        .eq("date_status", "unknown")
        .lte("next_check_at", nowIso)
        .limit(5000),
      supabase
        .from("market_event_conditions")
        .select("id")
        .eq("lifecycle_status", "pending")
        .limit(5000),
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

    const sourceInstitutionLinks = optionalRows<SourceInstitutionRow>(
      "source institution links",
      sourceInstitutionsResult
    )
    const institutionRegistry = optionalRows<InstitutionRow>(
      "university registry",
      institutionsResult
    )
    const marketInstitutionRegistry = optionalRows<MarketInstitutionRow>(
      "market university mappings",
      marketInstitutionsResult
    )
    const recoveryCoverage = optionalRows<RecoveryRow>(
      "PredictHQ recovery coverage",
      recoveryResult
    )
    const assignmentAudit = optionalRows<AssignmentAuditRow>(
      "market assignment audit",
      assignmentAuditResult
    )
    const stateRegistry = optionalRows<StateRow>(
      "market state registry",
      statesResult
    )
    const marketStateRegistry = optionalRows<MarketStateRow>(
      "market state memberships",
      marketStatesResult
    )
    const localityRegistry = optionalRows<LocalityRow>(
      "market locality registry",
      localitiesResult
    )
    const marketProposals = optionalRows<MarketProposalRow>(
      "market proposals",
      marketProposalsResult
    )
    const sourceCatalog = optionalRows<SourceCatalogRow>(
      "source catalog",
      sourceCatalogResult
    )
    const dueDateWatches = optionalRows<FoundationIdRow>(
      "recurring date watches",
      dateWatchesResult
    )
    const pendingEventConditions = optionalRows<FoundationIdRow>(
      "conditional events",
      eventConditionsResult
    )

    const memberships = (membershipsResult.data ?? []) as MembershipRow[]
    const institutionBySource = new Map(
      sourceInstitutionLinks.rows.map((row) => [row.id, row.institution_id])
    )
    const sources = (
      (sourcesResult.data ?? []) as Omit<SourceRow, "institution_id">[]
    ).map(
      (source): SourceRow => ({
        ...source,
        institution_id: institutionBySource.get(source.id) ?? null,
      })
    )
    const institutions = institutionRegistry.rows
    const marketInstitutions = marketInstitutionRegistry.rows
    const evidence = (evidenceResult.data ?? []) as EvidenceRow[]
    const reviews = (reviewsResult.data ?? []) as ReviewRow[]
    const briefs = (briefsResult.data ?? []) as BriefRow[]
    const jobs = (jobsResult.data ?? []) as JobRow[]
    const predictHQRecovery = recoveryCoverage.rows.map((item) => ({
      eventId: item.event_id,
      title: item.title,
      category: item.category,
      state: item.state,
      startAt: item.start_at,
      endAt: item.end_at,
      city: item.city,
      region: item.region,
      countryCode: item.country_code,
      predictHQFirstObservedAt: item.predicthq_first_observed_at,
      predictHQLastObservedAt: item.predicthq_last_observed_at,
      sourceTypes: item.source_types,
      replacementSourceTypes: item.replacement_source_types,
      marketNames: item.market_names,
      status: item.recovery_status,
    }))
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

    const stateById = new Map(
      stateRegistry.rows.map((state) => [state.id, state])
    )
    const stateLabelsByMarket = new Map<string, string[]>()
    for (const membership of [...marketStateRegistry.rows].sort(
      (left, right) => {
        if (left.relationship_type !== right.relationship_type) {
          return left.relationship_type === "primary" ? -1 : 1
        }
        return (stateById.get(left.state_id)?.name ?? "").localeCompare(
          stateById.get(right.state_id)?.name ?? ""
        )
      }
    )) {
      const state = stateById.get(membership.state_id)
      if (!state) continue
      const labels = stateLabelsByMarket.get(membership.market_id) ?? []
      labels.push(state.code)
      stateLabelsByMarket.set(membership.market_id, labels)
    }

    const localityLabelsByMarket = new Map<string, string[]>()
    for (const locality of localityRegistry.rows) {
      const state = stateById.get(locality.state_id)
      const labels = localityLabelsByMarket.get(locality.market_id) ?? []
      labels.push(state ? `${locality.name}, ${state.code}` : locality.name)
      localityLabelsByMarket.set(locality.market_id, labels)
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
          sourceUrl: source.source_url,
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
          stateLabels: stateLabelsByMarket.get(market.id) ?? [],
          localityLabels: localityLabelsByMarket.get(market.id) ?? [],
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

    const marketNames = new Map(
      markets.map((market) => [market.id, market.name])
    )
    const universities = institutions
      .flatMap((institution): MarketSignalsUniversitySummary[] => {
        const institutionSources = sources
          .filter(
            (source) =>
              source.institution_id === institution.id &&
              source.source_type === "official_feed"
          )
          .map((source): MarketSignalsUniversitySummary["sources"][number] => {
            const queryConfig =
              source.query_config &&
              typeof source.query_config === "object" &&
              !Array.isArray(source.query_config)
                ? (source.query_config as Record<string, unknown>)
                : {}
            return {
              id: source.id,
              name: source.name,
              sourceUrl: source.source_url,
              eventTypes: Array.isArray(queryConfig.event_types)
                ? queryConfig.event_types.filter(
                    (value): value is string => typeof value === "string"
                  )
                : [],
              sourceRole:
                queryConfig.source_role === "canonical" ||
                queryConfig.source_role === "corroborating"
                  ? queryConfig.source_role
                  : null,
              isActive: source.is_active,
            }
          })

        const mappings = marketInstitutions.filter(
          (mapping) => mapping.institution_id === institution.id
        )
        if (mappings.length === 0) {
          return [
            {
              id: institution.id,
              slug: institution.slug,
              name: institution.name,
              officialDomain: institution.official_domain,
              city: institution.city,
              region: institution.region,
              marketId: null,
              marketName: null,
              relevanceStatus: "watch",
              distanceMiles: null,
              eventTypes: Array.from(
                new Set(
                  institutionSources.flatMap((source) => source.eventTypes)
                )
              ),
              demandRationale:
                "Institution sources are registered, but its revenue market proposal still requires review.",
              sources: institutionSources,
            },
          ]
        }

        return mappings.flatMap((mapping) => {
          const marketName = marketNames.get(mapping.market_id)
          if (!marketName) return []
          return [
            {
              id: institution.id,
              slug: institution.slug,
              name: institution.name,
              officialDomain: institution.official_domain,
              city: institution.city,
              region: institution.region,
              marketId: mapping.market_id,
              marketName,
              relevanceStatus: mapping.relevance_status,
              distanceMiles:
                mapping.distance_miles == null
                  ? null
                  : Number(mapping.distance_miles),
              eventTypes: mapping.event_types,
              demandRationale: mapping.demand_rationale,
              sources: institutionSources,
            },
          ]
        })
      })
      .sort((left, right) => left.name.localeCompare(right.name))

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

    const foundationAvailable = [
      assignmentAudit,
      stateRegistry,
      marketStateRegistry,
      localityRegistry,
      marketProposals,
      sourceCatalog,
      dueDateWatches,
      pendingEventConditions,
    ].every((result) => result.available)

    const foundation: MarketSignalsFoundationSummary = {
      available: foundationAvailable,
      primaryAssignments: assignmentAudit.rows.filter(
        (row) => Number(row.approved_primary_count) === 1
      ).length,
      unmappedActiveListings: assignmentAudit.rows.filter(
        (row) => Number(row.approved_primary_count) === 0
      ).length,
      stateCount: new Set(
        marketStateRegistry.rows.map((membership) => membership.state_id)
      ).size,
      localityCount: localityRegistry.rows.length,
      openMarketProposals: marketProposals.rows.length,
      sourceCatalog: sourceCatalog.rows.map((source) => ({
        key: source.provider_key,
        name: source.name,
        providerClass: source.provider_class,
        status: source.implementation_status,
      })),
      dueDateWatches: dueDateWatches.rows.length,
      pendingConditionalEvents: pendingEventConditions.rows.length,
    }

    return {
      persistence: "ready",
      persistenceMessage: null,
      generatedAt: new Date().toISOString(),
      markets,
      universities,
      queue,
      predictHQRecovery,
      foundation,
    }
  } catch (error) {
    if (error instanceof MarketSignalsPersistenceUnavailableError) {
      return unavailable(error.message)
    }
    throw error
  }
}
