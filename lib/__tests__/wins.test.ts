import { describe, expect, it } from "vitest"

import {
  WINS_RULES_V1,
  aggregateByClient,
  buildAssemblyDeepLink,
  classifyCandidate,
  computePickupTrend,
  computeYoy,
  isReadyToShare,
  rankCandidates,
  type WinCandidate,
  type WinEvidence,
} from "@/lib/wins"

import { makeEvidence, makeCandidate } from "./wins-helpers"

describe("computePickupTrend", () => {
  // The reference workbook never contains a row at exactly +/-15%, so the
  // boundary is a decision this project makes rather than one it inherits.
  // Held is inclusive on both edges.
  it.each([
    [100, 115, "held", "exactly +15% is Held, not Up"],
    [100, 115.01, "up", "just above +15% is Up"],
    [100, 85, "held", "exactly -15% is Held, not Down"],
    [100, 84.99, "down", "just below -15% is Down"],
    [100, 200, "up", "large increase"],
    [100, 0, "down", "collapse to zero"],
    [100, 100, "held", "no change"],
  ])("w2=%s w3=%s -> %s (%s)", (w2, w3, expected) => {
    expect(computePickupTrend(w2, w3).trend).toBe(expected)
  })

  it("classifies a zero base with pickup as up_from_zero and never emits a percentage", () => {
    const result = computePickupTrend(0, 5000)
    expect(result.trend).toBe("up_from_zero")
    expect(result.changePct).toBeNull()
  })

  it("classifies a zero base with no pickup as no_pickup", () => {
    const result = computePickupTrend(0, 0)
    expect(result.trend).toBe("no_pickup")
    expect(result.changePct).toBeNull()
  })

  it("never produces Infinity or NaN for any zero-denominator case", () => {
    for (const w3 of [0, 1, 1000, -50]) {
      const { changePct } = computePickupTrend(0, w3)
      expect(changePct === null || Number.isFinite(changePct)).toBe(true)
    }
  })

  it("reports insufficient_data for non-finite inputs", () => {
    expect(computePickupTrend(Number.NaN, 100).trend).toBe("insufficient_data")
  })

  it("matches the thresholds observed in the reference workbook", () => {
    // Measured across its 239 rows: lowest Up was +15.18%, Held spanned
    // -13.69%..+14.62%, highest Down was -15.46%.
    expect(computePickupTrend(100, 115.18).trend).toBe("up")
    expect(computePickupTrend(100, 114.62).trend).toBe("held")
    expect(computePickupTrend(100, 86.31).trend).toBe("held")
    expect(computePickupTrend(100, 84.54).trend).toBe("down")
  })
})

describe("computeYoy", () => {
  it("suppresses the percentage when STLY is zero", () => {
    const yoy = computeYoy(27646.95, 0)
    expect(yoy.pct).toBeNull()
    expect(yoy.pct_suppressed_reason).toBe("no_stly")
    expect(yoy.delta_abs).toBeCloseTo(27646.95)
  })

  it("suppresses the percentage below the STLY floor", () => {
    // The workbook contains a listing with STLY = $249 reading "+18,013%".
    const yoy = computeYoy(45102.7, 249)
    expect(yoy.pct).toBeNull()
    expect(yoy.pct_suppressed_reason).toBe("small_base")
  })

  it("keeps the percentage exactly at the floor", () => {
    const yoy = computeYoy(10000, WINS_RULES_V1.minStlyRevenue)
    expect(yoy.pct).not.toBeNull()
    expect(yoy.pct_suppressed_reason).toBeNull()
  })

  it("flags an extreme percentage but still reports it", () => {
    const yoy = computeYoy(500000, 10000)
    expect(yoy.pct).toBeCloseTo(49)
    expect(yoy.pct_suppressed_reason).toBe("extreme")
  })

  it("never returns Infinity", () => {
    for (const stly of [0, -100, Number.NaN]) {
      const yoy = computeYoy(1000, stly as number)
      expect(yoy.pct === null || Number.isFinite(yoy.pct)).toBe(true)
    }
  })
})

