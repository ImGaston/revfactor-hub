import { describe, expect, it } from "vitest"

import {
  changeWindows,
  computeOutcome,
  dueCheckpoints,
  judgeOutcome,
  onTheBooks,
  windowStats,
  type OutcomeMetrics,
  type OutcomeReservation,
} from "@/lib/listing-outcomes"
import { DEFAULT_PLAN_CHANNELS } from "@/lib/pricing-plan"

const res = (o: Partial<OutcomeReservation> & { booked: string; in: string; nights: number }): OutcomeReservation => ({
  booked_at: `${o.booked}T12:00:00Z`,
  check_in: o.in,
  check_out: null,
  number_of_days: o.nights,
  booking_status: o.booking_status ?? "booked",
  booking_channel: o.booking_channel ?? "airbnb",
  cancelled_at: o.cancelled_at ?? null,
  rental_revenue: o.rental_revenue ?? o.nights * 400,
  booking_window_days: o.booking_window_days ?? 30,
})

describe("changeWindows", () => {
  it("groups change sets a few days apart and skips proposals", () => {
    const w = changeWindows([
      { id: "b", title: "Markups", status: "applied", approved_at: "2026-10-15T01:05:00Z", created_at: "x" },
      { id: "a", title: "Prices", status: "verified", approved_at: "2026-10-15T00:06:00Z", created_at: "x" },
      { id: "c", title: "Fee", status: "applied", approved_at: "2026-10-17T02:00:00Z", created_at: "x" },
      { id: "p", title: "Idea", status: "proposed", approved_at: null, created_at: "2026-10-20T00:00:00Z" },
      { id: "d", title: "Events", status: "applied", approved_at: "2026-11-20T00:00:00Z", created_at: "x" },
    ])
    expect(w).toEqual([
      { changeSetId: "a", start: "2026-10-15", titles: ["Prices", "Markups", "Fee"], changeSetIds: ["a", "b", "c"] },
      { changeSetId: "d", start: "2026-11-20", titles: ["Events"], changeSetIds: ["d"] },
    ])
  })
})

describe("dueCheckpoints", () => {
  it("lists reached checkpoints without a review", () => {
    expect(dueCheckpoints("2026-10-15", "2026-10-21", [])).toEqual([])
    expect(dueCheckpoints("2026-10-15", "2026-10-22", [])).toEqual([7])
    expect(dueCheckpoints("2026-10-15", "2026-11-20", [7])).toEqual([14, 30])
  })
})

describe("windowStats", () => {
  it("counts kept bookings, ADR, payout after channel fees and mix", () => {
    const rows = [
      res({ booked: "2026-10-16", in: "2026-12-01", nights: 4, rental_revenue: 2000 }),
      res({ booked: "2026-10-18", in: "2026-12-10", nights: 2, booking_channel: "bcom", rental_revenue: 800 }),
      res({ booked: "2026-10-19", in: "2026-12-20", nights: 3, booking_status: "cancelled", rental_revenue: 0 }),
      res({ booked: "2026-09-01", in: "2026-12-25", nights: 5 }),
    ]
    const s = windowStats(rows, "2026-10-15", "2026-10-20", DEFAULT_PLAN_CHANNELS)
    expect(s).toMatchObject({ bookings: 2, nights: 6, revenue: 2800, adr: 466.67, avgLos: 3, cancelled: 1 })
    // Airbnb 2000 × (1 − 0.155) + Booking.com 800 × (1 − 0.15) = 1690 + 680 = 2370 / 6
    expect(s.payoutPerNight).toBe(395)
    expect(s.channels.map((c) => [c.key, c.nights])).toEqual([["airbnb", 4], ["bcom", 2]])
  })
})

describe("onTheBooks", () => {
  const rows = [
    res({ booked: "2026-09-01", in: "2026-10-20", nights: 5, rental_revenue: 1000 }),
    // Booked before as-of, cancelled after it: on the books then (nights only).
    res({ booked: "2026-09-02", in: "2026-11-01", nights: 4, booking_status: "cancelled", cancelled_at: "2026-10-30T00:00:00Z", rental_revenue: 0 }),
    // Cancelled before as-of: not on the books.
    res({ booked: "2026-09-03", in: "2026-11-05", nights: 2, booking_status: "cancelled", cancelled_at: "2026-10-01T00:00:00Z" }),
    // Booked after as-of.
    res({ booked: "2026-10-20", in: "2026-11-10", nights: 3 }),
    // Straddles the horizon end: only nights inside count.
    res({ booked: "2026-09-04", in: "2026-11-12", nights: 4, rental_revenue: 800 }),
  ]
  it("reconstructs nights and kept revenue as of a past date", () => {
    // Stays Oct 15 – Nov 14 (30 nights): 5 + 4 + 2 (Nov 12–13) = 11
    expect(onTheBooks(rows, "2026-10-15", "2026-10-15", 30)).toEqual({ nights: 11, revenue: 1000 + 400 })
  })
})

