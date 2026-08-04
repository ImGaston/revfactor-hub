import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/065_ota_markup_policy.sql"),
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

describe("OTA markup policy seed", () => {
  it("captures the PriceLabs to Hospitable to Airbnb policy example", () => {
    expect(migration).toContain("$100 nightly target rate")
    expect(migration).toContain("Hospitable receives the $100 rate")
    expect(migration).toContain("44% Airbnb channel markup")
    expect(migration).toContain("$115.20 discounted accommodation rate")
    expect(migration).toContain("not a promise that every reservation")
  })

  it("distinguishes discounts, platform charges, and performance claims", () => {
    expect(migration).toContain("host payout as separate values")
    expect(migration).toContain("Do not infer stacking")
    expect(migration).toContain("longer-stay discounts")
    expect(migration).toContain(
      "Do not tell a client that a discount guarantees a higher search position"
    )
    expect(migration).toContain("57% above the benchmark")
  })

  it("keeps the policy review-only until a human approves it", () => {
    expect(migration).toContain("status = 'draft'")
    expect(migration).toContain("review_status = 'needs_review'")
    expect(migration).toContain("agent_enabled = FALSE")
    expect(migration).toContain("knowledge_articles.review_status <> 'approved'")
  })

  it("adds five focused regression cases backed only by synthetic data", () => {
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
    expect(evaluations).toHaveLength(5)
    expect(new Set(evaluations.map((item) => item.name)).size).toBe(5)
    expect(evaluations.map((item) => item.expected_disposition)).toEqual([
      "answer",
      "answer",
      "clarify",
      "clarify",
      "answer",
    ])

    for (const evaluation of evaluations) {
      expect(evaluation.messages).toHaveLength(1)
      expect(evaluation.messages[0]?.role).toBe("user")
      expect(evaluation.expected_must_include.length).toBeGreaterThan(1)
      expect(evaluation.expected_must_not_include.length).toBeGreaterThan(1)
      expect(evaluation.rubric.length).toBeGreaterThan(150)
    }
  })

  it("stores no raw client message or identifying information", () => {
    expect(migration).not.toContain("Hi Tim")
    expect(migration).not.toMatch(
      /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/i
    )
    expect(migration).not.toMatch(
      /\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b/i
    )
  })
})