describe("classifyCandidate", () => {
  it("labels revenue up plus pickup up as a high-confidence Double Win", () => {
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 12000 },
      yoy: { ty: 60000, stly: 50000 },
    })
    const result = classifyCandidate({ evidence, reasonCodes: [] })
    expect(result.category).toBe("double_win")
    expect(result.confidence).toBe("high")
    expect(result.isBlocked).toBe(false)
  })

  it("labels exactly +15% pickup as YoY+ Steady, not Double Win", () => {
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 11500 },
      yoy: { ty: 60000, stly: 50000 },
    })
    expect(classifyCandidate({ evidence, reasonCodes: [] }).category).toBe(
      "yoy_positive_steady"
    )
  })

  it("labels exactly -15% pickup as YoY+ Steady, not conflicting", () => {
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 8500 },
      yoy: { ty: 60000, stly: 50000 },
    })
    expect(classifyCandidate({ evidence, reasonCodes: [] }).category).toBe(
      "yoy_positive_steady"
    )
  })

  it("degrades confidence on a small STLY base", () => {
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 15000 },
      yoy: { ty: 60000, stly: 1000 },
    })
    const result = classifyCandidate({ evidence, reasonCodes: ["small_stly_base"] })
    expect(result.category).toBe("double_win")
    expect(result.confidence).toBe("medium")
  })

  it("treats revenue up with pickup down as a conflicting signal", () => {
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 5000 },
      yoy: { ty: 60000, stly: 50000 },
    })
    expect(classifyCandidate({ evidence, reasonCodes: [] }).category).toBe(
      "conflicting_signal"
    )
  })

  it("treats pickup up with revenue down as a conflicting signal", () => {
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 20000 },
      yoy: { ty: 40000, stly: 50000 },
    })
    expect(classifyCandidate({ evidence, reasonCodes: [] }).category).toBe(
      "conflicting_signal"
    )
  })

  it("routes a listing with no STLY to Market Compass when it beats its comp set", () => {
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 11000 },
      yoy: { ty: 27646, stly: 0 },
      revparIndex: 140,
    })
    const result = classifyCandidate({ evidence, reasonCodes: ["no_stly"] })
    expect(result.category).toBe("market_compass_candidate")
    expect(result.isBlocked).toBe(false)
  })

  it("blocks a Market Compass candidate with an implausible RevPAR Index", () => {
    // The workbook has 16 listings above 250, peaking at 479 — almost always a
    // mis-built comp set rather than a genuine 5x outperformance.
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 11000 },
      yoy: { ty: 18670, stly: 0 },
      revparIndex: 479.53,
    })
    const result = classifyCandidate({
      evidence,
      reasonCodes: ["no_stly", "compset_qa_required"],
    })
    expect(result.isBlocked).toBe(true)
  })

  it("does not treat a no-STLY listing with a falling pickup as a win", () => {
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 4000 },
      yoy: { ty: 27646, stly: 0 },
      revparIndex: 140,
    })
    expect(classifyCandidate({ evidence, reasonCodes: ["no_stly"] }).category).toBe("no_win")
  })

  it("collapses any blocking reason code to insufficient_data", () => {
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 15000 },
      yoy: { ty: 60000, stly: 50000 },
    })
    for (const code of ["stale_source", "currency_mismatch", "unassigned_client"]) {
      const result = classifyCandidate({ evidence, reasonCodes: [code] })
      expect(result.category).toBe("insufficient_data")
      expect(result.isBlocked).toBe(true)
    }
  })

  it("never treats no_pickup as a win", () => {
    const evidence = makeEvidence({
      pickup: { w2: 0, w3: 0 },
      yoy: { ty: 60000, stly: 50000 },
    })
    expect(classifyCandidate({ evidence, reasonCodes: [] }).category).toBe(
      "insufficient_data"
    )
  })
})

describe("isReadyToShare", () => {
  it("keeps conflicting signals out of the default queue", () => {
    expect(
      isReadyToShare({
        category: "conflicting_signal",
        confidence: "low",
        is_blocked: false,
      })
    ).toBe(false)
  })

  it("keeps Market Compass out of the default queue", () => {
    expect(
      isReadyToShare({
        category: "market_compass_candidate",
        confidence: "medium",
        is_blocked: false,
      })
    ).toBe(false)
  })

  it("keeps blocked and already-handled wins out", () => {
    expect(
      isReadyToShare({ category: "double_win", confidence: "high", is_blocked: true })
    ).toBe(false)
    expect(
      isReadyToShare({
        category: "double_win",
        confidence: "high",
        is_blocked: false,
        review_state: "dismissed",
      })
    ).toBe(false)
  })

  it("admits a clean, confident win", () => {
    expect(
      isReadyToShare({
        category: "double_win",
        confidence: "high",
        is_blocked: false,
        review_state: "new",
      })
    ).toBe(true)
  })
})