describe("computeOutcome + judgeOutcome", () => {
  const base = { windowStart: "2026-10-15", floor: 230 }

  it("is too early with few bookings before day 30", () => {
    const m = computeOutcome({ ...base, asOf: "2026-10-22", reservations: [res({ booked: "2026-10-16", in: "2026-12-01", nights: 3 })] })
    expect(judgeOutcome(m).verdict).toBe("too_early")
  })

  it("uses the span before when last year isn't covered", () => {
    const rows = [
      ...[20, 22, 24, 26].map((d) => res({ booked: `2026-09-${d}`, in: "2026-12-01", nights: 3, rental_revenue: 900 })),
      ...[16, 18, 20, 22].map((d) => res({ booked: `2026-10-${d}`, in: "2027-01-10", nights: 3, rental_revenue: 1200 })),
    ]
    const m = computeOutcome({ ...base, asOf: "2026-11-13", reservations: rows })
    expect(m.lastYear).toBeNull()
    expect(m.baseline).toBe("before")
    expect(m.before).toMatchObject({ bookings: 4, adr: 300 })
    expect(m.after).toMatchObject({ bookings: 4, adr: 400 })
    expect(judgeOutcome(m).verdict).toBe("on_track")
  })

  it("is off track when pace is far behind last year", () => {
    const rows = [
      res({ booked: "2025-09-01", in: "2025-09-01", nights: 1 }), // history starts a year+ back
      // Last year: 40 nights on the books for the next 90 days as of 2025-11-13.
      ...Array.from({ length: 10 }, (_, i) => res({ booked: "2025-10-01", in: `2025-12-${String(i * 2 + 1).padStart(2, "0")}`, nights: 4 })),
      // This year: 12 nights.
      ...Array.from({ length: 3 }, (_, i) => res({ booked: "2026-10-20", in: `2026-12-${String(i * 5 + 1).padStart(2, "0")}`, nights: 4 })),
    ]
    const m = computeOutcome({ ...base, asOf: "2026-11-13", reservations: rows })
    expect(m.pace.find((p) => p.horizon === 90)).toMatchObject({ nights: 12, nightsStly: 40 })
    const j = judgeOutcome(m)
    expect(j.verdict).toBe("off_track")
    expect(j.reasons.some((r) => r.includes("Next 90 days"))).toBe(true)
  })

  it("is off track when payout per night is under the floor", () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      res({ booked: `2026-10-${16 + i}`, in: "2026-12-01", nights: 2, rental_revenue: 400 })
    )
    const m = computeOutcome({ ...base, asOf: "2026-11-13", reservations: rows })
    expect(m.after.payoutPerNight).toBeLessThan(230)
    expect(judgeOutcome(m).verdict).toBe("off_track")
  })

  it("reads market context from snapshots", () => {
    const m = computeOutcome({
      ...base,
      asOf: "2026-11-13",
      reservations: [],
      snapshots: [
        { snapshot_date: "2026-10-16", occupancy_next_30: 50, market_occupancy_next_30: 55, occupancy_next_90: null, market_occupancy_next_90: null, mpi_next_30: 0.9 },
        { snapshot_date: "2026-11-12", occupancy_next_30: 70, market_occupancy_next_30: 60, occupancy_next_90: null, market_occupancy_next_90: null, mpi_next_30: 1.2 },
      ],
    })
    expect(m.market).toEqual({
      start: { date: "2026-10-16", occ30: 50, market30: 55 },
      latest: { date: "2026-11-12", occ30: 70, market30: 60, mpi30: 1.2 },
    })
    expect(judgeOutcome(m as OutcomeMetrics).reasons).toContain("Next 30 days occupancy 70% vs market 60%")
  })
})

describe("changeWindows: observation-only sets", () => {
  it("doesn't start a window from a baseline read", () => {
    const w = changeWindows([
      { id: "base", title: "Baseline read", status: "verified", approved_at: "2026-10-14T20:00:00Z", created_at: "x", observationOnly: true },
      { id: "a", title: "Prices", status: "verified", approved_at: "2026-10-15T00:06:00Z", created_at: "x" },
    ])
    expect(w).toEqual([{ changeSetId: "a", start: "2026-10-15", titles: ["Prices"], changeSetIds: ["a"] }])
  })
})
