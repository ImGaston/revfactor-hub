import { describe, expect, it } from "vitest"
import {
  addDays,
  addMonthsClamped,
  bucketBookingWindow,
  buildExportFilename,
  computeKpis,
  deriveReportPeriods,
  filterByPeriod,
  median,
  minusOneYearClamped,
  normalizeChannel,
  pctChange,
  sanitizeFilenamePart,
} from "@/lib/reservations-export"
import { makeReservation } from "./helpers"

describe("deriveReportPeriods", () => {
  it("aligns the previous period to the previous month by day of month (Jul 1-28 → Jun 1-28)", () => {
    const p = deriveReportPeriods("2026-07-01", "2026-07-28", "2026-07-31")
    expect(p.current).toEqual({ from: "2026-07-01", to: "2026-07-28" })
    expect(p.previousMonthAligned).toEqual({ from: "2026-06-01", to: "2026-06-28" })
    expect(p.lastYear).toEqual({ from: "2025-07-01", to: "2025-07-28" })
  })

  it("clamps to the end of a shorter previous month (Mar 29-31 → Feb 28 in a non-leap year)", () => {
    const p = deriveReportPeriods("2026-03-29", "2026-03-31", "2026-03-31")
    expect(p.previousMonthAligned).toEqual({ from: "2026-02-28", to: "2026-02-28" })
  })

  it("keeps Feb 29 when the previous month allows it in a leap year", () => {
    const p = deriveReportPeriods("2024-03-29", "2024-03-31", "2024-03-31")
    expect(p.previousMonthAligned).toEqual({ from: "2024-02-29", to: "2024-02-29" })
  })

  it("handles Feb 29 in last-year math (2024-02-29 → 2023-02-28)", () => {
    const p = deriveReportPeriods("2024-02-01", "2024-02-29", "2024-02-29")
    expect(p.lastYear).toEqual({ from: "2023-02-01", to: "2023-02-28" })
  })

  it("derives occupancy month and inclusive 60/90-day horizons from asOf", () => {
    const p = deriveReportPeriods("2026-07-01", "2026-07-28", "2026-07-31")
    expect(p.asOf).toBe("2026-07-31")
    expect(p.occupancyCurrentMonth).toEqual({ from: "2026-07-01", to: "2026-07-31" })
    expect(p.next60Days).toEqual({ from: "2026-07-31", to: "2026-09-28" })
    expect(p.next90Days).toEqual({ from: "2026-07-31", to: "2026-10-28" })
  })
})

describe("date math", () => {
  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
  })

  it("addMonthsClamped clamps month-end days", () => {
    expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28")
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28")
    expect(addMonthsClamped("2024-03-31", -1)).toBe("2024-02-29")
    expect(addMonthsClamped("2026-07-15", -1)).toBe("2026-06-15")
  })

  it("minusOneYearClamped clamps Feb 29", () => {
    expect(minusOneYearClamped("2024-02-29")).toBe("2023-02-28")
    expect(minusOneYearClamped("2026-07-28")).toBe("2025-07-28")
  })
})

describe("filterByPeriod", () => {
  it("filters inclusively on the chosen field and drops the 1970 sentinel", () => {
    const rows = [
      makeReservation({ booked_date: "2026-07-01" }),
      makeReservation({ booked_date: "2026-07-28" }),
      makeReservation({ booked_date: "2026-06-30" }),
      makeReservation({ booked_date: "1970-01-01" }),
      makeReservation({ booked_date: null }),
    ]
    const filtered = filterByPeriod(rows, "booked_date", {
      from: "2026-07-01",
      to: "2026-07-28",
    })
    expect(filtered).toHaveLength(2)
  })
})