describe("rankCandidates", () => {
  it("orders by category, then confidence, then absolute pickup delta", () => {
    const base = { client_id: "c1", has_assembly_chat: true, is_blocked: false }
    const ranked = rankCandidates([
      {
        ...base,
        category: "yoy_positive_steady" as const,
        confidence: "medium" as const,
        evidence: makeEvidence({ pickup: { w2: 1000, w3: 9000 } }),
      },
      {
        ...base,
        category: "double_win" as const,
        confidence: "high" as const,
        evidence: makeEvidence({ pickup: { w2: 1000, w3: 2000 } }),
      },
      {
        ...base,
        category: "double_win" as const,
        confidence: "high" as const,
        evidence: makeEvidence({ pickup: { w2: 1000, w3: 5000 } }),
      },
    ])
    expect(ranked.map((r) => r.evidence.pickup.delta_abs)).toEqual([4000, 1000, 8000])
  })

  it("sinks blocked candidates regardless of their numbers", () => {
    const ranked = rankCandidates([
      {
        client_id: "c1",
        has_assembly_chat: true,
        is_blocked: true,
        category: "double_win" as const,
        confidence: "high" as const,
        evidence: makeEvidence({ pickup: { w2: 1000, w3: 90000 } }),
      },
      {
        client_id: "c2",
        has_assembly_chat: true,
        is_blocked: false,
        category: "conflicting_signal" as const,
        confidence: "low" as const,
        evidence: makeEvidence({ pickup: { w2: 1000, w3: 1100 } }),
      },
    ])
    expect(ranked[0].is_blocked).toBe(false)
  })
})

describe("aggregateByClient", () => {
  it("counts wins and negative signals per client", () => {
    const groups = aggregateByClient([
      makeCandidate({ id: "a", client_id: "c1", category: "double_win" }),
      makeCandidate({ id: "b", client_id: "c1", category: "conflicting_signal" }),
      makeCandidate({ id: "c", client_id: "c2", category: "yoy_positive_steady" }),
    ])
    const c1 = groups.find((g) => g.client_id === "c1")!
    expect(c1.wins_count).toBe(1)
    expect(c1.negative_count).toBe(1)
  })

  it("excludes fan-out listings from portfolio pickup so a booking is never counted twice", () => {
    // The reservations matview fans one reservation across several hub
    // listings (177 reservation keys across 3 listings in production), so
    // summing those into a portfolio total would double-count real bookings.
    const groups = aggregateByClient([
      makeCandidate({
        id: "a",
        client_id: "c1",
        evidence: makeEvidence({ pickup: { w2: 1000, w3: 2000 } }),
      }),
      makeCandidate({
        id: "b",
        client_id: "c1",
        reason_codes: ["ambiguous_listing_mapping"],
        evidence: makeEvidence({ pickup: { w2: 5000, w3: 9000 } }),
      }),
    ])
    const c1 = groups.find((g) => g.client_id === "c1")!
    expect(c1.portfolio_pickup_w3).toBe(2000)
    expect(c1.portfolio_pickup_w2).toBe(1000)
    expect(c1.excluded_from_totals).toBe(1)
  })

  it("reconciles listing totals against the client total when there is no fan-out", () => {
    const candidates = [
      makeCandidate({
        id: "a",
        client_id: "c1",
        evidence: makeEvidence({ pickup: { w2: 1000, w3: 2000 }, yoy: { ty: 500, stly: 100 } }),
      }),
      makeCandidate({
        id: "b",
        client_id: "c1",
        evidence: makeEvidence({ pickup: { w2: 3000, w3: 4000 }, yoy: { ty: 700, stly: 200 } }),
      }),
    ]
    const c1 = aggregateByClient(candidates)[0]
    const sumW3 = candidates.reduce((a, c) => a + c.evidence.pickup.w3, 0)
    const sumTy = candidates.reduce((a, c) => a + c.evidence.yoy.revenue_ty, 0)
    expect(c1.portfolio_pickup_w3).toBe(sumW3)
    expect(c1.portfolio_revenue_ty).toBe(sumTy)
  })

  it("groups unassigned listings separately instead of dropping them", () => {
    const groups = aggregateByClient([makeCandidate({ id: "a", client_id: null })])
    expect(groups).toHaveLength(1)
    expect(groups[0].client_id).toBeNull()
  })
})

describe("buildAssemblyDeepLink", () => {
  it("prefers the company chat when a company exists", () => {
    expect(
      buildAssemblyDeepLink({ assembly_company_id: "C1", assembly_client_id: "U1" })
    ).toBe("https://dashboard.assembly.com/companies/C1/messages")
  })

  it("falls back to the individual chat", () => {
    expect(buildAssemblyDeepLink({ assembly_company_id: null, assembly_client_id: "U1" })).toBe(
      "https://dashboard.assembly.com/clients/users/details/U1/messages"
    )
  })

  it("returns null when the client has no chat at all", () => {
    expect(
      buildAssemblyDeepLink({ assembly_company_id: null, assembly_client_id: null })
    ).toBeNull()
  })
})
