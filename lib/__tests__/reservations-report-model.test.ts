import { describe, expect, it } from "vitest"
import { deriveReportPeriods } from "@/lib/reservations-export"
import {
  buildGrantStyleReportModel,
  computeChannelBreakdown,
  computeListingComparisons,
  computeMonthlyPickup,
} from "@/lib/reservations-report-model"
import { makeReservation } from "./helpers"

const PERIODS = deriveReportPeriods("2026-07-01", "2026-07-28", "2026-07-31")

describe("computeListingComparisons", () => {
  it("full outer join: new listing shows previous 0 and empty pct, lost listing shows current 0", () => {
    const current = [
      makeReservation({ listing_id: "A", listing_name: "Alpha", rental_revenue: 500 }),
      makeReservation({ listing_id: "NEW", listing_name: "Brand New", rental_revenue: 300 }),
    ]
    const previous = [
      makeReservation({ listing_id: "A", listing_name: "Alpha", rental_revenue: 400 }),
      makeReservation({ listing_id: "GONE", listing_name: "Lost", rental_revenue: 200 }),
    ]
    const rows = computeListingComparisons(current, previous)
    expect(rows).toHaveLength(3)

    const brandNew = rows.find((r) => r.listingId === "NEW")!
    expect(brandNew.isNew).toBe(true)
    expect(brandNew.previousRevenue).toBe(0)
    expect(brandNew.revenueChange).toBe(300)
    expect(brandNew.revenueChangePct).toBeNull()
    expect(brandNew.reservationsChangePct).toBeNull()

    const lost = rows.find((r) => r.listingId === "GONE")!
    expect(lost.currentRevenue).toBe(0)
    expect(lost.revenueChange).toBe(-200)
    expect(lost.revenueChangePct).toBeCloseTo(-1)

    const alpha = rows.find((r) => r.listingId === "A")!
    expect(alpha.revenueChange).toBe(100)
    expect(alpha.revenueChangePct).toBeCloseTo(0.25)
  })

  it("zero-revenue base yields null pct, not division blowups", () => {
    const current = [makeReservation({ listing_id: "A", rental_revenue: 100 })]
    const previous = [makeReservation({ listing_id: "A", rental_revenue: null })]
    const rows = computeListingComparisons(current, previous)
    expect(rows[0].previousRevenue).toBe(0)
    expect(rows[0].revenueChangePct).toBeNull()
  })
})

describe("computeMonthlyPickup", () => {
  it("groups revenue by listing × check-in month with totals and contributions", () => {
    const rows = [
      makeReservation({ listing_id: "A", listing_name: "Alpha", check_in: "2026-07-10", rental_revenue: 100 }),
      makeReservation({ listing_id: "A", listing_name: "Alpha", check_in: "2026-08-02", rental_revenue: 300 }),
      makeReservation({ listing_id: "B", listing_name: "Beta", check_in: "2026-08-15", rental_revenue: 600 }),
    ]
    const pickup = computeMonthlyPickup(rows, "2026-07-31")
    expect(pickup.months).toEqual(["2026-07", "2026-08"])
    expect(pickup.hasLater).toBe(false)
    expect(pickup.totalsByMonth["2026-07"]).toBe(100)
    expect(pickup.totalsByMonth["2026-08"]).toBe(900)
    expect(pickup.grandTotal).toBe(1000)
    expect(pickup.contributionByMonth["2026-08"]).toBeCloseTo(0.9)
    const alpha = pickup.rows.find((r) => r.listingId === "A")!
    expect(alpha.byMonth["2026-07"]).toBe(100)
    expect(alpha.byMonth["2026-08"]).toBe(300)
    expect(alpha.total).toBe(400)
  })

  it("collapses check-ins more than 12 months past asOf into Later", () => {
    const rows = [
      makeReservation({ check_in: "2026-08-10", rental_revenue: 100 }),
      makeReservation({ check_in: "2027-07-31", rental_revenue: 200 }), // exactly at cap month
      makeReservation({ check_in: "2027-08-01", rental_revenue: 400 }), // past cap
    ]
    const pickup = computeMonthlyPickup(rows, "2026-07-31")
    expect(pickup.hasLater).toBe(true)
    expect(pickup.months).toEqual(["2026-08", "2027-07"])
    expect(pickup.laterTotal).toBe(400)
    expect(pickup.grandTotal).toBe(700)
    expect(pickup.laterContribution).toBeCloseTo(4 / 7)
  })
})

describe("computeChannelBreakdown", () => {
  it("normalizes channels, keeps raw values and reconciles with totals", () => {
    const rows = [
      makeReservation({ booking_channel: "airbnb", rental_revenue: 100 }),
      makeReservation({ booking_channel: "AirbnbOfficial", rental_revenue: 200 }),
      makeReservation({ booking_channel: "vrbo", rental_revenue: 300 }),
      makeReservation({ booking_channel: null, rental_revenue: 400 }),
    ]
    const channels = computeChannelBreakdown(rows)
    const airbnb = channels.find((c) => c.channel === "Airbnb")!
    expect(airbnb.reservations).toBe(2)
    expect(airbnb.rentalRevenue).toBe(300)
    expect(airbnb.rawChannels).toEqual(["AirbnbOfficial", "airbnb"])
    expect(channels.find((c) => c.channel === "Other")!.rentalRevenue).toBe(400)
    expect(channels.reduce((a, c) => a + c.rentalRevenue, 0)).toBe(1000)
    expect(channels.reduce((a, c) => a + c.reservations, 0)).toBe(4)
  })
})

