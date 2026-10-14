import { describe, expect, it } from "vitest"

import {
  DEFAULT_PLAN_CHANNELS,
  appliedDiscounts,
  buildHistory,
  buildSuggestions,
  curveAt,
  draftTargetsFromHistory,
  economics,
  minPriceForFloor,
  monthPace,
  payoutShare,
  targetRevenue,
  tightestChannel,
  type PlanChannel,
  type PlanReservation,
} from "@/lib/pricing-plan"

const ch = (key: string): PlanChannel => structuredClone(DEFAULT_PLAN_CHANNELS.find((c) => c.key === key)!)

const res = (p: Partial<PlanReservation>): PlanReservation => ({
  booked_date: "2026-01-01",
  check_in: "2026-02-01",
  check_out: "2026-02-04",
  number_of_days: 3,
  booking_status: "booked",
  booking_channel: "airbnb",
  rental_revenue: 900,
  booking_window_days: 31,
  ...p,
})

describe("channel math", () => {
  it("matches the Oct 13 drafts: Airbnb monthly 0.876, Vrbo monthly 0.841", () => {
    expect(payoutShare(ch("airbnb"), appliedDiscounts(ch("airbnb"), 30, "worst"))).toBeCloseTo(0.876, 3)
    expect(payoutShare(ch("vrbo"), appliedDiscounts(ch("vrbo"), 30, "worst"))).toBeCloseTo(0.841, 3)
  })

  it("derives the PriceLabs minimum from the payout floor on the tightest channel", () => {
    expect(minPriceForFloor(ch("airbnb"), 900)).toBe(1030)
    const t = tightestChannel(DEFAULT_PLAN_CHANNELS, 230)
    expect(t?.ch.key).toBe("vrbo")
    expect(t?.min).toBe(275)
  })

  it("applies one Airbnb length-of-stay tier, or a larger early-bird deal when switched on", () => {
    const a = ch("airbnb")
    expect(appliedDiscounts(a, 4, "auto").map((d) => d.pct)).toEqual([0.21])
    expect(appliedDiscounts(a, 8, "auto").map((d) => d.pct)).toEqual([0.24])
    expect(appliedDiscounts(a, 2, "auto")).toEqual([])
    a.discounts.find((d) => d.label === "Early bird")!.on = true
    expect(appliedDiscounts(a, 2, "auto").map((d) => d.pct)).toEqual([0.2])
    expect(appliedDiscounts(a, 8, "auto").map((d) => d.pct)).toEqual([0.24])
  })

  it("stacks Booking.com promos that are on, and all of them in the worst case", () => {
    const b = ch("bcom")
    expect(appliedDiscounts(b, 3, "auto").map((d) => d.label)).toEqual(["Genius level 1"])
    expect(appliedDiscounts(b, 3, "worst")).toHaveLength(2)
  })
})

describe("history and pace", () => {
  const rows = [
    res({}),
    res({ booking_status: "cancelled", rental_revenue: 0 }),
    res({ booking_channel: "bcom", booked_date: "2026-09-01", check_in: "2026-11-10", check_out: "2026-11-14", number_of_days: 4, rental_revenue: 1200, booking_window_days: 70 }),
  ]
  const h = buildHistory(rows, "2026-10-13")

  it("splits stayed nights from nights on the books and counts cancellations", () => {
    expect(h.nights["2026-02"]).toBe(3)
    expect(h.revenue["2026-02"]).toBeCloseTo(900)
    expect(h.onBooksNights["2026-11"]).toBe(4)
    expect(h.channels.find((c) => c.code === "airbnb")?.cancelled).toBe(1)
    expect(h.avgStay).toBe(3.5)
  })

  it("builds the booking curve from lead times of stayed nights", () => {
    // stayed nights were booked 31, 32, 33 days ahead
    expect(curveAt(h, 0)).toBe(1)
    expect(curveAt(h, 32)).toBeCloseTo(2 / 3)
    expect(curveAt(h, 60)).toBe(0)
  })

  it("draft targets start from the same month last year", () => {
    const t = draftTargetsFromHistory(h, "2027-01-13")
    expect(t[0].month).toBe("2027-02")
    expect(t[0].occ).toBeCloseTo(3 / 28, 2)
    expect(t[0].adr).toBe(300)
  })

  it("pace compares on-the-books nights with what the curve expects by now", () => {
    const p = monthPace({ month: "2026-11", occ: 0.5, adr: 300 }, h, "2026-10-13")
    expect(p.lead).toBe(33)
    expect(p.onBooksNights).toBe(4)
    // 1 of 3 stayed nights was booked 33+ days ahead → expect 15 × 1/3 = 5 nights now
    expect(p.curve).toBeCloseTo(1 / 3)
    expect(p.expectedNow).toBeCloseTo(5)
    expect(p.pace).toBeCloseTo(0.8)
  })
})

describe("economics and suggestions", () => {
  it("nets payout after channel fees, cleaning, fixed costs and fee", () => {
    const targets = [{ month: "2026-11", occ: 0.5, adr: 300 }]
    const e = economics(targets, [ch("airbnb")], [1], { fixedMonthly: 1000, cleaningPerTurn: 100, guestCleaningFee: 0, avgStay: 3, revfactorMonthly: 350 })
    expect(targetRevenue(targets[0])).toBe(4500)
    expect(e.payout).toBeCloseTo(4500 * 0.845)
    expect(e.net).toBeCloseTo(4500 * 0.845 - 5 * 100 - 1000 - 350)
  })

  it("flags an empty month inside 90 days as critical", () => {
    const stayed = Array.from({ length: 20 }, (_, i) =>
      res({ booked_date: "2026-01-01", check_in: `2026-03-${String(i + 1).padStart(2, "0")}`, number_of_days: 1, rental_revenue: 300, booking_window_days: 60 + i })
    )
    const h = buildHistory(stayed, "2026-10-13")
    const s = buildSuggestions({ targets: [{ month: "2026-12", occ: 0.8, adr: 400 }], history: h, channels: DEFAULT_PLAN_CHANNELS, floor: 230, today: "2026-10-13" })
    expect(s[0].severity).toBe("critical")
    expect(s[0].title).toContain("December")
    expect(s.some((x) => x.id === "tightest")).toBe(true)
  })
})
