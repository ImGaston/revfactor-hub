// Read-only production verification for the timestamped Market & Event
// Intelligence foundation. Output is aggregate JSON only: no credentials,
// listing identifiers, client data, addresses, or source payloads.
//
// Pre-deployment baseline:
//   pnpm verify:market-intelligence-foundation --baseline-only > /tmp/rf-intel-baseline.json
// Post-deployment verification:
//   pnpm verify:market-intelligence-foundation --baseline /tmp/rf-intel-baseline.json

import { readFileSync } from "node:fs"

import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"

const MAX_ROWS = 5_000
const CORE_COUNT_TABLES = [
  "revenue_markets",
  "revenue_market_listings",
  "revenue_market_sources",
  "market_events",
  "market_event_provider_records",
  "market_event_versions",
  "market_event_evidence",
  "market_event_impacts",
  "market_signal_briefs",
  "market_signal_jobs",
] as const

const FOUNDATION_COUNT_TABLES = [
  "market_signal_institutions",
  "revenue_market_institutions",
  "revenue_market_states",
  "revenue_market_state_memberships",
  "revenue_market_localities",
  "revenue_market_proposals",
  "revenue_market_proposal_listings",
  "market_signal_source_catalog",
  "market_event_series",
  "market_event_series_watches",
  "market_event_conditions",
] as const

const REQUIRED_SOURCE_KEYS = [
  "official_feed",
  "ticketmaster",
  "cfbd",
  "nws",
  "gdelt",
  "google_news",
  "predicthq",
  "seatgeek",
  "ipeds",
  "university_pages",
  "fema",
  "tourism_calendars",
  "pro_sports",
  "transportation",
] as const

type Counts = Record<string, number>
type Check = {
  id: string
  ok: boolean
  metrics: Record<string, number>
}

type VerificationOutput = {
  verification: "market_event_intelligence_foundation"
  mode: "baseline" | "post_deployment"
  generatedAt: string
  ok: boolean
  counts: Counts
  checks: Check[]
}

type MarketRow = {
  id: string
  slug: string
  status: string
  state_id: string | null
}

type MarketStateRow = {
  market_id: string
  state_id: string
  relationship_type: "primary" | "secondary"
}

type ListingMembershipRow = {
  market_id: string
  listing_id: string
  locality_id: string | null
  membership_status: "proposed" | "approved" | "excluded"
  relationship_type: "primary" | "secondary"
}

type AssignmentAuditRow = { approved_primary_count: number | string }
type LocalityRow = { id: string; market_id: string; slug: string }
type InstitutionRow = { id: string }
type InstitutionSourceRow = {
  institution_id: string | null
  market_id: string | null
  is_active: boolean
}
type PredictHQSourceRow = { is_active: boolean }
type SourceCatalogRow = { provider_key: string }
type SeriesRow = { id: string }
type SeriesWatchRow = { series_id: string; target_year: number }
type ProposalRow = {
  status: string
  resolved_market_id: string | null
  proposed_center_lat: number | null
  proposed_center_lon: number | null
  proposed_radius_miles: number | null
}
type ProposalListingRow = {
  review_status: "needs_review" | "accepted" | "rejected" | "withdrawn"
  reviewed_by: string | null
  reviewed_at: string | null
}

class VerificationQueryError extends Error {
  constructor(label: string) {
    super(`Unable to read required aggregate: ${label}`)
    this.name = "VerificationQueryError"
  }
}

function parseArguments() {
  const args = process.argv.slice(2)
  const baselineOnly = args.includes("--baseline-only")
  const baselineIndex = args.indexOf("--baseline")
  const baselinePath = baselineIndex >= 0 ? args[baselineIndex + 1] : null
  const recognized = new Set(
    ["--baseline-only", "--baseline", baselinePath].filter(
      (value): value is string => Boolean(value)
    )
  )
  const unknown = args.filter((argument) => !recognized.has(argument))

  if (unknown.length > 0 || (baselineIndex >= 0 && !baselinePath)) {
    throw new Error("Usage: [--baseline-only] or [--baseline <aggregate-json>]")
  }
  if (baselineOnly && baselinePath) {
    throw new Error("Choose either --baseline-only or --baseline, not both")
  }
  if (!baselineOnly && !baselinePath) {
    throw new Error(
      "Post-deployment verification requires --baseline <aggregate-json>"
    )
  }

  return { baselineOnly, baselinePath }
}