describe("buildGrantStyleReportModel", () => {
  it("reconciles every block against the KPIs (row counts, revenue, reservations)", () => {
    const current = [
      makeReservation({ listing_id: "A", booking_channel: "airbnb", rental_revenue: 100 }),
      makeReservation({ listing_id: "B", booking_channel: "vrbo", rental_revenue: 200 }),
      makeReservation({ listing_id: "B", booking_channel: null, rental_revenue: null }),
      makeReservation({ listing_id: "C", booking_channel: "manual", booking_window_days: -3 }),
    ]
    const previous = [
      makeReservation({ listing_id: "A", rental_revenue: 50 }),
      makeReservation({ listing_id: "GONE", rental_revenue: 75 }),
    ]
    const model = buildGrantStyleReportModel({
      currentReservations: current,
      previousReservations: previous,
      lastYearReservations: [],
      occupancy: null,
      periods: PERIODS,
    })

    // Reservations rows = current KPI reservation count
    expect(model.currentKpis.reservations).toBe(current.length)
    // Sum listing revenue = current KPI revenue
    expect(
      model.listingBreakdown.reduce((a, l) => a + l.rentalRevenue, 0)
    ).toBeCloseTo(model.currentKpis.rentalRevenue)
    // Sum channel revenue = current KPI revenue
    expect(
      model.channelBreakdown.reduce((a, c) => a + c.rentalRevenue, 0)
    ).toBeCloseTo(model.currentKpis.rentalRevenue)
    // Sum listing reservations = current KPI reservations
    expect(model.listingBreakdown.reduce((a, l) => a + l.reservations, 0)).toBe(
      model.currentKpis.reservations
    )
    // Sum channel reservations = current KPI reservations
    expect(model.channelBreakdown.reduce((a, c) => a + c.reservations, 0)).toBe(
      model.currentKpis.reservations
    )
    // Comparison totals reconcile against current and previous KPIs
    expect(
      model.listingComparisons.reduce((a, l) => a + l.currentRevenue, 0)
    ).toBeCloseTo(model.currentKpis.rentalRevenue)
    expect(
      model.listingComparisons.reduce((a, l) => a + l.previousRevenue, 0)
    ).toBeCloseTo(model.previousKpis.rentalRevenue)
    // No internal reconciliation warnings
    expect(model.warnings.filter((w) => w.code.startsWith("reconciliation_"))).toEqual([])
    // Occupancy missing → discreet warning present
    expect(model.warnings.some((w) => w.code === "occupancy_unavailable")).toBe(true)
    // Negative booking window note
    expect(model.warnings.some((w) => w.code === "negative_booking_windows")).toBe(true)
  })

  it("flags mixed currencies and keeps KPI math running", () => {
    const model = buildGrantStyleReportModel({
      currentReservations: [
        makeReservation({ currency: "USD", rental_revenue: 100 }),
        makeReservation({ currency: "EUR", rental_revenue: 200 }),
      ],
      previousReservations: [],
      lastYearReservations: [],
      occupancy: null,
      periods: PERIODS,
    })
    expect(model.warnings.some((w) => w.code === "mixed_currencies")).toBe(true)
    expect(model.currentKpis.rentalRevenue).toBe(300)
  })

  it("does not truncate breakdowns at 38 listings and caps chart data at 10", () => {
    const current = Array.from({ length: 45 }, (_, i) =>
      makeReservation({
        listing_id: `L${i}`,
        listing_name: `Listing ${i}`,
        rental_revenue: 100 + i,
      })
    )
    const model = buildGrantStyleReportModel({
      currentReservations: current,
      previousReservations: [],
      lastYearReservations: [],
      occupancy: null,
      periods: PERIODS,
    })
    expect(model.listingBreakdown).toHaveLength(45)
    expect(model.listingComparisons).toHaveLength(45)
    expect(model.channelChartData.listings).toHaveLength(10)
    // chart keeps the top listings by revenue
    expect(model.channelChartData.listings[0]).toBe("Listing 44")
  })

  it("splits booking-window segments and their revenue percentages per listing", () => {
    const current = [
      makeReservation({ listing_id: "A", booking_window_days: 5, rental_revenue: 250 }),
      makeReservation({ listing_id: "A", booking_window_days: 30, rental_revenue: 750 }),
    ]
    const model = buildGrantStyleReportModel({
      currentReservations: current,
      previousReservations: [],
      lastYearReservations: [],
      occupancy: null,
      periods: PERIODS,
    })
    const listing = model.listingBreakdown[0]
    expect(listing.segments["0-14"].count).toBe(1)
    expect(listing.segments["0-14"].revenuePct).toBeCloseTo(0.25)
    expect(listing.segments["15-45"].revenuePct).toBeCloseTo(0.75)
    const pctSum = Object.values(listing.segments).reduce(
      (a, s) => a + (s.revenuePct ?? 0),
      0
    )
    expect(pctSum).toBeCloseTo(1)
  })
})
