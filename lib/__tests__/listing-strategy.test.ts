import { describe, expect, it } from "vitest"

import {
  answeredDecisions,
  approvalSummary,
  missingForApproval,
  planMinimum,
  planVsLive,
  type PlanQuestion,
  type PricingPlan,
} from "@/lib/listing-strategy"

const q = (p: Partial<PlanQuestion>): PlanQuestion => ({
  id: "q1",
  listing_id: "l1",
  sort_order: 0,
  who: "owner",
  question: "Is December blocked?",
  why: null,
  kind: "choice",
  options: ["Yes", "No, open it"],
  decisions: { "No, open it": "Open Dec 19 – Jan 3 now." },
  feeds: null,
  required_for_approval: true,
  answer: null,
  answered_at: null,
  ...p,
})

const plan = (p: Partial<PricingPlan> = {}): PricingPlan => ({
  id: "p1",
  listing_id: "l1",
  version: 1,
  status: "draft",
  floor_payout: 230,
  base_price: 325,
  max_price: 950,
  booking_window: "12 months",
  channels: [],
  seasons: [{ name: "Christmas", dates: "Dec 19 – 25", plMin: 450, minStay: "5", rules: "No check-in/out Dec 25" }],
  targets: [],
  anchors: {},
  comps: {},
  events: [],
  rules: [],
  approved_at: null,
  updated_at: "2026-10-14",
  ...p,
})

describe("listing strategy", () => {
  it("blocks approval until required questions are answered", () => {
    expect(missingForApproval([q({})])).toHaveLength(1)
    expect(missingForApproval([q({ answer: "Yes" })])).toHaveLength(0)
    expect(missingForApproval([q({ required_for_approval: false })])).toHaveLength(0)
  })

  it("turns choice answers into decision lines", () => {
    expect(answeredDecisions([q({ answer: "No, open it" })])).toEqual([{ question: "Is December blocked?", decision: "Open Dec 19 – Jan 3 now." }])
    expect(answeredDecisions([q({ answer: "Yes" })])).toEqual([])
  })

  it("derives the PriceLabs minimum from the payout floor with policy channels", () => {
    expect(planMinimum(plan())?.min).toBe(275)
    expect(planMinimum(plan({ floor_payout: null }))).toBeNull()
  })

  it("compares plan with live values and summarizes changes for the setup adjustment", () => {
    const rows = planVsLive(plan(), { min: 229, base: 391, max: 867 })
    expect(rows[0]).toMatchObject({ setting: "PriceLabs minimum", live: "$229", plan: "$275", changed: true })
    expect(rows.find((r) => r.setting.startsWith("Season: Christmas"))?.plan).toBe("min $450 · 5 nights")
    const text = approvalSummary(plan(), { min: 229, base: 391, max: 867 }, [q({ answer: "No, open it" })])
    expect(text).toContain("Pricing plan v1 approved")
    expect(text).toContain("PriceLabs minimum: $229 → $275")
    expect(text).toContain("Open Dec 19 – Jan 3 now.")
  })
})
