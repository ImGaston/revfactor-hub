import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/088_pricelabs_listing_id_guide.sql"
  ),
  "utf8"
)

const pdf = readFileSync(
  join(
    process.cwd(),
    "public/resources/revfactor-pricelabs-listing-id-guide.pdf"
  )
)

const proxy = readFileSync(join(process.cwd(), "proxy.ts"), "utf8")

describe("PriceLabs listing-ID Knowledge guide seed", () => {
  it("stores the complete client handoff workflow as native Knowledge text", () => {
    expect(migration).toContain("How to Find Your PriceLabs Listing ID")
    expect(migration).toContain("Dynamic Pricing")
    expect(migration).toContain("Manage Listings")
    expect(migration).toContain("Unmapped Listings")
    expect(migration).toContain("Mapped Listings")
    expect(migration).toContain("first line contains the channel and listing ID")
    expect(migration).toContain("second line contains the listing name")
    expect(migration).toContain("PMS-connected listings")
    expect(migration).toContain("Direct Airbnb and Vrbo listings")
    expect(migration).toContain("PARENT")
    expect(migration).toContain("CHILD")
  })

  it("packages the client PDF at the article's public resource path", () => {
    expect(migration).toContain(
      "/resources/revfactor-pricelabs-listing-id-guide.pdf"
    )
    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF")
    expect(pdf.byteLength).toBeGreaterThan(100_000)
    expect(proxy).toContain(
      'pathname === "/resources/revfactor-pricelabs-listing-id-guide.pdf"'
    )
    expect(proxy).toContain("!isPublicPriceLabsGuide")
  })

  it("keeps the client-safe article review-only until human approval", () => {
    expect(migration).toContain("'client_safe'")
    expect(migration).toContain("'needs_review'")
    expect(migration).toContain("agent_enabled = FALSE")
    expect(migration).toContain("knowledge_articles.review_status <> 'approved'")
    expect(migration).toContain("Never send PriceLabs usernames")
  })

  it("contains no example client or property identifiers", () => {
    expect(migration).not.toMatch(/ashwood/i)
    expect(migration).not.toMatch(/angela/i)
    expect(migration).not.toMatch(/lillehammer/i)
    expect(migration).not.toMatch(/cabin bear meister/i)
    expect(migration).not.toMatch(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
    )
    expect(migration).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
    )
  })
})
