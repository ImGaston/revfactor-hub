// Wins detection orchestration.
//
// Crosses two PriceLabs-derived sources that answer different questions:
//   * pickup, by BOOKED DATE, aggregated in Postgres by wins_pickup_windows()
//     because the window spans ~93 days of reservations across the portfolio
//     and this project caps PostgREST at db-max-rows = 1000;
//   * period revenue TY vs STLY and market context, by STAY DATE, from
//     report_metrics (latest completed run only — every run is a full
//     snapshot, so mixing runs would double-count).
//
// Classification itself lives in lib/wins.ts as pure functions. This module
// only fetches, joins, and persists.

import type { SupabaseClient } from "@supabase/supabase-js"

import { getLatestCompletedRun } from "@/lib/report-builder/queries"
import { getActiveRules } from "@/lib/wins-queries"
import {
  buildWindows,
  buildAssemblyDeepLink,
  daysBetween,
  evaluateCandidate,
  defaultPeriod,
  periodMonths,
  rankCandidates,
  type WinEvidence,
  type WinPeriod,
} from "@/lib/wins"

const METRICS_PAGE_SIZE = 1000

/** Only the metric columns the Wins evidence actually reads. */
const METRIC_SELECT = [
  "listing_id",
  "period",
  "rental_revenue",
  "rental_revenue_stly",
  "rental_adr",
  "rental_adr_stly",
  "market_adr",
  "revpar_index",
  "adjusted_occupancy_pct",
  "adjusted_occupancy_stly_pct",
  "market_occupancy_pct",
  "market_revpar",
  "market_revpar_stly_yoy_pct",
  "median_booking_window",
  "market_median_booking_window",
  "potential_revenue_open_inventory",
].join(", ")

type PickupRow = {
  pricelabs_listing_id: string
  hub_listing_id: string | null
  client_id: string | null
  pickup_w1: number | string | null
  pickup_w2: number | string | null
  pickup_w3: number | string | null
  reservations_w2: number | null
  reservations_w3: number | null
  median_lead_w3: number | string | null
  currencies: string[] | null
  has_fanout: boolean | null
  has_negative_revenue: boolean | null
}

type MetricRow = Record<string, number | string | null>

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
const nullableNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = typeof v === "string" ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : null
}

/** Mean of the non-null values, or null. Never treat a missing month as zero. */
function meanOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null)
  if (present.length === 0) return null
  return present.reduce((a, b) => a + b, 0) / present.length
}

export type WinsDetectionResult = {
  runId: string
  asOfDate: string
  period: WinPeriod
  candidateCount: number
  reportRunId: string | null
}

/**
 * Resolve the newest fully-complete booking day.
 *
 * The current day is always excluded: it is partial, so including it would
 * make W3 look weaker every morning and recover every evening. Bounded by the
 * data actually present so a lagging sync degrades instead of producing an
 * empty window.
 */
