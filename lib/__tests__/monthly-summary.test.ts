import { describe, expect, it } from "vitest"
import {
  activeDaysInMonth,
  computeMonthlySummary,
  daysInMonth,
  type MonthlySummaryListing,
} from "@/lib/monthly-summary"
import { listingBillingEntity } from "@/lib/billing-entity"

function row(overrides: Partial<MonthlySummaryListing>): MonthlySummaryListing {
  return {
    id: "l1",
    name: "Listing",
    status: "active",
    initial_setup_date: null,
    deactivated_date: null,
    client_name: "Client",
    billing_entity: "revfactor",
    ...overrides,
  }
}

describe("activeDaysInMonth", () => {
  it("counts the whole month for a carried-over listing", () => {
    expect(activeDaysInMonth(row({}), "2026-09")).toBe(30)
    expect(activeDaysInMonth(row({ initial_setup_date: "2026-01-10" }), "2026-02")).toBe(28)
  })

  it("counts the setup day through month end for a new listing", () => {
    expect(activeDaysInMonth(row({ initial_setup_date: "2026-09-11" }), "2026-09")).toBe(20)
    expect(activeDaysInMonth(row({ initial_setup_date: "2026-09-30" }), "2026-09")).toBe(1)
  })

  it("stops the day before deactivation", () => {
    const churned = row({ status: "inactive", deactivated_date: "2026-09-11" })
    expect(activeDaysInMonth(churned, "2026-09")).toBe(10)
    expect(activeDaysInMonth(row({ status: "inactive", deactivated_date: "2026-09-01" }), "2026-09")).toBe(0)
  })

  it("handles setup and churn in the same month", () => {
    const r = row({
      status: "inactive",
      initial_setup_date: "2026-09-05",
      deactivated_date: "2026-09-15",
    })
    expect(activeDaysInMonth(r, "2026-09")).toBe(10)
  })

  it("is 0 outside the active window and for undated inactive rows", () => {
    expect(activeDaysInMonth(row({ initial_setup_date: "2026-10-01" }), "2026-09")).toBe(0)
    expect(activeDaysInMonth(row({ status: "inactive" }), "2026-09")).toBe(0)
  })

  it("caps at asOf for the month in progress", () => {
    expect(activeDaysInMonth(row({}), "2026-09", "2026-09-28")).toBe(28)
    expect(activeDaysInMonth(row({ initial_setup_date: "2026-09-20" }), "2026-09", "2026-09-28")).toBe(9)
  })

  it("matches the month's endCount semantics", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", initial_setup_date: "2026-09-11" }),
      row({ id: "c", status: "inactive", deactivated_date: "2026-09-11" }),
    ]
    const s = computeMonthlySummary(rows, "2026-09")
    expect(s.endCount).toBe(2)
    const total = [...s.activeListings, ...s.churnedListings].reduce(
      (sum, r) => sum + activeDaysInMonth(r, "2026-09"),
      0
    )
    expect(total).toBe(30 + 20 + 10)
    expect(daysInMonth("2026-09")).toBe(30)
  })
})

describe("listingBillingEntity", () => {
  it("treats clientless listings and blackbird clients as Blackbird", () => {
    expect(listingBillingEntity(null)).toBe("blackbird")
    expect(listingBillingEntity({ billing_entity: "blackbird" })).toBe("blackbird")
    expect(listingBillingEntity({ billing_entity: "revfactor" })).toBe("revfactor")
    expect(listingBillingEntity({ billing_entity: null })).toBe("revfactor")
  })
})
