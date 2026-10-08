import "server-only"

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  normalizedProviderEventSchema,
  type MarketEventState,
  type MarketSignalSourceType,
} from "@/lib/market-signals/contracts"
import {
  calculateMaterialityScore,
  canonicalEventFingerprint,
  classifyEventChange,
  determineActionGate,
  distanceMiles,
  eventFamilyKey,
  legacyCanonicalEventFingerprint,
  shouldRetainProviderCandidate,
} from "@/lib/market-signals/domain"
import {
  fetchPredictHQEvents,
  normalizePredictHQEvent,
  parsePredictHQQueryConfig,
  PredictHQRequestError,
} from "@/lib/market-signals/predicthq"
import {
  fetchTicketmasterEvents,
  normalizeTicketmasterEvent,
  parseTicketmasterQueryConfig,
} from "@/lib/market-signals/ticketmaster"
import {
  fetchNWSAlerts,
  normalizeNWSAlert,
  parseNWSQueryConfig,
} from "@/lib/market-signals/nws"
import {
  fetchCFBDGames,
  normalizeCFBDGame,
  parseCFBDQueryConfig,
} from "@/lib/market-signals/cfbd"
import {
  batchProviderCandidates,
  MarketSignalProviderRequestError,
  type MarketSignalMarket,
  type MarketSignalProviderCandidate,
} from "@/lib/market-signals/provider"
import { generateMarketSignalBriefsForMarket } from "@/lib/market-signals/briefs.server"
import { scoreMarketVulnerability } from "@/lib/market-signals/vulnerability.server"

type SourceRow = {
  id: string
  market_id: string
  source_type: MarketSignalSourceType
  query_config: unknown
  high_water_mark: string | null
  cadence_minutes: number
  last_attempt_at: string | null
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
  market_kind: MarketSignalMarket["kind"]
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
  ticketmasterConfigured: boolean
  cfbdConfigured: boolean
  nwsConfigured: boolean
  configuredSources: number
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
  const predictHQConfigured =
    process.env.PREDICTHQ_INGESTION_ENABLED?.trim().toLowerCase() === "true" &&
    Boolean(process.env.PREDICTHQ_ACCESS_TOKEN?.trim())
  const ticketmasterConfigured = Boolean(
    process.env.TICKETMASTER_API_KEY?.trim()
  )
  const cfbdConfigured =
    process.env.CFBD_INGESTION_ENABLED?.trim().toLowerCase() === "true" &&
    Boolean(process.env.CFBD_API_KEY?.trim())
  const nwsConfigured = Boolean(process.env.NWS_USER_AGENT?.trim())
  const configuredSources = [
    predictHQConfigured,
    ticketmasterConfigured,
    cfbdConfigured,
    nwsConfigured,
  ].filter(Boolean).length
  return {
    serviceRoleConfigured,
    predictHQConfigured,
    ticketmasterConfigured,
    cfbdConfigured,
    nwsConfigured,
    configuredSources,
    ready: serviceRoleConfigured && configuredSources > 0,
  }
}

function contentHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function marketFromRow(row: MarketRow): MarketSignalMarket {
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

function providerState(
  candidate: MarketSignalProviderCandidate
): MarketEventState {
  const status = candidate.providerState.toLowerCase()
  if (/cancel/.test(status)) return "canceled"
  if (/postpon/.test(status)) return "postponed"
  if (/deleted|duplicate|spam/.test(status)) return "superseded"
  if (/predicted/.test(status)) return "candidate"
  return "verified"
}

function normalizedSnapshot(candidate: MarketSignalProviderCandidate) {
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
  fingerprint: string,
  legacyFingerprint: string
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
  if (data) return data as EventRow

  const { data: legacyData, error: legacyError } = await supabase
    .from("market_events")
    .select("id, canonical_fingerprint, state")
    .eq("canonical_fingerprint", legacyFingerprint)
    .maybeSingle()
  if (legacyError) {
    throw new Error(`Failed to deduplicate legacy event: ${legacyError.message}`)
  }
  return (legacyData ?? null) as EventRow | null
}

async function persistCandidate(input: {
  supabase: SupabaseClient
  sourceId: string
  market: MarketSignalMarket
  candidate: MarketSignalProviderCandidate
  observedAt: string
}) {
  const { supabase, sourceId, market, candidate, observedAt } = input
  const normalized = candidate.normalized
  const fingerprint = canonicalEventFingerprint(normalized)
  const legacyFingerprint = legacyCanonicalEventFingerprint(normalized)
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
  let event = await findEvent(
    supabase,
    provider,
    fingerprint,
    legacyFingerprint
  )
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
        publisher: candidate.publisher,
        published_at: normalized.updatedAt,
        observed_at: observedAt,
        authority_tier: candidate.authorityTier,
        extraction_confidence: 1,
        verification_state: candidate.verificationState,
        evidence_summary: candidate.evidenceSummary,
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
  const materialityScore = Math.max(
    candidate.materialityFloor ?? 0,
    calculateMaterialityScore({
      attendance: normalized.attendance,
      localRank: normalized.localRank,
      rank: candidate.rank,
      accommodationSpend: candidate.accommodationSpend,
      category: normalized.category,
      marketKind: market.kind,
      distanceMiles: eventDistance,
      radiusMiles: market.radiusMiles,
    })
  )

  if (
    !shouldRetainProviderCandidate({
      providerStatus: candidate.providerState,
      materialityScore,
      retentionFloor: candidate.retentionFloor,
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
    verificationState: candidate.verificationState,
    authorityTier: candidate.authorityTier,
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
          materialityFloor: candidate.materialityFloor ?? null,
          provider: normalized.sourceType,
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

async function fetchSourceCandidates(
  source: SourceRow,
  market: MarketSignalMarket
) {
  if (source.source_type === "predicthq") {
    const response = await fetchPredictHQEvents({
      token: requiredEnvironment("PREDICTHQ_ACCESS_TOKEN"),
      market,
      queryConfig: parsePredictHQQueryConfig(source.query_config),
      highWaterMark: source.high_water_mark,
    })
    return {
      candidates: response.events.map((event) =>
        normalizePredictHQEvent(event, market)
      ),
      overflow: response.overflow,
    }
  }

  if (source.source_type === "ticketmaster") {
    const response = await fetchTicketmasterEvents({
      apiKey: requiredEnvironment("TICKETMASTER_API_KEY"),
      market,
      queryConfig: parseTicketmasterQueryConfig(source.query_config),
    })
    return {
      candidates: response.events.map((event) =>
        normalizeTicketmasterEvent(event, market)
      ),
      overflow: response.overflow,
    }
  }

  if (source.source_type === "nws") {
    const response = await fetchNWSAlerts({
      userAgent: requiredEnvironment("NWS_USER_AGENT"),
      market,
      queryConfig: parseNWSQueryConfig(source.query_config),
    })
    return {
      candidates: response.events.map((alert) =>
        normalizeNWSAlert(alert, market)
      ),
      overflow: response.overflow,
    }
  }

  if (source.source_type === "cfbd") {
    const queryConfig = parseCFBDQueryConfig(source.query_config)
    const response = await fetchCFBDGames({
      apiKey: requiredEnvironment("CFBD_API_KEY"),
      market,
      queryConfig,
    })
    return {
      candidates: response.events.map((game) =>
        normalizeCFBDGame(game, market, queryConfig)
      ),
      overflow: response.overflow,
    }
  }

  throw new Error(
    `Market Signals source ${source.source_type} has no provider adapter`
  )
}

async function syncProviderSource(
  supabase: SupabaseClient,
  source: SourceRow
): Promise<MarketSignalSyncResult> {
  const marketRow = relationOne(source.market)
  if (!marketRow || marketRow.status !== "active") {
    throw new Error("Market Signals only syncs active managed markets")
  }
  const market = marketFromRow(marketRow)
  const startedAt = new Date().toISOString()

  await supabase
    .from("revenue_market_sources")
    .update({ last_attempt_at: startedAt })
    .eq("id", source.id)

  try {
    const response = await fetchSourceCandidates(source, market)
    let rowsChanged = 0
    let dedupeCount = 0
    let retainedCount = 0

    const persistenceBatches = batchProviderCandidates(response.candidates, 6)
    for (const batch of persistenceBatches) {
      const results = await Promise.all(
        batch.map((candidate) =>
          persistCandidate({
            supabase,
            sourceId: source.id,
            market,
            candidate,
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

    const { error } = await supabase
      .from("revenue_market_sources")
      .update({
        high_water_mark: startedAt,
        last_success_at: new Date().toISOString(),
        last_status: "ok",
        last_error: response.overflow
          ? `${source.source_type} returned more rows than this source's configured cap; narrow its market query if material events appear truncated.`
          : null,
        last_rows_read: response.candidates.length,
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
      rowsRead: response.candidates.length,
      rowsChanged,
      dedupeCount,
      retainedCount,
      overflow: response.overflow,
      impactsScored: 0,
      listingExposuresScored: 0,
      needsReview: 0,
      briefsGenerated: 0,
      briefsCached: 0,
      briefsFailed: 0,
      briefError: null,
    }
  } catch (error) {
    const status =
      (error instanceof PredictHQRequestError ||
        error instanceof MarketSignalProviderRequestError) &&
      error.status === 429
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

async function readActiveSources(
  supabase: SupabaseClient,
  marketId?: string,
  dueOnly = false
) {
  let query = supabase
    .from("revenue_market_sources")
    .select(
      `
        id, market_id, source_type, query_config, high_water_mark,
        cadence_minutes, last_attempt_at,
        market:revenue_markets!inner(
          id, name, country_code, timezone, center_lat, center_lon,
          radius_miles, market_kind, status
        )
      `
    )
    .eq("is_active", true)
    .eq("market.status", "active")
  if (marketId) query = query.eq("market_id", marketId)
  const { data, error } = await query
  if (error) throw new Error(`Failed to read active sources: ${error.message}`)
  const sources = (data ?? []) as unknown as SourceRow[]
  if (!dueOnly) return sources
  const now = Date.now()
  return sources.filter(
    (source) =>
      source.last_attempt_at == null ||
      now - new Date(source.last_attempt_at).getTime() >=
        source.cadence_minutes * 60_000
  )
}

async function enableAgentManagedSources(
  supabase: SupabaseClient,
  marketId?: string
) {
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

  const runtime = getMarketSignalsRuntimeStatus()
  const availability: Array<[MarketSignalSourceType, boolean]> = [
    ["predicthq", runtime.predictHQConfigured],
    ["ticketmaster", runtime.ticketmasterConfigured],
    ["cfbd", runtime.cfbdConfigured],
    ["nws", runtime.nwsConfigured],
  ]
  for (const [sourceType, isActive] of availability) {
    const { error } = await supabase
      .from("revenue_market_sources")
      .update({ is_active: isActive })
      .eq("source_type", sourceType)
      .in("market_id", marketIds)
    if (error) {
      throw new Error(
        `Failed to configure managed ${sourceType} sources: ${error.message}`
      )
    }
  }
}

export async function syncMarketSignalsForMarket(
  supabase: SupabaseClient,
  marketId: string,
  options?: { dueOnly?: boolean }
) {
  requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY")
  await enableAgentManagedSources(supabase, marketId)
  const sources = await readActiveSources(
    supabase,
    marketId,
    options?.dueOnly ?? false
  )
  if (sources.length === 0) {
    return []
  }
  const results: MarketSignalSyncResult[] = []
  const failures: string[] = []
  for (const source of sources) {
    try {
      results.push(await syncProviderSource(supabase, source))
    } catch (error) {
      failures.push(
        `${source.source_type}: ${error instanceof Error ? error.message : "unknown error"}`
      )
    }
  }
  if (results.length === 0) {
    throw new Error(`All configured sources failed: ${failures.join("; ")}`)
  }

  const vulnerability = await scoreMarketVulnerability(
    supabase,
    marketId,
    new Date()
  )
  let briefError: string | null = null
  const briefs = await generateMarketSignalBriefsForMarket(
    supabase,
    marketId
  ).catch((error) => {
    briefError = error instanceof Error ? error.message : "Unknown brief error"
    return []
  })
  results[0] = {
    ...results[0],
    impactsScored: vulnerability.impactsScored,
    listingExposuresScored: vulnerability.listingExposuresScored,
    needsReview: vulnerability.needsReview,
    briefsGenerated: briefs.filter((brief) => brief.status === "generated")
      .length,
    briefsCached: briefs.filter((brief) => brief.status === "cached").length,
    briefsFailed: briefs.filter((brief) => brief.status === "failed").length,
    briefError,
  }
  return results
}
