import { describe, expect, it } from "vitest"

import { matchesListingStatus } from "@/lib/listing-status"

describe("listing status filtering", () => {
  it("does not treat an inactive listing as active because its client is active", () => {
    expect(matchesListingStatus("inactive", "active")).toBe(false)
  })

  it("keeps inactive listings available in the inactive and all views", () => {
    expect(matchesListingStatus("inactive", "inactive")).toBe(true)
    expect(matchesListingStatus("inactive", "all")).toBe(true)
  })

  it("keeps test listings visible under the default active view", () => {
    expect(matchesListingStatus("test", "active")).toBe(true)
    expect(matchesListingStatus("test", "all")).toBe(true)
  })

  it("isolates test listings under the test view and keeps them out of inactive", () => {
    expect(matchesListingStatus("test", "test")).toBe(true)
    expect(matchesListingStatus("test", "inactive")).toBe(false)
    expect(matchesListingStatus("active", "test")).toBe(false)
    expect(matchesListingStatus("inactive", "test")).toBe(false)
  })
})
