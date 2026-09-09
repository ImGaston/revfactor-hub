import { describe, expect, it } from "vitest"

import { excludeTestListings } from "@/lib/monthly-pacing"

const listings = [
  { listing_id: "pl-1", hub_listing_id: "hub-1" },
  { listing_id: "pl-2", hub_listing_id: "hub-2" },
  { listing_id: "pl-3", hub_listing_id: null },
]
const metrics = [
  { listing_id: "pl-1", period: "2026-09-01" },
  { listing_id: "pl-2", period: "2026-09-01" },
  { listing_id: "pl-3", period: "2026-09-01" },
]

describe("excludeTestListings", () => {
  it("drops a test hub listing and the metrics keyed by its PriceLabs id", () => {
    const out = excludeTestListings(listings, metrics, new Set(["hub-2"]))
    expect(out.listings.map((l) => l.listing_id)).toEqual(["pl-1", "pl-3"])
    expect(out.metrics.map((m) => m.listing_id)).toEqual(["pl-1", "pl-3"])
  })

  it("keeps unlinked report listings and is a no-op without test ids", () => {
    const out = excludeTestListings(listings, metrics, new Set())
    expect(out.listings).toBe(listings)
    expect(out.metrics).toBe(metrics)
  })
})