describe("median / buckets / pctChange", () => {
  it("median handles odd, even and empty inputs", () => {
    expect(median([])).toBeNull()
    expect(median([3])).toBe(3)
    expect(median([1, 9, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it("bucketBookingWindow maps the five segments and clamps negatives at the caller", () => {
    expect(bucketBookingWindow(0)).toBe("0-14")
    expect(bucketBookingWindow(14)).toBe("0-14")
    expect(bucketBookingWindow(15)).toBe("15-45")
    expect(bucketBookingWindow(45)).toBe("15-45")
    expect(bucketBookingWindow(46)).toBe("46-60")
    expect(bucketBookingWindow(60)).toBe("46-60")
    expect(bucketBookingWindow(61)).toBe("61-120")
    expect(bucketBookingWindow(120)).toBe("61-120")
    expect(bucketBookingWindow(121)).toBe("120+")
  })

  it("pctChange returns null for a zero or unknown base", () => {
    expect(pctChange(100, 0)).toBeNull()
    expect(pctChange(100, null)).toBeNull()
    expect(pctChange(150, 100)).toBeCloseTo(0.5)
    expect(pctChange(50, -100)).toBeCloseTo(1.5)
  })
})

describe("computeKpis", () => {
  it("counts null-revenue reservations but adds zero to sums; ADR is revenue/nights", () => {
    const rows = [
      makeReservation({ rental_revenue: 1000, number_of_days: 5 }),
      makeReservation({ rental_revenue: null, number_of_days: 3 }),
    ]
    const k = computeKpis(rows)
    expect(k.reservations).toBe(2)
    expect(k.rentalRevenue).toBe(1000)
    expect(k.nights).toBe(8)
    expect(k.adr).toBeCloseTo(1000 / 8)
    expect(k.avgRevenuePerReservation).toBe(500)
  })

  it("clamps negative booking windows to 0 for the median and counts them", () => {
    const rows = [
      makeReservation({ booking_window_days: -5 }),
      makeReservation({ booking_window_days: 10 }),
      makeReservation({ booking_window_days: 20 }),
    ]
    const k = computeKpis(rows)
    expect(k.bookingWindowMedian).toBe(10) // median of [0, 10, 20]
    expect(k.negativeBookingWindows).toBe(1)
  })

  it("reports distinct listings by listing_id and collects currencies", () => {
    const rows = [
      makeReservation({ listing_id: "1", currency: "USD" }),
      makeReservation({ listing_id: "1", currency: "USD" }),
      makeReservation({ listing_id: "2", currency: "CAD" }),
      makeReservation({ listing_id: null, listing_name: "Fallback" }),
    ]
    const k = computeKpis(rows)
    expect(k.listings).toBe(3)
    expect(k.currencies.sort()).toEqual(["CAD", "USD"])
  })
})

describe("normalizeChannel", () => {
  it("maps known raw values without losing specificity", () => {
    expect(normalizeChannel("airbnb")).toBe("Airbnb")
    expect(normalizeChannel("AirbnbOfficial")).toBe("Airbnb")
    expect(normalizeChannel("vrbo")).toBe("Vrbo/Homeaway")
    expect(normalizeChannel("Homeaway")).toBe("Vrbo/Homeaway")
    expect(normalizeChannel("bcom")).toBe("Booking.com")
    expect(normalizeChannel("Bookingengine")).toBe("Booking Engine/Direct Website")
    expect(normalizeChannel("direct website")).toBe("Booking Engine/Direct Website")
    expect(normalizeChannel("manual")).toBe("Direct/Manual")
    expect(normalizeChannel("Direct")).toBe("Direct/Manual")
    expect(normalizeChannel("Marriott")).toBe("Marriott")
    expect(normalizeChannel("Partner")).toBe("Partner")
    expect(normalizeChannel("Google")).toBe("Google")
    expect(normalizeChannel("others")).toBe("Other")
    expect(normalizeChannel(null)).toBe("Other")
  })
})

describe("filenames", () => {
  it("sanitizes non-ASCII and unsafe characters", () => {
    expect(sanitizeFilenamePart("Grant / Añejo")).toBe("Grant_Anejo")
    expect(buildExportFilename("Grant", "2026-07-01", "2026-07-28")).toBe(
      "Reservations_Grant_2026-07-01_2026-07-28.xlsx"
    )
  })
})
