// Test factories for the Wins suite. Not a test file — vitest only collects
// **/*.test.ts, matching the existing helpers.ts convention.

import {
  buildWindows,
  computePickupTrend,
  computeYoy,
  defaultPeriod,
  type WinCandidate,
  type WinCategory,
  type WinEvidence,
} from "@/lib/wins"

const AS_OF = "2026-08-12"

export function makeEvidence(
  overrides: {
    pickup?: { w1?: number; w2: number; w3: number; medianLead?: number }
    yoy?: { ty: number; stly: number }
    occTy?: number | null
    occStly?: number | null
    occMarket?: number | null
    adrTy?: number | null
    adrStly?: number | null
    adrMarket?: number | null
    revparIndex?: number | null
    currency?: string
  } = {}
): WinEvidence {
  const w2 = overrides.pickup?.w2 ?? 10000
  const w3 = overrides.pickup?.w3 ?? 12000
  const w1 = overrides.pickup?.w1 ?? 0
  const { trend, changePct } = computePickupTrend(w2, w3)
  const yoy = computeYoy(overrides.yoy?.ty ?? 60000, overrides.yoy?.stly ?? 50000)

  const occTy = overrides.occTy ?? 55
  const occMarket = overrides.occMarket ?? 45
  const adrTy = overrides.adrTy ?? 300
  const adrMarket = overrides.adrMarket ?? 250

  return {
    currency: overrides.currency ?? "USD",
    period: defaultPeriod(AS_OF, 3),
    windows: buildWindows(AS_OF),
    pickup: {
      w1,
      w2,
      w3,
      delta_abs: w3 - w2,
      change_pct: changePct,
      trend,
      median_lead_days_w3: overrides.pickup?.medianLead ?? 12,
      reservation_count_w2: 8,
      reservation_count_w3: 14,
    },
    yoy,
    occupancy: {
      ty_pct: occTy,
      stly_pct: overrides.occStly ?? 48,
      market_pct: occMarket,
      gap_pp: occTy != null && occMarket != null ? occTy - occMarket : null,
      aggregation: "simple_average",
    },
    adr: {
      ty: adrTy,
      stly: overrides.adrStly ?? 280,
      market: adrMarket,
      vs_market_pct:
        adrTy != null && adrMarket ? (adrTy / adrMarket - 1) * 100 : null,
      aggregation: "simple_average",
    },
    market: {
      revpar_index: overrides.revparIndex ?? 118,
      market_revpar_yoy_pct: 15.77,
      bw_own_days: 15,
      bw_market_days: 38.5,
      bw_vs_market_days: -23.5,
    },
    opportunity: { potential_revenue_open_inventory: 35143 },
    sources: [
      { name: "pricelabs_reservations_cache", as_of: AS_OF },
      { name: "report_metrics", as_of: "Aug–Oct 2026" },
    ],
    monthly_detail: [],
  }
}

export function makeCandidate(
  overrides: Partial<WinCandidate> & { id: string }
): WinCandidate {
  const evidence = overrides.evidence ?? makeEvidence()
  return {
    id: overrides.id,
    run_id: overrides.run_id ?? "run-1",
    hub_listing_id: overrides.hub_listing_id ?? `listing-${overrides.id}`,
    pricelabs_listing_id: overrides.pricelabs_listing_id ?? `pl-${overrides.id}`,
    client_id: overrides.client_id === undefined ? "c1" : overrides.client_id,
    listing_name_snapshot: overrides.listing_name_snapshot ?? "Rabbit Run",
    client_name_snapshot:
      overrides.client_name_snapshot === undefined ? "Grant" : overrides.client_name_snapshot,
    category: (overrides.category ?? "double_win") as WinCategory,
    confidence: overrides.confidence ?? "high",
    pickup_trend: overrides.pickup_trend ?? evidence.pickup.trend,
    reason_codes: overrides.reason_codes ?? [],
    is_blocked: overrides.is_blocked ?? false,
    priority_rank: overrides.priority_rank ?? 1,
    evidence,
    created_at: overrides.created_at ?? "2026-08-13T08:00:00Z",
    review_state: overrides.review_state ?? "new",
    assembly_deep_link: overrides.assembly_deep_link ?? null,
  }
}