function readBaseline(path: string | null): Counts | null {
  if (!path) return null
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Baseline must be an aggregate verification JSON object")
  }
  const candidate = (parsed as { counts?: unknown }).counts
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Baseline JSON is missing aggregate counts")
  }

  const counts: Counts = {}
  for (const table of CORE_COUNT_TABLES) {
    const value = (candidate as Record<string, unknown>)[table]
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
      throw new Error("Baseline JSON contains an invalid aggregate count")
    }
    counts[table] = Number(value)
  }
  return counts
}

async function countTable(supabase: SupabaseClient, table: string) {
  const result = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
  if (result.error || result.count == null) {
    throw new VerificationQueryError(`${table} count`)
  }
  return result.count
}

async function readBounded<T>(
  label: string,
  query: PromiseLike<{
    data: unknown[] | null
    error: unknown
    count: number | null
  }>
) {
  const result = await query
  if (result.error || !result.data || result.count == null) {
    throw new VerificationQueryError(label)
  }
  if (result.count > MAX_ROWS || result.count !== result.data.length) {
    throw new VerificationQueryError(`${label} exceeded bounded row limit`)
  }
  return result.data as T[]
}

async function readCounts(supabase: SupabaseClient, tables: readonly string[]) {
  const entries = await Promise.all(
    tables.map(
      async (table) => [table, await countTable(supabase, table)] as const
    )
  )
  return Object.fromEntries(entries) as Counts
}

function check(
  id: string,
  ok: boolean,
  metrics: Record<string, number>
): Check {
  return { id, ok, metrics }
}

function printAndExit(output: VerificationOutput) {
  console.log(JSON.stringify(output, null, 2))
  if (!output.ok) process.exitCode = 1
}

