import { describe, expect, it } from "vitest"

import {
  addDaysIso,
  addMonthsIso,
  buildWindows,
  daysBetween,
  defaultPeriod,
  monthLabel,
  monthStartIso,
  periodLabel,
  periodMonths,
} from "@/lib/wins"

describe("buildWindows", () => {
  it("reproduces the reference workbook windows exactly", () => {
    // The workbook footnote states: "W3 Jul 13–Aug 12 vs W2 Jun 12–Jul 12,
    // by Booked Date". Anchoring on 2026-08-12 must land on those dates or the
    // Hub is not measuring the same thing the business already agreed on.
    const w = buildWindows("2026-08-12")
    expect(w.w3).toEqual(["2026-07-13", "2026-08-12"])
    expect(w.w2).toEqual(["2026-06-12", "2026-07-12"])
  })

  it("makes every window exactly 31 days inclusive", () => {
    const w = buildWindows("2026-08-12")
    for (const [start, end] of [w.w1, w.w2, w.w3]) {
      expect(daysBetween(start, end) + 1).toBe(31)
    }
  })

  it("keeps the windows contiguous and non-overlapping", () => {
    const w = buildWindows("2026-08-12")
    expect(addDaysIso(w.w2[1], 1)).toBe(w.w3[0])
    expect(addDaysIso(w.w1[1], 1)).toBe(w.w2[0])
  })

  it("handles a leap-year boundary", () => {
    const w = buildWindows("2028-03-01")
    expect(daysBetween(w.w3[0], w.w3[1]) + 1).toBe(31)
    // 2028 is a leap year, so the window must cross Feb 29.
    expect(w.w3[0] <= "2028-02-29" && "2028-02-29" <= w.w3[1]).toBe(true)
  })

  it("handles a year boundary", () => {
    const w = buildWindows("2026-01-15")
    expect(w.w3[0]).toBe("2025-12-16")
    expect(w.w2[1]).toBe("2025-12-15")
  })
})

describe("date helpers", () => {
  it("adds days across month ends", () => {
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01")
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28")
    expect(addDaysIso("2028-03-01", -1)).toBe("2028-02-29")
  })

  it("adds months without drifting on long months", () => {
    expect(addMonthsIso("2026-01-01", 1)).toBe("2026-02-01")
    expect(addMonthsIso("2026-12-01", 1)).toBe("2027-01-01")
    expect(addMonthsIso("2026-03-01", -3)).toBe("2025-12-01")
  })

  it("normalises any date to its month start", () => {
    expect(monthStartIso("2026-08-20")).toBe("2026-08-01")
  })

  it("labels months and periods readably", () => {
    expect(monthLabel("2026-08-01")).toBe("Aug 2026")
    expect(periodLabel("2026-08-01", "2026-10-01")).toBe("Aug–Oct 2026")
    expect(periodLabel("2026-08-01", "2026-08-01")).toBe("Aug 2026")
    expect(periodLabel("2026-11-01", "2027-01-01")).toBe("Nov 2026–Jan 2027")
  })
})

describe("defaultPeriod", () => {
  it("spans the current month plus the next two", () => {
    const p = defaultPeriod("2026-08-20", 3)
    expect(p.start).toBe("2026-08-01")
    expect(p.end).toBe("2026-10-01")
    expect(p.months).toBe(3)
    expect(p.label).toBe("Aug–Oct 2026")
  })

  it("enumerates every month in the period", () => {
    expect(periodMonths(defaultPeriod("2026-08-20", 3))).toEqual([
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ])
  })

  it("supports a single-month period", () => {
    const p = defaultPeriod("2026-08-20", 1)
    expect(periodMonths(p)).toEqual(["2026-08-01"])
  })

  it("stays inside a calendar year when it can", () => {
    // report_metrics covers calendar 2026 (verified: 2026-01 through 2026-12),
    // so a 3-month period anchored mid-year must not run past December.
    const p = defaultPeriod("2026-08-20", 3)
    expect(p.end <= "2026-12-01").toBe(true)
  })
})
