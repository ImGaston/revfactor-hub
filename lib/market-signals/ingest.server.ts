import "server-only"

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  normalizedProviderEventSchema,
  type MarketEventState,
} from "@/lib/market-signals/contracts"
import {
  calculateMaterialityScore,
  canonicalEventFingerprint,
  classifyEventChange,
  determineActionGate,
  distanceMiles,
  eventFamilyKey,
  shouldRetainProviderCandidate,
} from "@/lib/market-signals/domain"
import {
  fetchPredictHQEvents,
  normalizePredictHQEvent,
  parsePredictHQQueryConfig,
  PredictHQRequestError,
  type PredictHQCandidate,
  type PredictHQMarket,
} from "@/lib/market-signals/predicthq"
import { generateMarketSignalBriefsForMarket } from "@/lib/market-signals/briefs.server"
import { scoreMarketVulnerability } from "@/lib/market-signals/vulnerability.server"

type SourceRow = {
  id: string
  market_id: string
  source_type: "predicthq"
  query_config: unknown
  high_water_mark: string | null
  market: MarketRow | MarketRow[]
}

type MarketRow = {
  id: string
  name: string
  country_code: string
  timezone: string
  center_lat: number | string
  center_lon: number | string
  radius_miles: number | string
  market_kind: PredictHQMarket["kind"]
  status: "draft" | "active" | "inactive"
}

type ProviderRecordRow = {
  id: string
  event_id: string
  content_hash: string
  normalized_fields: unknown
}

type EventRow = {
  id: string
  canonical_fingerprint: string
  state: MarketEventState
}

export type MarketSignalSyncResult = {
  sourceId: string
  marketId: string
  marketName: string
  rowsRead: number
  rowsChanged: number
  dedupeCount: number
  retainedCount: number
  overflow: boolean
  impactsScored: number
  listingExposuresScored: number
  needsReview: number
  briefsGenerated: number
  briefsCached: number
  briefsFailed: number
  briefError: string | null
}

export type MarketSignalsRuntimeStatus = {
  serviceRoleConfigured: boolean
  predictHQConfigured: boolean
  ready: boolean
}

function relationOne<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export function getMarketSignalsRuntimeStatus(): MarketSignalsRuntimeStatus {
  const serviceRoleConfigured = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  )
  const predictHQConfigured = Boolean(
    process.env.PREDICTHQ_ACCESS_TOKEN?.trim()
  )
  return {
    serviceRoleConfigured,
    predictHQConfigured,
    ready: serviceRoleConfigured && predictHQConfigured,
  }
}

function contentHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function marketFromRow(row: MarketRow): PredictHQMarket {
  return {
    id: row.id,
    name: row.name,
    countryCode: row.country_code,
    timezone: row.timezone,
    centerLat: Number(row.center_lat),
    centerLon: Number(row.center_lon),
    radiusMiles: Number(row.radius_miles),
    kind: row.market_kind,
  }
}

function providerState(candidate: PredictHQCandidate): MarketEventState {
  const status = candidate.providerState.toLowerCase()
  if (/cancel/.test(status)) return "canceled"
  if (/postpon/.test(status)) return "postponed"
  if (/deleted|duplicate|spam/.test(status)) return "superseded"
  if (/predicted/.test(status)) return "candidate"
  return "verified"
}

function verificationState(candidate: PredictHQCandidate) {
  const state = providerState(candidate)
  if (state === "verified") return "verified" as const
  if (state === "canceled" || state === "postponed") {
    return "corroborating" as const
  }
  return "unverified" as const
}

function normalizedSnapshot(candidate: PredictHQCandidate) {
  return {
    ...candidate.normalized,
    providerState: candidate.providerState,
    rank: candidate.rank,
    accommodationSpend: candidate.accommodationSpend,
    impactStart: candidate.impactStart,
    impactEnd: candidate.impactEnd,
  }
}

