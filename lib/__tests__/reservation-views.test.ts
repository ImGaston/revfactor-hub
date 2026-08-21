import { describe, expect, it } from "vitest"
import {
  resolveDateRangePreset,
} from "@/lib/date-range-presets"
import {
  currentViewParams,
  sanitizeViewParams,
  viewMatchesParams,
  viewParamsAreEmpty,
  viewSearchString,
  type ReservationView,
} from "@/lib/reservation-views"

const CLIENT = "11111111-2222-3333-4444-555555555555"

describe("resolveDateRangePreset", () => {
  const today = new Date(2026, 7, 21) // Aug 21, 2026

  it("resolves rolling windows inclusive of today", () => {
    expect(resolveDateRangePreset("last7", today)).toEqual({
      from: "2026-08-15",
      to: "2026-08-21",
    })
    expect(resolveDateRangePreset("last30", today)).toEqual({
      from: "2026-07-23",
      to: "2026-08-21",
    })
  })

  it("resolves calendar-anchored ranges", () => {
    expect(resolveDateRangePreset("thismonth", today)).toEqual({
      from: "2026-08-01",
      to: "2026-08-21",
    })
    expect(resolveDateRangePreset("lastmonth", today)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    })
    expect(resolveDateRangePreset("ytd", today)).toEqual({
      from: "2026-01-01",
      to: "2026-08-21",
    })
  })

  it("clamps last month across a year boundary", () => {
    expect(resolveDateRangePreset("lastmonth", new Date(2026, 0, 15))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    })
  })
})

describe("sanitizeViewParams", () => {
  it("rejects non-objects", () => {
    expect(sanitizeViewParams(null)).toBeNull()
    expect(sanitizeViewParams("client=x")).toBeNull()
    expect(sanitizeViewParams([1])).toBeNull()
  })

  it("keeps valid keys and drops unknown, malformed, and default values", () => {
    expect(
      sanitizeViewParams({
        client: CLIENT,
        listing: "not-a-uuid",
        df: "checkin", // the default → dropped
        q: "  cabin  ",
        sort: "booked_at",
        dir: "desc", // default sort → dropped
        evil: "ignored",
      })
    ).toEqual({ client: CLIENT, q: "cabin" })
  })

  it("lets a relative range win over absolute dates", () => {
    expect(
      sanitizeViewParams({ range: "last30", from: "2026-01-01", to: "2026-02-01" })
    ).toEqual({ range: "last30" })
  })

  it("keeps absolute dates when no valid range preset is present", () => {
    expect(sanitizeViewParams({ range: "nope", from: "2026-01-01" })).toEqual({
      from: "2026-01-01",
    })
  })

  it("keeps a non-default sort with its direction", () => {
    expect(sanitizeViewParams({ sort: "rental_revenue", dir: "asc" })).toEqual({
      sort: "rental_revenue",
      dir: "asc",
    })
  })
})

describe("view matching", () => {
  const view: ReservationView = {
    id: "v1",
    name: "Big bookings",
    params: { client: CLIENT, range: "last30", sort: "rental_revenue", dir: "desc" },
    created_by: null,
  }

  it("matches when the current filters canonicalize to the same params", () => {
    const current = currentViewParams({
      clientId: CLIENT,
      dateField: "checkin",
      range: "last30",
      sort: "rental_revenue",
      dir: "desc",
    })
    expect(viewMatchesParams(view, current)).toBe(true)
  })

  it("does not match when a filter differs", () => {
    const current = currentViewParams({
      clientId: CLIENT,
      dateField: "checkin",
      range: "last7",
      sort: "rental_revenue",
      dir: "desc",
    })
    expect(viewMatchesParams(view, current)).toBe(false)
  })

  it("serializes params in a stable order", () => {
    expect(viewSearchString({ q: "a", client: CLIENT })).toBe(
      `client=${CLIENT}&q=a`
    )
  })

  it("treats no-filter state as empty", () => {
    expect(
      viewParamsAreEmpty(
        currentViewParams({ dateField: "checkin", sort: "booked_at", dir: "desc" })
      )
    ).toBe(true)
  })
})
