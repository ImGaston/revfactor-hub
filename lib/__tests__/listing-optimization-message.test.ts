import { describe, expect, it } from "vitest"

import { buildOwnerBundleMessage, buildOwnerMessage, topFixes } from "@/lib/listing-optimization-message"

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

describe("owner bundle message", () => {
  const bourbon = [
    item({ section: "photos", priority: "high", headline: "Assign every photo to a room" }),
    item({ section: "title", priority: "high", headline: "Rewrite the title." }),
    item({ section: "captions", priority: "medium", headline: "Caption for photo 1" }),
    item({ section: "location", kind: "owner_task", priority: "medium", headline: "Verify your listing location" }),
    { ...item({ section: "host_profile", kind: "owner_task", priority: "low", headline: "Add a short host bio" }), check_id: "profile.about" },
  ]
  const farm = [
    item({ section: "photos", priority: "high", headline: "Remove the off-property photos" }),
    item({ section: "location", kind: "owner_task", priority: "medium", headline: "Verify your listing location" }),
    { ...item({ section: "host_profile", kind: "owner_task", priority: "low", headline: "Add a short host bio" }), check_id: "profile.about" },
  ]

  it("lists each listing's top fixes under its name and counts the shared profile task once", () => {
    const msg = buildOwnerBundleMessage({
      ownerName: "Spencer Ritterskamp",
      reviews: [
        { listingName: "Bourbon Barrel Retreat", items: bourbon, channelManager: "Hospitable" },
        { listingName: "Horse farm", items: farm, channelManager: "Hospitable" },
      ],
    })
    expect(msg.startsWith("Hi Spencer! Your listing reviews for Bourbon Barrel Retreat and Horse farm are ready")).toBe(true)
    expect(msg).toContain("Bourbon Barrel Retreat\n1. Rewrite the title\n2. Assign every photo to a room\n3. Add short captions to your photos")
    expect(msg).toContain("Horse farm\n1. Remove the off-property photos")
    expect(msg).toContain("in Hospitable, or in Airbnb for anything Hospitable doesn't sync")
    expect(msg).toContain("Three are things only you can do in Airbnb")
    expect(msg).not.toMatch(/[—–]/)
  })

  it("uses neutral wording for mixed channel managers and joins three names", () => {
    const msg = buildOwnerBundleMessage({
      ownerName: null,
      reviews: [
        { listingName: "A", items: bourbon, channelManager: "Guesty" },
        { listingName: "B", items: farm, channelManager: null },
        { listingName: "C", items: [], channelManager: null },
      ],
    })
    expect(msg).toContain("reviews for A, B and C are ready")
    expect(msg).toContain("and we'll make the changes for you.")
    expect(msg).toContain("A\n1. Rewrite the title\n2. Assign every photo to a room\n\nB")
  })

  it("falls back to the single-review message for one review", () => {
    const msg = buildOwnerBundleMessage({
      ownerName: "Spencer",
      reviews: [{ listingName: "Horse farm", items: farm, channelManager: "Hospitable" }],
    })
    expect(msg).toBe(buildOwnerMessage({ ownerName: "Spencer", items: farm, channelManager: "Hospitable" }))
  })
})
