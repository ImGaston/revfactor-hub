import { describe, expect, it } from "vitest"

import { buildOwnerMessage, topFixes } from "@/lib/listing-optimization-message"

type I = Parameters<typeof topFixes>[0][number]
const item = (p: Partial<I>): I => ({
  section: "title",
  kind: "change",
  priority: "medium",
  sort_order: 0,
  headline: "Fix it",
  ...p,
})

describe("owner message", () => {
  const items = [
    item({ section: "captions", priority: "high", headline: "Caption photo 3" }),
    item({ section: "captions", priority: "high", headline: "Caption photo 4" }),
    item({ section: "title", priority: "high", headline: "Lead the title with the beach." }),
    item({ section: "amenities", priority: "medium", headline: "Check “Dryer” in your Airbnb amenities" }),
    item({ section: "rules_settings", kind: "owner_choice", priority: "high", headline: "Decide on kids and infants" }),
    item({ section: "host_profile", kind: "owner_task", priority: "high", headline: "Use a photo of yourself" }),
    item({ section: "location", kind: "owner_task", priority: "low", headline: "Verify your location" }),
  ]

  it("picks high-priority fixes in section order and collapses captions", () => {
    expect(topFixes(items)).toEqual([
      "Lead the title with the beach",
      "Add short captions to your photos",
      "Decide on kids and infants",
    ])
  })

  it("never lists owner tasks as fixes but mentions them", () => {
    const msg = buildOwnerMessage({ ownerName: "Jacob Raabe", items, channelManager: "Guesty" })
    expect(msg.startsWith("Hi Jacob! Your listing review is ready")).toBe(true)
    expect(msg).toContain("we'll make the changes in Guesty for you")
    expect(msg).toContain("Two are things only you can do in Airbnb")
    expect(msg).not.toContain("Use a photo of yourself")
    expect(msg).not.toMatch(/[—–]/)
  })

  it("falls back to Airbnb and a neutral greeting", () => {
    const msg = buildOwnerMessage({ ownerName: null, items: [], channelManager: null })
    expect(msg.startsWith("Hi there!")).toBe(true)
    expect(msg).toContain("in Airbnb for you")
  })
})