async function resolveAsOfDate(supabase: SupabaseClient): Promise<{
  asOf: string | null
  maxBookedDate: string | null
  fetchedAt: string | null
}> {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  const { data } = await supabase
    .from("pricelabs_reservations_cache")
    .select("booked_date, source_fetched_at")
    .eq("booking_status", "booked")
    // 1970-01-01 is the upstream missing-value sentinel, not a real date.
    .neq("booked_date", "1970-01-01")
    .lt("booked_date", today)
    .order("booked_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.booked_date) return { asOf: null, maxBookedDate: null, fetchedAt: null }

  const maxBooked = data.booked_date as string
  return {
    asOf: maxBooked < yesterday ? maxBooked : yesterday,
    maxBookedDate: maxBooked,
    fetchedAt: (data.source_fetched_at as string) ?? null,
  }
}

/**
 * Page through report_metrics for one run.
 *
 * A single unbounded select silently drops the latest months here — see
 * decisions.md 2026-06-24. The order must be a stable total order or pages
 * skip and repeat rows.
 */
async function fetchMetrics(
  supabase: SupabaseClient,
  reportRunId: string,
  months: string[]
): Promise<MetricRow[]> {
  const rows: MetricRow[] = []
  for (let offset = 0; ; offset += METRICS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("report_metrics")
      .select(METRIC_SELECT)
      .eq("report_run_id", reportRunId)
      .in("period", months)
      .order("period", { ascending: true })
      .order("listing_id", { ascending: true })
      .range(offset, offset + METRICS_PAGE_SIZE - 1)
    if (error) throw new Error(`Failed to read report_metrics: ${error.message}`)
    const page = (data ?? []) as unknown as MetricRow[]
    rows.push(...page)
    if (page.length < METRICS_PAGE_SIZE) break
  }
  return rows
}

/**
 * Run detection and persist an immutable snapshot.
 *
 * Idempotent by (as_of_date, period, rules_version): re-running replaces the
 * candidates of that run rather than creating a second one. Message drafts and
 * events reference candidates with ON DELETE SET NULL and carry their own
 * frozen evidence, so a recompute can never rewrite history a teammate has
 * already acted on.
 */
export async function runWinsDetection(
  supabase: SupabaseClient,
  opts: {
    userId: string | null
    periodMonths?: number
    triggeredBy?: "manual" | "cron"
  }
): Promise<WinsDetectionResult> {
  // Thresholds come from the active, versioned rule set (migration 076); the
  // seeded constant is only the fallback when the table is empty.
  const { rules } = await getActiveRules(supabase)
  const { asOf, maxBookedDate, fetchedAt } = await resolveAsOfDate(supabase)
  if (!asOf) throw new Error("No booked reservations available to anchor the analysis")

  const period = defaultPeriod(asOf, opts.periodMonths ?? 3)
  const months = periodMonths(period)
  const windows = buildWindows(asOf, rules)

  const reportRun = await getLatestCompletedRun(supabase)

  // Upsert the run row first so a failure mid-way leaves a visible record.
  const { data: runRow, error: runError } = await supabase
    .from("win_detection_runs")
    .upsert(
      {
        as_of_date: asOf,
        period_start: period.start,
        period_end: period.end,
        rules_version: rules.version,
        rules_snapshot: rules,
        report_run_id: reportRun?.id ?? null,
        reservations_fetched_at: fetchedAt,
        reservations_max_booked_date: maxBookedDate,
        status: "running",
        candidate_count: 0,
        error_reason: null,
        triggered_by: opts.triggeredBy ?? "manual",
        triggered_by_user_id: opts.userId,
        started_at: new Date().toISOString(),
        completed_at: null,
      },
      { onConflict: "as_of_date,period_start,period_end,rules_version" }
    )
    .select("id")
    .single()

  if (runError || !runRow) {
    throw new Error(`Failed to create detection run: ${runError?.message ?? "unknown"}`)
  }
  const runId = runRow.id as string

  try {
    const { data: pickupData, error: pickupError } = await supabase.rpc("wins_pickup_windows", {
      p_as_of: asOf,
    })
    if (pickupError) throw new Error(`Pickup aggregation failed: ${pickupError.message}`)
    const pickupRows = (pickupData ?? []) as PickupRow[]

    const metricRows = reportRun ? await fetchMetrics(supabase, reportRun.id, months) : []

    const [{ data: reportListings }, { data: listings }, { data: clients }] = await Promise.all([
      supabase.from("report_listings").select("listing_id, hub_listing_id, hub_client_id, listing_name"),
      supabase.from("listings").select("id, name, client_id, listing_id, created_at, status"),
      supabase.from("clients").select("id, name, status, assembly_client_id, assembly_company_id"),
    ])

    const listingById = new Map((listings ?? []).map((l) => [l.id as string, l]))
    const clientById = new Map((clients ?? []).map((c) => [c.id as string, c]))
    const reportByListingId = new Map(
      (reportListings ?? []).map((r) => [r.listing_id as string, r])
    )

    // Metrics keyed by the PriceLabs listing id, which is what report_metrics
    // uses. listings.id (UUID) is a different key space entirely.
    const metricsByListing = new Map<string, MetricRow[]>()
    for (const m of metricRows) {
      const key = String(m.listing_id)
      const bucket = metricsByListing.get(key)
      if (bucket) bucket.push(m)
      else metricsByListing.set(key, [m])
    }

    const stalenessDays = daysBetween(asOf, new Date().toISOString().slice(0, 10))
    const runCurrency = (reportRun ? "USD" : "USD") as string

    const built = pickupRows.map((row) => {
      const plId = row.pricelabs_listing_id
      const reasonCodes: string[] = []

      const hubListingId = row.hub_listing_id
      const listing = hubListingId ? listingById.get(hubListingId) : undefined
      const reportListing = reportByListingId.get(plId)
      const clientId = row.client_id ?? (listing?.client_id as string | null) ?? null
      const client = clientId ? clientById.get(clientId) : undefined

      const listingName =
        (listing?.name as string) ?? (reportListing?.listing_name as string) ?? plId
      const clientName = (client?.name as string) ?? null

      // --- pickup (booked date) ---
      const w1 = num(row.pickup_w1)
      const w2 = num(row.pickup_w2)
      const w3 = num(row.pickup_w3)
      // trend and yoy are derived by evaluateCandidate below, so they are not
      // computed twice here -- two call sites would be two chances to diverge.

      // --- period metrics (stay date) ---
      const listingMetrics = metricsByListing.get(plId) ?? []
      if (listingMetrics.length < months.length) reasonCodes.push("incomplete_period")

      const revenueTy = listingMetrics.reduce((a, m) => a + num(m.rental_revenue), 0)
      const revenueStly = listingMetrics.reduce((a, m) => a + num(m.rental_revenue_stly), 0)

      const occTy = meanOf(listingMetrics.map((m) => nullableNum(m.adjusted_occupancy_pct)))
      const occStly = meanOf(listingMetrics.map((m) => nullableNum(m.adjusted_occupancy_stly_pct)))
      const occMarket = meanOf(listingMetrics.map((m) => nullableNum(m.market_occupancy_pct)))
      const adrTy = meanOf(listingMetrics.map((m) => nullableNum(m.rental_adr)))
      const adrStly = meanOf(listingMetrics.map((m) => nullableNum(m.rental_adr_stly)))
      const adrMarket = meanOf(listingMetrics.map((m) => nullableNum(m.market_adr)))
      const revparIndex = meanOf(listingMetrics.map((m) => nullableNum(m.revpar_index)))
      const marketRevpar = meanOf(listingMetrics.map((m) => nullableNum(m.market_revpar)))
      const marketRevparYoy = meanOf(
        listingMetrics.map((m) => nullableNum(m.market_revpar_stly_yoy_pct))
      )
      const bwOwn = meanOf(listingMetrics.map((m) => nullableNum(m.median_booking_window)))
      const bwMarket = meanOf(
        listingMetrics.map((m) => nullableNum(m.market_median_booking_window))
      )
      const potential = listingMetrics.reduce(
        (a, m) => a + num(m.potential_revenue_open_inventory),
        0
      )

      // --- guardrails that depend on the data, not on the thresholds ---
      // The threshold-dependent ones (staleness, small/absent/extreme STLY,
      // comp set QA, occupancy-up/ADR-down) are derived inside
      // evaluateCandidate below, so the rules editor's impact preview and this
      // run always agree by construction rather than by convention.
      if (!reportRun || listingMetrics.length === 0) reasonCodes.push("incomplete_period")
      if (row.has_fanout) reasonCodes.push("ambiguous_listing_mapping")
      if (row.has_negative_revenue) reasonCodes.push("negative_revenue")
      if (!clientId) reasonCodes.push("unassigned_client")
      if ((row.currencies?.length ?? 0) > 1) reasonCodes.push("currency_mismatch")
      if (revenueStly <= 0 && (marketRevpar == null || marketRevpar === 0)) {
        reasonCodes.push("compset_missing")
      }
      if (client && !client.assembly_company_id && !client.assembly_client_id) {
        reasonCodes.push("no_assembly_chat")
      }
      if (listing?.created_at && (listing.created_at as string).slice(0, 10) >= period.start) {
        reasonCodes.push("new_listing")
      }

      const evaluation = evaluateCandidate(
        {
          pickupW2: w2,
          pickupW3: w3,
          revenueTy,
          revenueStly,
          revparIndex,
          marketRevpar,
          occTy,
          occStly,
          adrTy,
          adrStly,
          stalenessDays,
        },
        reasonCodes,
        rules
      )

      const evidence: WinEvidence = {
        currency: row.currencies?.[0] ?? runCurrency,
        period,
        windows,
        pickup: {
          w1,
          w2,
          w3,
          delta_abs: w3 - w2,
          change_pct: evaluation.pickupChangePct,
          trend: evaluation.pickupTrend,
          median_lead_days_w3: nullableNum(row.median_lead_w3),
          reservation_count_w2: row.reservations_w2 ?? 0,
          reservation_count_w3: row.reservations_w3 ?? 0,
        },
        yoy: evaluation.yoy,
        occupancy: {
          ty_pct: occTy,
          stly_pct: occStly,
          market_pct: occMarket,
          gap_pp: occTy != null && occMarket != null ? occTy - occMarket : null,
          aggregation: "simple_average",
        },
        adr: {
          ty: adrTy,
          stly: adrStly,
          market: adrMarket,
          vs_market_pct:
            adrTy != null && adrMarket != null && adrMarket > 0
              ? (adrTy / adrMarket - 1) * 100
              : null,
          aggregation: "simple_average",
        },
        market: {
          revpar_index: revparIndex,
          market_revpar_yoy_pct: marketRevparYoy,
          bw_own_days: bwOwn,
          bw_market_days: bwMarket,
          bw_vs_market_days: bwOwn != null && bwMarket != null ? bwOwn - bwMarket : null,
        },
        opportunity: { potential_revenue_open_inventory: potential || null },
        sources: [
          {
            name: "pricelabs_reservations_cache",
            as_of: asOf,
            note: "Cancelled reservations excluded; pickup measured by booked date.",
          },
          {
            name: "report_metrics",
            as_of: period.label,
            report_run_id: reportRun?.id,
            completed_at: reportRun?.completed_at ?? null,
            note: "Period revenue measured by stay date. STLY is same-time-last-year pace.",
          },
        ],
        monthly_detail: listingMetrics.map((m) => ({
          period: String(m.period),
          rental_revenue: nullableNum(m.rental_revenue),
          rental_revenue_stly: nullableNum(m.rental_revenue_stly),
        })),
      }

      const { category, confidence, isBlocked, reasonCodes: uniqueReasons } = evaluation

      return {
        pricelabs_listing_id: plId,
        hub_listing_id: hubListingId,
        client_id: clientId,
        listing_name_snapshot: listingName,
        client_name_snapshot: clientName,
        category,
        confidence,
        pickup_trend: evaluation.pickupTrend,
        reason_codes: uniqueReasons,
        is_blocked: isBlocked,
        evidence,
        has_assembly_chat: Boolean(client && buildAssemblyDeepLink(client)),
      }
    })

    const ranked = rankCandidates(built)
    const toInsert = ranked.map((c, i) => ({
      run_id: runId,
      hub_listing_id: c.hub_listing_id,
      pricelabs_listing_id: c.pricelabs_listing_id,
      client_id: c.client_id,
      listing_name_snapshot: c.listing_name_snapshot,
      client_name_snapshot: c.client_name_snapshot,
      category: c.category,
      confidence: c.confidence,
      pickup_trend: c.pickup_trend,
      reason_codes: c.reason_codes,
      is_blocked: c.is_blocked,
      priority_rank: i + 1,
      evidence: c.evidence,
    }))

    // Upsert rather than delete-then-insert so candidate ids stay stable across
    // recomputes of the same run. Message drafts and review rows reference
    // candidates with ON DELETE SET NULL, so replacing the rows would orphan an
    // already-copied draft: its frozen evidence would survive, but the link
    // back to the win would not, and the UI could no longer tell the reviewer
    // that the evidence moved since they copied it.
    for (let i = 0; i < toInsert.length; i += 500) {
      const { error } = await supabase
        .from("win_candidates")
        .upsert(toInsert.slice(i, i + 500), { onConflict: "run_id,hub_listing_id" })
      if (error) throw new Error(`Failed to persist candidates: ${error.message}`)
    }

    // Drop candidates from a previous execution whose listing no longer
    // appears, so a delisted property does not linger in the queue.
    const keptListingIds = toInsert
      .map((c) => c.hub_listing_id)
      .filter((id): id is string => Boolean(id))
    if (keptListingIds.length > 0) {
      const { error } = await supabase
        .from("win_candidates")
        .delete()
        .eq("run_id", runId)
        .not("hub_listing_id", "in", `(${keptListingIds.join(",")})`)
      if (error) throw new Error(`Failed to prune stale candidates: ${error.message}`)
    }

    await supabase
      .from("win_detection_runs")
      .update({
        status: "completed",
        candidate_count: toInsert.length,
        currency: runCurrency,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)

    return {
      runId,
      asOfDate: asOf,
      period,
      candidateCount: toInsert.length,
      reportRunId: reportRun?.id ?? null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    await supabase
      .from("win_detection_runs")
      .update({ status: "failed", error_reason: message, completed_at: new Date().toISOString() })
      .eq("id", runId)
    throw err
  }
}
