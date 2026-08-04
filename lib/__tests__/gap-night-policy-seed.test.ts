import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/069_gap_night_minimum_stay_policy.sql"
  ),
  "utf8"
)

function dollarQuotedJson(tag: string): unknown {
  const expression = new RegExp(
    `\\$${tag}\\$\\s*([\\s\\S]*?)\\s*\\$${tag}\\$`
  )
  const match = migration.match(expression)
  if (!match?.[1]) throw new Error(`Missing $${tag}$ JSON block`)
  return JSON.parse(match[1])
}

describe("gap-night minimum-stay policy seed", () => {
  it("makes minimum stays owner-approved and listing-specific", () => {
    expect(migration).toContain("listing-specific and approved with the owner")
    expect(migration).toContain("does not apply one universal minimum stay")
    expect(migration).toContain("owner-approved default")
    expect(migration).toContain("owner-approved orphan-gap rule")
    expect(migration).toContain("Lowest Minimum Stay Allowed")
  })

  it("explains booking and cancellation refresh timing", () => {
    expect(migration).toContain("new booking or cancellation")
    expect(migration).toContain("next scheduled overnight sync")
    expect(migration).toContain("open but unbookable")
    expect(migration).toContain("Save and Refresh and Sync Now")
    expect(migration).toContain("PriceLabs recalculates and syncs")
  })

  it("keeps live synchronization and rule changes human-owned", () => {
    expect(migration).toContain("authorized human")
    expect(migration).toContain("must not be claimed from Agent Studio")
    expect(migration).toContain("status = 'draft'")
    expect(migration).toContain("review_status = 'needs_review'")
    expect(migration).toContain("agent_enabled = FALSE")
    expect(migration).toContain("knowledge_articles.review_status <> 'approved'")
  })

  it("adds four synthetic booking, cancellation, and sync cases", () => {
    const snapshot = dollarQuotedJson("gap_snapshot") as {
      client: { id: string; listings: Array<{ id: string }> }
    }
    const evaluations = dollarQuotedJson("gap_evaluations") as Array<{
      name: string
      expected_disposition: string
      rubric: string
    }>

    expect(snapshot.client.id).toMatch(/^synthetic-/)
    expect(snapshot.client.listings[0]?.id).toMatch(/^synthetic-/)
    expect(evaluations).toHaveLength(4)
    expect(new Set(evaluations.map((item) => item.name)).size).toBe(4)
    expect(evaluations.map((item) => item.expected_disposition)).toEqual([
      "answer",
      "answer",
      "clarify",
      "escalate",
    ])
    expect(evaluations.every((item) => item.rubric.length > 170)).toBe(true)
  })

  it("stores no raw customer identifiers", () => {
    expect(migration).not.toMatch(
      /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/i
    )
    expect(migration).not.toMatch(
      /\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b/i
    )
  })
})
