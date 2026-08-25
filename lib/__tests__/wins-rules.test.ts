import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  WINS_RULES_V1,
  WINS_RULE_FIELDS,
  evaluateCandidate,
  rawInputsFromEvidence,
  ruleSetFromRow,
  ruleSetToRow,
  validateRuleSet,
  type WinsRuleInput,
} from "@/lib/wins"

import { makeEvidence } from "./wins-helpers"

const baseInput: WinsRuleInput = {
  pickupUpThreshold: 0.15,
  pickupDownThreshold: -0.15,
  minStlyRevenue: 5000,
  revparIndexWinFloor: 105,
  revparIndexQaCeiling: 250,
  maxStalenessDays: 2,
  pickupWindowDays: 31,
  extremeYoyPct: 3,
  occUpPpThreshold: 3,
  adrDownPctThreshold: -0.1,
}

describe("validateRuleSet", () => {
  it("accepts the shipped defaults", () => {
    expect(validateRuleSet(baseInput)).toEqual({ value: baseInput })
  })

  it("rejects cuts that would leave no Held band", () => {
    const result = validateRuleSet({ ...baseInput, pickupUpThreshold: -0.2 })
    expect("error" in result && result.error).toMatch(/Up cut must be above the Down cut/)
  })

  it("rejects a QA ceiling at or below the Market Compass floor", () => {
    const result = validateRuleSet({ ...baseInput, revparIndexQaCeiling: 100 })
    expect("error" in result && result.error).toMatch(/QA ceiling must be above/)
  })

  it("rejects a pickup window outside the supported range", () => {
    expect("error" in validateRuleSet({ ...baseInput, pickupWindowDays: 3 })).toBe(true)
    expect("error" in validateRuleSet({ ...baseInput, pickupWindowDays: 400 })).toBe(true)
  })

  it("rejects a negative STLY floor and a positive ADR watch", () => {
    expect("error" in validateRuleSet({ ...baseInput, minStlyRevenue: -1 })).toBe(true)
    expect("error" in validateRuleSet({ ...baseInput, adrDownPctThreshold: 0.1 })).toBe(true)
  })

  it("rejects non-finite values rather than persisting NaN", () => {
    expect("error" in validateRuleSet({ ...baseInput, minStlyRevenue: Number.NaN })).toBe(true)
  })
})

describe("rule set row mapping", () => {
  it("round-trips through the database column shape", () => {
    const row = { version: 4, ...ruleSetToRow(baseInput) }
    const rules = ruleSetFromRow(row)
    expect(rules.version).toBe("v4")
    for (const field of WINS_RULE_FIELDS) {
      expect(rules[field.key]).toBe(baseInput[field.key])
    }
  })

  it("parses numeric columns that PostgREST returns as strings", () => {
    // NUMERIC columns arrive as strings over PostgREST; treating them as
    // numbers without parsing would make every comparison false.
    const rules = ruleSetFromRow({
      version: 2,
      pickup_up_threshold: "0.2000",
      pickup_down_threshold: "-0.2000",
      min_stly_revenue: "10000.00",
      revpar_index_win_floor: "110.00",
      revpar_index_qa_ceiling: "300.00",
      max_staleness_days: 3,
      pickup_window_days: 31,
      extreme_yoy_pct: "5.00",
      occ_up_pp_threshold: "4.00",
      adr_down_pct_threshold: "-0.2000",
    })
    expect(rules.pickupUpThreshold).toBe(0.2)
    expect(rules.minStlyRevenue).toBe(10000)
    expect(rules.adrDownPctThreshold).toBe(-0.2)
  })

  it("falls back to the shipped defaults for a missing column", () => {
    const rules = ruleSetFromRow({ version: 1 })
    expect(rules.minStlyRevenue).toBe(WINS_RULES_V1.minStlyRevenue)
    expect(rules.pickupUpThreshold).toBe(WINS_RULES_V1.pickupUpThreshold)
  })

  it("covers every editable field in the form metadata", () => {
    const editable = Object.keys(baseInput).sort()
    const described = WINS_RULE_FIELDS.map((f) => f.key).sort()
    expect(described).toEqual(editable)
  })
})

