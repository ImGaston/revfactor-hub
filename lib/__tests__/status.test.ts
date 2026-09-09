import { describe, expect, it } from "vitest"

import { clientStatusPatch } from "@/lib/clients"
import {
  CLIENT_STATUSES,
  LISTING_STATUSES,
  TEST_STATUS,
  isTestStatus,
  listingCascadeForClientStatus,
  statusLabel,
} from "@/lib/status"

describe("status constants", () => {
  it("includes test on both clients and listings", () => {
    expect(CLIENT_STATUSES).toContain(TEST_STATUS)
    expect(LISTING_STATUSES).toContain(TEST_STATUS)
    expect(isTestStatus("test")).toBe(true)
    expect(isTestStatus("active")).toBe(false)
    expect(isTestStatus(null)).toBe(false)
    expect(statusLabel("test")).toBe("Test")
  })
})

describe("listingCascadeForClientStatus", () => {
  it("takes every listing inactive when the client goes inactive", () => {
    expect(listingCascadeForClientStatus("inactive")).toEqual({
      set: "inactive",
      onlyFrom: null,
    })
  })

  it("takes only active listings to test when the client becomes test", () => {
    expect(listingCascadeForClientStatus("test")).toEqual({
      set: "test",
      onlyFrom: "active",
    })
  })

  it("never cascades on active or onboarding", () => {
    expect(listingCascadeForClientStatus("active")).toBeNull()
    expect(listingCascadeForClientStatus("onboarding")).toBeNull()
  })
})

describe("clientStatusPatch with test", () => {
  it("does not treat test as churn", () => {
    expect(clientStatusPatch("active", "test", null)).toEqual({})
  })

  it("clears churn data when an inactive client is turned into test", () => {
    expect(clientStatusPatch("inactive", "test", null)).toEqual({
      ending_date: null,
      ending_reason_tags: [],
      ending_note: null,
    })
  })

  it("still stamps ending_date when a test client goes inactive", () => {
    const patch = clientStatusPatch("test", "inactive", "2026-09-09")
    expect(patch).toEqual({ ending_date: "2026-09-09" })
  })
})
