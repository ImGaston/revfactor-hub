import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/064_revenue_metrics_glossary_policy.sql"
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

describe("revenue metrics glossary policy seed", () => {
  it("defines the metrics and their comparison boundaries", () => {
    expect(migration).toContain("booked nights divided by available nights")
    expect(migration).toContain("rental revenue divided by booked nights")
    expect(migration).toContain("rental revenue divided by available nights")
    expect(migration).toContain("listing occupancy divided by market occupancy")
    expect(migration).toContain("check-in date minus booking date")
    expect(migration).toContain("Pickup and pace are related but not interchangeable")
    expect(migration).toContain("Same-time-last-year (STLY)")
    expect(migration).toContain("Final last year (LY)")
    expect(migration).toContain("percentage-point changes")
  })

  it("requires evidence labels and avoids unsupported diagnoses", () => {
    expect(migration).toContain(
      "property, date range, source, benchmark, and the date when the data was last refreshed"
    )
    expect(migration).toContain(
      "Do not infer a pricing, demand, ranking, restriction, or listing-quality cause"
    )
    expect(migration).toContain(
      "Do not present a calendar-month average as an exact rolling"
    )
    expect(migration).toContain("market occupancy is zero")
    expect(migration).toContain("Never guarantee occupancy")
  })

  it("keeps the glossary review-only until a human approves it", () => {
    expect(migration).toContain("status = 'draft'")
    expect(migration).toContain("review_status = 'needs_review'")
    expect(migration).toContain("agent_enabled = FALSE")
    expect(migration).toContain("knowledge_articles.review_status <> 'approved'")
  })

  it("adds four focused regression cases backed only by synthetic data", () => {
    const snapshot = dollarQuotedJson("snapshot") as {
      client: { id: string; listings: Array<{ id: string }> }
    }
    const evaluations = dollarQuotedJson("evaluations") as Array<{
      name: string
      messages: Array<{ role: string; content: string }>
      expected_disposition: string
      expected_must_include: string[]
      expected_must_not_include: string[]
      rubric: string
    }>

    expect(snapshot.client.id).toMatch(/^synthetic-/)
    expect(snapshot.client.listings[0]?.id).toMatch(/^synthetic-/)
    expect(evaluations).toHaveLength(4)
    expect(new Set(evaluations.map((item) => item.name)).size).toBe(4)
    expect(evaluations.map((item) => item.expected_disposition)).toEqual([
      "answer",
      "answer",
      "answer",
      "escalate",
    ])

    for (const evaluation of evaluations) {
      expect(evaluation.messages).toHaveLength(1)
      expect(evaluation.messages[0]?.role).toBe("user")
      expect(evaluation.expected_must_include.length).toBeGreaterThan(1)
      expect(evaluation.expected_must_not_include.length).toBeGreaterThan(1)
      expect(evaluation.rubric.length).toBeGreaterThan(120)
    }
  })

  it("contains no raw customer identifiers", () => {
    expect(migration).not.toMatch(
      /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/i
    )
    expect(migration).not.toMatch(
      /\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b/i
    )
  })
})