describe("evaluateCandidate", () => {
  const raw = {
    pickupW2: 10000,
    pickupW3: 12000,
    revenueTy: 60000,
    revenueStly: 50000,
    revparIndex: 120,
    marketRevpar: 80,
    occTy: 55,
    occStly: 48,
    adrTy: 300,
    adrStly: 280,
    stalenessDays: 1,
  }
  const rules = { ...baseInput, version: "v1" }

  it("agrees with the standalone helpers it wraps", () => {
    const result = evaluateCandidate(raw, [], rules)
    expect(result.pickupTrend).toBe("up")
    expect(result.category).toBe("double_win")
    expect(result.confidence).toBe("high")
  })

  it("moves a listing between categories when the Up cut moves", () => {
    // +20% pickup: Up under the default cut, Held once the cut passes it.
    const asUp = evaluateCandidate(raw, [], rules)
    const asHeld = evaluateCandidate(raw, [], { ...rules, pickupUpThreshold: 0.25 })
    expect(asUp.category).toBe("double_win")
    expect(asHeld.category).toBe("yoy_positive_steady")
  })

  it("re-derives the STLY floor code instead of trusting the stored one", () => {
    // A stale `small_stly_base` from a previous rule set must not survive.
    const result = evaluateCandidate(raw, ["small_stly_base"], rules)
    expect(result.reasonCodes).not.toContain("small_stly_base")

    const stricter = evaluateCandidate(raw, [], { ...rules, minStlyRevenue: 80000 })
    expect(stricter.reasonCodes).toContain("small_stly_base")
    expect(stricter.confidence).toBe("medium")
  })

  it("re-derives the comp set QA block from the ceiling", () => {
    const clean = evaluateCandidate({ ...raw, revparIndex: 300 }, [], rules)
    expect(clean.reasonCodes).toContain("compset_qa_required")

    const relaxed = evaluateCandidate({ ...raw, revparIndex: 300 }, [], {
      ...rules,
      revparIndexQaCeiling: 400,
    })
    expect(relaxed.reasonCodes).not.toContain("compset_qa_required")
  })

  it("re-derives staleness from the age limit", () => {
    const fresh = evaluateCandidate({ ...raw, stalenessDays: 5 }, [], {
      ...rules,
      maxStalenessDays: 7,
    })
    expect(fresh.reasonCodes).not.toContain("stale_source")

    const stale = evaluateCandidate({ ...raw, stalenessDays: 5 }, [], rules)
    expect(stale.reasonCodes).toContain("stale_source")
    expect(stale.category).toBe("insufficient_data")
  })

  it("carries data-dependent codes through untouched", () => {
    const result = evaluateCandidate(raw, ["unassigned_client", "new_listing"], rules)
    expect(result.reasonCodes).toContain("unassigned_client")
    expect(result.reasonCodes).toContain("new_listing")
    // unassigned_client is blocking, so the category collapses.
    expect(result.category).toBe("insufficient_data")
  })

  it("never emits a percentage when the prior year is absent", () => {
    const result = evaluateCandidate({ ...raw, revenueStly: 0 }, [], rules)
    expect(result.yoy.pct).toBeNull()
    expect(result.reasonCodes).toContain("no_stly")
  })

  it("is deterministic", () => {
    const a = evaluateCandidate(raw, ["new_listing"], rules)
    const b = evaluateCandidate(raw, ["new_listing"], rules)
    expect(a).toEqual(b)
  })
})

describe("rawInputsFromEvidence", () => {
  it("recovers the figures the evaluator needs from a stored snapshot", () => {
    const evidence = makeEvidence({
      pickup: { w2: 5335.97, w3: 36794.12 },
      yoy: { ty: 216135.57, stly: 171010.99 },
      revparIndex: 181.39,
    })
    const raw = rawInputsFromEvidence(evidence, 1)
    expect(raw.pickupW2).toBe(5335.97)
    expect(raw.pickupW3).toBe(36794.12)
    expect(raw.revenueTy).toBe(216135.57)
    expect(raw.revenueStly).toBe(171010.99)
    expect(raw.revparIndex).toBe(181.39)
    expect(raw.stalenessDays).toBe(1)
  })

  it("round-trips a stored candidate back to its original classification", () => {
    // This is what makes the rules editor's preview trustworthy: replaying a
    // stored evidence blob under the same rules must reproduce the same call.
    const evidence = makeEvidence({
      pickup: { w2: 10000, w3: 12000 },
      yoy: { ty: 60000, stly: 50000 },
      revparIndex: 120,
    })
    const result = evaluateCandidate(rawInputsFromEvidence(evidence, 1), [], {
      ...baseInput,
      version: "v1",
    })
    expect(result.category).toBe("double_win")
    expect(result.pickupTrend).toBe(evidence.pickup.trend)
  })
})

describe("076_win_rule_sets.sql", () => {
  const RAW = readFileSync(
    path.join(process.cwd(), "supabase/migrations/076_win_rule_sets.sql"),
    "utf8"
  )
  const SQL = RAW.split("\n")
    .map((l) => {
      const i = l.indexOf("--")
      return i === -1 ? l : l.slice(0, i)
    })
    .join("\n")
    .replace(/[ \t]+/g, " ")

  it("enables RLS and never ships USING (true)", () => {
    expect(SQL).toContain("ALTER TABLE win_rule_sets ENABLE ROW LEVEL SECURITY")
    expect(SQL).not.toMatch(/USING\s*\(\s*true\s*\)/i)
  })

  it("gates publishing on wins:control and reading on wins:view", () => {
    // Policies span several lines, so match across whitespace rather than
    // assuming the formatting.
    expect(SQL).toMatch(
      /FOR SELECT\s+TO authenticated\s+USING \(public\.has_permission\('wins', 'view'\)\)/
    )
    expect(SQL).toMatch(
      /FOR INSERT\s+TO authenticated\s+WITH CHECK \(public\.has_permission\('wins', 'control'\)/
    )
  })

  it("keeps published versions immutable and undeletable", () => {
    expect(SQL).toMatch(/CREATE TRIGGER win_rule_sets_immutable/)
    expect(SQL).toMatch(/Win rule sets are immutable/)
    // No DELETE policy: versions are history.
    expect(SQL).not.toMatch(/ON win_rule_sets FOR DELETE/i)
  })

  it("allows exactly one active rule set", () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX win_rule_sets_one_active_idx/)
    expect(SQL).toMatch(/WHERE is_active/)
  })

  it("guards the activation RPC with IS NOT TRUE", () => {
    expect(SQL).toMatch(/has_permission\('wins', 'control'\) IS NOT TRUE/)
    expect(SQL).not.toMatch(/IF NOT public\.has_permission/)
  })

  it("declares a CHECK for every rule the form validates", () => {
    for (const constraint of [
      "win_rules_pickup_order",
      "win_rules_window",
      "win_rules_stly_floor",
      "win_rules_revpar_order",
      "win_rules_staleness",
      "win_rules_adr_pct",
    ]) {
      expect(SQL).toContain(constraint)
    }
  })

  it("seeds version 1 with the constants the workbook was reconciled against", () => {
    expect(SQL).toMatch(/0\.15, -0\.15, 31/)
    expect(SQL).toMatch(/105, 250/)
  })
})