async function nextVersion(supabase: SupabaseClient, eventId: string) {
  const { data, error } = await supabase
    .from("market_event_versions")
    .select("version")
    .eq("event_id", eventId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to read event version: ${error.message}`)
  return Number(data?.version ?? 0) + 1
}

async function findEvent(
  supabase: SupabaseClient,
  provider: ProviderRecordRow | null,
  fingerprint: string
) {
  if (provider) {
    const { data, error } = await supabase
      .from("market_events")
      .select("id, canonical_fingerprint, state")
      .eq("id", provider.event_id)
      .maybeSingle()
    if (error)
      throw new Error(`Failed to read canonical event: ${error.message}`)
    return (data ?? null) as EventRow | null
  }

  const { data, error } = await supabase
    .from("market_events")
    .select("id, canonical_fingerprint, state")
    .eq("canonical_fingerprint", fingerprint)
    .maybeSingle()
  if (error) throw new Error(`Failed to deduplicate event: ${error.message}`)
  return (data ?? null) as EventRow | null
}

async function persistCandidate(input: {
  supabase: SupabaseClient
  sourceId: string
  market: PredictHQMarket
  candidate: PredictHQCandidate
  observedAt: string
}) {
  const { supabase, sourceId, market, candidate, observedAt } = input
  const normalized = candidate.normalized
  const fingerprint = canonicalEventFingerprint(normalized)
  const snapshot = normalizedSnapshot(candidate)
  const hash = contentHash(snapshot)
  const { data: providerData, error: providerError } = await supabase
    .from("market_event_provider_records")
    .select("id, event_id, content_hash, normalized_fields")
    .eq("source_id", sourceId)
    .eq("external_id", normalized.externalId)
    .maybeSingle()
  if (providerError) {
    throw new Error(`Failed to read provider record: ${providerError.message}`)
  }

  const provider = (providerData ?? null) as ProviderRecordRow | null
  const priorNormalized = provider
    ? normalizedProviderEventSchema.safeParse(provider.normalized_fields)
    : null
  const classifiedChange = classifyEventChange(
    priorNormalized?.success ? priorNormalized.data : null,
    normalized
  )
  const changeType =
    classifiedChange === "unchanged" && provider?.content_hash !== hash
      ? "details_changed"
      : classifiedChange
  const unchanged =
    provider?.content_hash === hash && changeType === "unchanged"
  let event = await findEvent(supabase, provider, fingerprint)
  let created = false

  if (!event) {
    const { data, error } = await supabase
      .from("market_events")
      .insert({
        canonical_fingerprint: fingerprint,
        family_key: eventFamilyKey(normalized.title),
        title: normalized.title,
        category: normalized.category,
        start_at: normalized.startDate,
        end_at: normalized.endDate,
        timezone: normalized.timezone,
        venue_name: normalized.venueName,
        city: normalized.city,
        region: normalized.region,
        country_code: normalized.countryCode,
        latitude: normalized.latitude,
        longitude: normalized.longitude,
        state: providerState(candidate),
        first_seen_at: normalized.firstSeenAt,
        last_seen_at: observedAt,
      })
      .select("id, canonical_fingerprint, state")
      .single()
    if (error)
      throw new Error(`Failed to create canonical event: ${error.message}`)
    event = data as EventRow
    created = true
  } else if (!unchanged) {
    const { error } = await supabase
      .from("market_events")
      .update({
        title: normalized.title,
        category: normalized.category,
        start_at: normalized.startDate,
        end_at: normalized.endDate,
        timezone: normalized.timezone,
        venue_name: normalized.venueName,
        city: normalized.city,
        region: normalized.region,
        country_code: normalized.countryCode,
        latitude: normalized.latitude,
        longitude: normalized.longitude,
        state: providerState(candidate),
        last_seen_at: observedAt,
      })
      .eq("id", event.id)
    if (error)
      throw new Error(`Failed to update canonical event: ${error.message}`)
  } else {
    const { error } = await supabase
      .from("market_events")
      .update({ last_seen_at: observedAt })
      .eq("id", event.id)
    if (error)
      throw new Error(`Failed to observe canonical event: ${error.message}`)
  }

  if (created || (!unchanged && changeType !== "unchanged")) {
    const version = await nextVersion(supabase, event.id)
    const storedChangeType = created
      ? "new"
      : provider
        ? changeType
        : "details_changed"
    const { error } = await supabase.from("market_event_versions").insert({
      event_id: event.id,
      version,
      change_type: storedChangeType,
      before_snapshot: provider?.normalized_fields ?? null,
      after_snapshot: snapshot,
      detected_at: observedAt,
    })
    if (error)
      throw new Error(`Failed to append event version: ${error.message}`)
  }

  const providerValues = {
    event_id: event.id,
    source_id: sourceId,
    external_id: normalized.externalId,
    source_url: normalized.sourceUrl,
    provider_status: normalized.providerStatus,
    provider_first_seen_at: normalized.firstSeenAt,
    provider_updated_at: normalized.updatedAt,
    last_observed_at: observedAt,
    content_hash: hash,
    normalized_fields: normalized,
    raw_retained_until: null,
  }
  const providerMutation = provider
    ? await supabase
        .from("market_event_provider_records")
        .update(providerValues)
        .eq("id", provider.id)
    : await supabase.from("market_event_provider_records").insert({
        ...providerValues,
        first_observed_at: observedAt,
      })
  if (providerMutation.error) {
    throw new Error(
      `Failed to persist provider record: ${providerMutation.error.message}`
    )
  }

  if (!unchanged && normalized.sourceUrl) {
    const { error } = await supabase.from("market_event_evidence").upsert(
      {
        event_id: event.id,
        source_id: sourceId,
        evidence_url: normalized.sourceUrl,
        publisher: "PredictHQ",
        published_at: normalized.updatedAt,
        observed_at: observedAt,
        authority_tier: 2,
        extraction_confidence: 1,
        verification_state: verificationState(candidate),
        evidence_summary: `${normalized.title} is ${candidate.providerState} in the PredictHQ Events feed.`,
        content_hash: hash,
      },
      { onConflict: "event_id,evidence_url,content_hash" }
    )
    if (error)
      throw new Error(`Failed to append event evidence: ${error.message}`)
  }

  const eventDistance =
    normalized.latitude == null || normalized.longitude == null
      ? null
      : distanceMiles(
          { latitude: market.centerLat, longitude: market.centerLon },
          { latitude: normalized.latitude, longitude: normalized.longitude }
        )
  const materialityScore = calculateMaterialityScore({
    attendance: normalized.attendance,
    localRank: normalized.localRank,
    rank: candidate.rank,
    accommodationSpend: candidate.accommodationSpend,
    category: normalized.category,
    marketKind: market.kind,
    distanceMiles: eventDistance,
    radiusMiles: market.radiusMiles,
  })

  if (
    !shouldRetainProviderCandidate({
      providerStatus: candidate.providerState,
      materialityScore,
    })
  ) {
    const { error } = await supabase
      .from("market_event_impacts")
      .update({ status: "inactive", action_gate: "watch" })
      .eq("event_id", event.id)
      .eq("market_id", market.id)
    if (error)
      throw new Error(`Failed to retire market impact: ${error.message}`)
    return {
      changed: created || !unchanged,
      retained: false,
      deduped: !created,
    }
  }

  const state = providerState(candidate)
  const gate = determineActionGate({
    state,
    verificationState: verificationState(candidate),
    authorityTier: 2,
    corroborationCount: 1,
    materialityScore,
    vulnerabilityScore: null,
    evidenceFreshness: "current",
  })
  const { error: impactError } = await supabase
    .from("market_event_impacts")
    .upsert(
      {
        event_id: event.id,
        market_id: market.id,
        impact_start: candidate.impactStart,
        impact_end: candidate.impactEnd,
        distance_miles:
          eventDistance == null ? null : Math.round(eventDistance * 100) / 100,
        predicted_attendance: normalized.attendance,
        local_rank: normalized.localRank,
        materiality_score: materialityScore,
        vulnerability_score: null,
        action_gate: gate,
        score_components: {
          attendance: normalized.attendance,
          localRank: normalized.localRank,
          rank: candidate.rank,
          accommodationSpend: candidate.accommodationSpend,
          marketKind: market.kind,
        },
        evidence_freshness: "current",
        status: "active",
      },
      { onConflict: "event_id,market_id" }
    )
  if (impactError) {
    throw new Error(`Failed to persist market impact: ${impactError.message}`)
  }

  return { changed: created || !unchanged, retained: true, deduped: !created }
}

async function syncPredictHQSource(
  supabase: SupabaseClient,
  source: SourceRow
): Promise<MarketSignalSyncResult> {
  const marketRow = relationOne(source.market)
  if (!marketRow || marketRow.status !== "active") {
    throw new Error("Market Signals only syncs active managed markets")
  }
  const token = requiredEnvironment("PREDICTHQ_ACCESS_TOKEN")
  const market = marketFromRow(marketRow)
  const startedAt = new Date().toISOString()

  await supabase
    .from("revenue_market_sources")
    .update({ last_attempt_at: startedAt })
    .eq("id", source.id)

  try {
    const response = await fetchPredictHQEvents({
      token,
      market,
      queryConfig: parsePredictHQQueryConfig(source.query_config),
      highWaterMark: source.high_water_mark,
    })
    let rowsChanged = 0
    let dedupeCount = 0
    let retainedCount = 0

    const persistenceConcurrency = 6
    for (
      let offset = 0;
      offset < response.events.length;
      offset += persistenceConcurrency
    ) {
      const results = await Promise.all(
        response.events
          .slice(offset, offset + persistenceConcurrency)
          .map((rawEvent) =>
            persistCandidate({
              supabase,
              sourceId: source.id,
              market,
              candidate: normalizePredictHQEvent(rawEvent, market),
              observedAt: startedAt,
            })
          )
      )
      for (const result of results) {
        if (result.changed) rowsChanged += 1
        if (result.deduped) dedupeCount += 1
        if (result.retained) retainedCount += 1
      }
    }

    const vulnerability = await scoreMarketVulnerability(
      supabase,
      market.id,
      new Date()
    )
    let briefError: string | null = null
    const briefs = await generateMarketSignalBriefsForMarket(
      supabase,
      market.id
    ).catch((error) => {
      briefError =
        error instanceof Error ? error.message : "Unknown brief error"
      return []
    })

    const { error } = await supabase
      .from("revenue_market_sources")
      .update({
        high_water_mark: startedAt,
        last_success_at: new Date().toISOString(),
        last_status: "ok",
        last_error: response.overflow
          ? "PredictHQ reported subscription overflow; narrow the market query if material events appear truncated."
          : null,
        last_rows_read: response.events.length,
        last_rows_changed: rowsChanged,
        last_dedupe_count: dedupeCount,
      })
      .eq("id", source.id)
    if (error)
      throw new Error(`Failed to update source health: ${error.message}`)

    return {
      sourceId: source.id,
      marketId: market.id,
      marketName: market.name,
      rowsRead: response.events.length,
      rowsChanged,
      dedupeCount,
      retainedCount,
      overflow: response.overflow,
      impactsScored: vulnerability.impactsScored,
      listingExposuresScored: vulnerability.listingExposuresScored,
      needsReview: vulnerability.needsReview,
      briefsGenerated: briefs.filter((brief) => brief.status === "generated")
        .length,
      briefsCached: briefs.filter((brief) => brief.status === "cached").length,
      briefsFailed: briefs.filter((brief) => brief.status === "failed").length,
      briefError,
    }
  } catch (error) {
    const status =
      error instanceof PredictHQRequestError && error.status === 429
        ? "rate_limited"
        : "error"
    await supabase
      .from("revenue_market_sources")
      .update({
        last_status: status,
        last_error:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : "Unknown error",
      })
      .eq("id", source.id)
    throw error
  }
}

async function readActiveSources(supabase: SupabaseClient, marketId?: string) {
  let query = supabase
    .from("revenue_market_sources")
    .select(
      `
        id, market_id, source_type, query_config, high_water_mark,
        market:revenue_markets!inner(
          id, name, country_code, timezone, center_lat, center_lon,
          radius_miles, market_kind, status
        )
      `
    )
    .eq("source_type", "predicthq")
    .eq("is_active", true)
    .eq("market.status", "active")
  if (marketId) query = query.eq("market_id", marketId)
  const { data, error } = await query
  if (error) throw new Error(`Failed to read active sources: ${error.message}`)
  return (data ?? []) as unknown as SourceRow[]
}

async function enableAgentManagedSources(
  supabase: SupabaseClient,
  marketId?: string
) {
  requiredEnvironment("PREDICTHQ_ACCESS_TOKEN")
  let marketQuery = supabase
    .from("revenue_markets")
    .select("id")
    .eq("status", "active")
    .eq("management_mode", "agent")
  if (marketId) marketQuery = marketQuery.eq("id", marketId)
  const { data: markets, error: marketsError } = await marketQuery
  if (marketsError) {
    throw new Error(
      `Failed to read agent-managed markets: ${marketsError.message}`
    )
  }
  const marketIds = (markets ?? []).map((market) => market.id as string)
  if (marketIds.length === 0) return

  const { error } = await supabase
    .from("revenue_market_sources")
    .update({ is_active: true })
    .eq("source_type", "predicthq")
    .in("market_id", marketIds)
  if (error) {
    throw new Error(`Failed to enable managed sources: ${error.message}`)
  }
}

export async function syncMarketSignalsForMarket(
  supabase: SupabaseClient,
  marketId: string
) {
  requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY")
  await enableAgentManagedSources(supabase, marketId)
  const sources = await readActiveSources(supabase, marketId)
  if (sources.length === 0) {
    throw new Error("This market has no active PredictHQ source")
  }
  return Promise.all(
    sources.map((source) => syncPredictHQSource(supabase, source))
  )
}
