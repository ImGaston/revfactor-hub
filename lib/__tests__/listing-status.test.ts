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
})
