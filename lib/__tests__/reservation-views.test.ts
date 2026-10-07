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
const CLIENT_B = "aaaaaaaa-2222-3333-4444-555555555555"

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

  it("keeps exclusion flags only alongside their client/listing", () => {
    expect(sanitizeViewParams({ client: CLIENT, xclient: "1" })).toEqual({
      client: CLIENT,
      xclient: "1",
    })
    // no client to exclude, or a non-"1" flag → dropped
    expect(sanitizeViewParams({ xclient: "1", xlisting: "1" })).toEqual({})
    expect(sanitizeViewParams({ listing: CLIENT, xlisting: "true" })).toEqual({
      listing: CLIENT,
    })
  })

  it("keeps multi-id selections deduped and sorted, dropping bad ids", () => {
    expect(
      sanitizeViewParams({
        client: `${CLIENT_B},not-a-uuid,${CLIENT},${CLIENT_B.toUpperCase()}`,
        xclient: "1",
      })
    ).toEqual({ client: `${CLIENT},${CLIENT_B}`, xclient: "1" })
  })

  it("keeps whole-day booking window bounds only", () => {
    expect(sanitizeViewParams({ bwmin: "15", bwmax: "45" })).toEqual({
      bwmin: "15",
      bwmax: "45",
    })
    expect(sanitizeViewParams({ bwmin: "-3", bwmax: "4.5" })).toEqual({})
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
      clientIds: [CLIENT],
      dateField: "checkin",
      range: "last30",
      sort: "rental_revenue",
      dir: "desc",
    })
    expect(viewMatchesParams(view, current)).toBe(true)
  })

  it("does not match when a filter differs", () => {
    const current = currentViewParams({
      clientIds: [CLIENT],
      dateField: "checkin",
      range: "last7",
      sort: "rental_revenue",
      dir: "desc",
    })
    expect(viewMatchesParams(view, current)).toBe(false)
  })

  it("distinguishes including a client from excluding it", () => {
    const excluding = currentViewParams({
      clientIds: [CLIENT],
      clientExclude: true,
      dateField: "checkin",
      range: "last30",
      sort: "rental_revenue",
      dir: "desc",
    })
    expect(excluding.xclient).toBe("1")
    expect(viewMatchesParams(view, excluding)).toBe(false)
  })

  it("matches a multi-client selection regardless of pick order", () => {
    const multi: ReservationView = {
      id: "v2",
      name: "Not these two",
      params: { client: `${CLIENT_B},${CLIENT}`, xclient: "1", bwmin: "61" },
      created_by: null,
    }
    const current = currentViewParams({
      clientIds: [CLIENT, CLIENT_B],
      clientExclude: true,
      bwMin: 61,
      dateField: "checkin",
      sort: "booked_at",
      dir: "desc",
    })
    expect(viewMatchesParams(multi, current)).toBe(true)
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