async function main() {
  const { baselineOnly, baselinePath } = parseArguments()
  const baseline = readBaseline(baselinePath)
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  ) {
    throw new Error("Required server-side Supabase environment is unavailable")
  }

  const supabase = createAdminClient()
  const coreCounts = await readCounts(supabase, CORE_COUNT_TABLES)

  if (baselineOnly) {
    printAndExit({
      verification: "market_event_intelligence_foundation",
      mode: "baseline",
      generatedAt: new Date().toISOString(),
      ok: true,
      counts: coreCounts,
      checks: [
        check("aggregate_baseline_captured", true, {
          tableCount: CORE_COUNT_TABLES.length,
        }),
      ],
    })
    return
  }

  const foundationCounts = await readCounts(supabase, FOUNDATION_COUNT_TABLES)
  const counts = { ...coreCounts, ...foundationCounts }

  const [
    markets,
    marketStates,
    listingMemberships,
    assignmentAudit,
    localities,
    institutions,
    predictHQSources,
    sourceCatalog,
    annualSeries,
    proposals,
    proposalListings,
  ] = await Promise.all([
    readBounded<MarketRow>(
      "market geography",
      supabase
        .from("revenue_markets")
        .select("id, slug, status, state_id", { count: "exact" })
        .limit(MAX_ROWS + 1)
    ),
    readBounded<MarketStateRow>(
      "market jurisdiction memberships",
      supabase
        .from("revenue_market_state_memberships")
        .select("market_id, state_id, relationship_type", { count: "exact" })
        .limit(MAX_ROWS + 1)
    ),
    readBounded<ListingMembershipRow>(
      "listing market memberships",
      supabase
        .from("revenue_market_listings")
        .select(
          "market_id, listing_id, locality_id, membership_status, relationship_type",
          { count: "exact" }
        )
        .limit(MAX_ROWS + 1)
    ),
    readBounded<AssignmentAuditRow>(
      "active listing assignment audit",
      supabase
        .from("market_listing_assignment_audit")
        .select("approved_primary_count", { count: "exact" })
        .limit(MAX_ROWS + 1)
    ),
    readBounded<LocalityRow>(
      "market localities",
      supabase
        .from("revenue_market_localities")
        .select("id, market_id, slug", { count: "exact" })
        .eq("status", "active")
        .limit(MAX_ROWS + 1)
    ),
    readBounded<InstitutionRow>(
      "pilot institutions",
      supabase
        .from("market_signal_institutions")
        .select("id", { count: "exact" })
        .in("slug", [
          "university-of-connecticut",
          "university-of-tennessee-knoxville",
        ])
        .limit(3)
    ),
    readBounded<PredictHQSourceRow>(
      "PredictHQ source state",
      supabase
        .from("revenue_market_sources")
        .select("is_active", { count: "exact" })
        .eq("source_type", "predicthq")
        .limit(MAX_ROWS + 1)
    ),
    readBounded<SourceCatalogRow>(
      "source catalog",
      supabase
        .from("market_signal_source_catalog")
        .select("provider_key", { count: "exact" })
        .limit(MAX_ROWS + 1)
    ),
    readBounded<SeriesRow>(
      "active annual event series",
      supabase
        .from("market_event_series")
        .select("id", { count: "exact" })
        .eq("status", "active")
        .eq("recurrence_frequency", "annual")
        .eq("monitor_unknown_dates", true)
        .limit(MAX_ROWS + 1)
    ),
    readBounded<ProposalRow>(
      "market registry proposals",
      supabase
        .from("revenue_market_proposals")
        .select(
          "status, resolved_market_id, proposed_center_lat, proposed_center_lon, proposed_radius_miles",
          { count: "exact" }
        )
        .limit(MAX_ROWS + 1)
    ),
    readBounded<ProposalListingRow>(
      "market proposal listing candidates",
      supabase
        .from("revenue_market_proposal_listings")
        .select("review_status, reviewed_by, reviewed_at", { count: "exact" })
        .limit(MAX_ROWS + 1)
    ),
  ])

  const institutionIds = institutions.map((institution) => institution.id)
  const institutionSources =
    institutionIds.length === 0
      ? []
      : await readBounded<InstitutionSourceRow>(
          "pilot institution sources",
          supabase
            .from("revenue_market_sources")
            .select("institution_id, market_id, is_active", { count: "exact" })
            .in("institution_id", institutionIds)
            .in("source_type", ["official_feed", "cfbd"])
            .limit(MAX_ROWS + 1)
        )

  const seriesIds = annualSeries.map((series) => series.id)
  const seriesWatches =
    seriesIds.length === 0
      ? []
      : await readBounded<SeriesWatchRow>(
          "annual series date watches",
          supabase
            .from("market_event_series_watches")
            .select("series_id, target_year", { count: "exact" })
            .in("series_id", seriesIds)
            .limit(MAX_ROWS + 1)
        )

  const primaryStateByMarket = new Map<string, MarketStateRow[]>()
  for (const membership of marketStates) {
    if (membership.relationship_type !== "primary") continue
    const rows = primaryStateByMarket.get(membership.market_id) ?? []
    rows.push(membership)
    primaryStateByMarket.set(membership.market_id, rows)
  }
  const canonicalActiveMarkets = markets.filter(
    (market) => market.status === "active" && market.state_id != null
  )
  const invalidMarketJurisdictions = canonicalActiveMarkets.filter((market) => {
    const primary = primaryStateByMarket.get(market.id) ?? []
    return primary.length !== 1 || primary[0]?.state_id !== market.state_id
  }).length

  const approvedMemberships = listingMemberships.filter(
    (membership) => membership.membership_status === "approved"
  )
  const approvedListings = new Set(
    approvedMemberships.map((membership) => membership.listing_id)
  )
  const primaryCounts = new Map<string, number>()
  for (const membership of approvedMemberships) {
    if (membership.relationship_type !== "primary") continue
    primaryCounts.set(
      membership.listing_id,
      (primaryCounts.get(membership.listing_id) ?? 0) + 1
    )
  }
  const duplicatePrimaryListings = [...primaryCounts.values()].filter(
    (count) => count > 1
  ).length
  const approvedListingsWithoutPrimary = [...approvedListings].filter(
    (listingId) => (primaryCounts.get(listingId) ?? 0) === 0
  ).length
  const unmappedActiveListings = assignmentAudit.filter(
    (row) => Number(row.approved_primary_count) === 0
  ).length
  const localityMarketById = new Map(
    localities.map((locality) => [locality.id, locality.market_id])
  )
  const invalidLocalityMemberships = listingMemberships.filter(
    (membership) =>
      membership.locality_id != null &&
      localityMarketById.get(membership.locality_id) !== membership.market_id
  ).length

  const smokiesId = markets.find((market) => market.slug === "smokies-tn")?.id
  const smokiesLocalitySlugs = new Set(
    localities
      .filter((locality) => locality.market_id === smokiesId)
      .map((locality) => locality.slug)
  )
  const requiredSmokiesLocalities = [
    "sevierville",
    "pigeon-forge",
    "gatlinburg",
    "pittman-center",
  ]
  const missingSmokiesLocalities = requiredSmokiesLocalities.filter(
    (slug) => !smokiesLocalitySlugs.has(slug)
  ).length
  const knoxvilleInSmokies = smokiesLocalitySlugs.has("knoxville") ? 1 : 0

  const sourceKeys = new Set(sourceCatalog.map((source) => source.provider_key))
  const missingSourceCatalogEntries = REQUIRED_SOURCE_KEYS.filter(
    (key) => !sourceKeys.has(key)
  ).length
  const activePredictHQSources = predictHQSources.filter(
    (source) => source.is_active
  ).length
  const unsafeInstitutionSources = institutionSources.filter(
    (source) => source.market_id != null || source.is_active
  ).length
  const institutionsWithoutSources = institutionIds.filter(
    (institutionId) =>
      !institutionSources.some(
        (source) => source.institution_id === institutionId
      )
  ).length

  const currentYear = new Date().getUTCFullYear()
  const expectedWatchYears = [currentYear, currentYear + 1, currentYear + 2]
  const missingSeriesWatchYears = annualSeries.filter((series) => {
    const years = new Set(
      seriesWatches
        .filter((watch) => watch.series_id === series.id)
        .map((watch) => watch.target_year)
    )
    return expectedWatchYears.some((year) => !years.has(year))
  }).length

  const forbiddenAutoMarketCount = markets.filter((market) =>
    ["knoxville-tn", "eastern-connecticut-ct"].includes(market.slug)
  ).length
  const decreasedCounts = baseline
    ? CORE_COUNT_TABLES.filter((table) => coreCounts[table] < baseline[table])
        .length
    : 0
  const automaticallyCreatedMarketCount = baseline
    ? Math.max(0, coreCounts.revenue_markets - baseline.revenue_markets)
    : 0
  const automaticallyCreatedMembershipCount = baseline
    ? Math.max(
        0,
        coreCounts.revenue_market_listings - baseline.revenue_market_listings
      )
    : 0
  const unsafeProposals = proposals.filter(
    (proposal) =>
      proposal.status !== "needs_review" ||
      proposal.resolved_market_id != null ||
      proposal.proposed_center_lat != null ||
      proposal.proposed_center_lon != null ||
      proposal.proposed_radius_miles != null
  ).length
  const unreviewedProposalListingDecisions = proposalListings.filter(
    (candidate) =>
      ["accepted", "rejected"].includes(candidate.review_status) &&
      (candidate.reviewed_by == null || candidate.reviewed_at == null)
  ).length

  const checks = [
    check("core_counts_not_decreased", decreasedCounts === 0, {
      baselineProvided: baseline ? 1 : 0,
      decreasedTableCount: decreasedCounts,
    }),
    check(
      "active_market_primary_jurisdiction",
      invalidMarketJurisdictions === 0,
      {
        canonicalActiveMarketCount: canonicalActiveMarkets.length,
        invalidMarketCount: invalidMarketJurisdictions,
        activeMarketWithoutCanonicalState: markets.filter(
          (market) => market.status === "active" && market.state_id == null
        ).length,
      }
    ),
    check(
      "approved_listing_primary_market",
      duplicatePrimaryListings === 0 && approvedListingsWithoutPrimary === 0,
      {
        approvedListingCount: approvedListings.size,
        duplicatePrimaryCount: duplicatePrimaryListings,
        missingPrimaryCount: approvedListingsWithoutPrimary,
        unmappedActiveListingCount: unmappedActiveListings,
      }
    ),
    check("listing_locality_matches_market", invalidLocalityMemberships === 0, {
      localityAssignedMembershipCount: listingMemberships.filter(
        (membership) => membership.locality_id != null
      ).length,
      mismatchedLocalityCount: invalidLocalityMemberships,
    }),
    check(
      "smokies_locality_boundary",
      missingSmokiesLocalities === 0 && knoxvilleInSmokies === 0,
      {
        requiredLocalityCount: requiredSmokiesLocalities.length,
        missingRequiredLocalityCount: missingSmokiesLocalities,
        knoxvilleLocalityCount: knoxvilleInSmokies,
      }
    ),
    check(
      "university_registry_did_not_create_markets",
      forbiddenAutoMarketCount === 0,
      {
        forbiddenMarketCount: forbiddenAutoMarketCount,
      }
    ),
    check(
      "proposal_seed_is_review_only",
      proposals.length === 38 && unsafeProposals === 0,
      {
        proposalCount: proposals.length,
        unsafeProposalCount: unsafeProposals,
        expectedProposalCount: 38,
      }
    ),
    check(
      "package_created_no_market_or_listing_assignment",
      automaticallyCreatedMarketCount === 0 &&
        automaticallyCreatedMembershipCount === 0,
      {
        createdMarketCount: automaticallyCreatedMarketCount,
        createdListingMembershipCount: automaticallyCreatedMembershipCount,
      }
    ),
    check(
      "proposal_listing_decisions_are_reviewed",
      unreviewedProposalListingDecisions === 0,
      {
        proposalListingCandidateCount: proposalListings.length,
        unreviewedDecisionCount: unreviewedProposalListingDecisions,
      }
    ),
    check(
      "pilot_institution_sources_are_dormant",
      institutions.length === 2 &&
        institutionsWithoutSources === 0 &&
        unsafeInstitutionSources === 0,
      {
        institutionCount: institutions.length,
        institutionSourceCount: institutionSources.length,
        institutionWithoutSourceCount: institutionsWithoutSources,
        activeOrMarketLinkedSourceCount: unsafeInstitutionSources,
      }
    ),
    check(
      "predicthq_is_reference_only",
      predictHQSources.length > 0 && activePredictHQSources === 0,
      {
        sourceCount: predictHQSources.length,
        activeSourceCount: activePredictHQSources,
      }
    ),
    check("source_catalog_coverage", missingSourceCatalogEntries === 0, {
      requiredProviderCount: REQUIRED_SOURCE_KEYS.length,
      catalogProviderCount: sourceCatalog.length,
      missingRequiredProviderCount: missingSourceCatalogEntries,
    }),
    check(
      "annual_series_three_year_watch_horizon",
      missingSeriesWatchYears === 0,
      {
        activeAnnualSeriesCount: annualSeries.length,
        seriesMissingWatchYearsCount: missingSeriesWatchYears,
        expectedYearsPerSeries: 3,
      }
    ),
  ]

  printAndExit({
    verification: "market_event_intelligence_foundation",
    mode: "post_deployment",
    generatedAt: new Date().toISOString(),
    ok: checks.every((item) => item.ok),
    counts,
    checks,
  })
}

main().catch((error: unknown) => {
  const message =
    error instanceof VerificationQueryError
      ? error.message
      : "Verification could not run with the supplied environment or arguments"
  console.error(
    JSON.stringify(
      {
        verification: "market_event_intelligence_foundation",
        mode: "post_deployment",
        generatedAt: new Date().toISOString(),
        ok: false,
        counts: {},
        checks: [
          {
            id: "verification_execution",
            ok: false,
            metrics: { failureCount: 1 },
          },
        ],
        error: message,
      },
      null,
      2
    )
  )
  process.exitCode = 1
})
