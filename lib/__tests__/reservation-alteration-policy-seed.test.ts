import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/063_reservation_alteration_policy.sql"
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

describe("reservation alteration policy seed", () => {
  it("captures the approved host-side operating rule and manual PDF resource", () => {
    expect(migration).toContain(
      "Reservation Alterations: Preventing Airbnb Repricing Errors"
    )
    expect(migration).toContain(
      "the alteration always be initiated from the host side"
    )
    expect(migration).toContain("Ask the guest to withdraw the request")
    expect(migration).toContain("Manage reservation")
    expect(migration).toContain("Change reservation")
    expect(migration).toContain("Price difference")
    expect(migration).toContain("Service fee adjustment")
    expect(migration).toContain("New payout")
    expect(migration).toContain("full revised accommodation cost")
    expect(migration).toContain("accommodation cost")
    expect(migration).toContain(
      "/resources/airbnb-host-side-reservation-alteration-guide.pdf"
    )
  })

  it("keeps the policy review-only until a human approves it in Knowledge", () => {
    expect(migration).toContain("review_status = 'needs_review'")
    expect(migration).toContain("agent_enabled = FALSE")
    expect(migration).toContain("knowledge_articles.review_status <> 'approved'")
    expect(migration).toContain("Assembly sending remains read-only")
  })

  it("adds three focused regression cases with concrete lexical checks", () => {
    const evaluations = dollarQuotedJson("evaluations") as Array<{
      name: string
      messages: Array<{ role: string; content: string }>
      expected_disposition: string
      expected_must_include: string[]
      expected_must_not_include: string[]
      rubric: string
    }>

    expect(evaluations).toHaveLength(3)
    expect(new Set(evaluations.map((item) => item.name)).size).toBe(3)
    expect(evaluations.map((item) => item.expected_disposition)).toEqual([
      "answer",
      "escalate",
      "answer",
    ])

    for (const evaluation of evaluations) {
      expect(evaluation.messages).toHaveLength(1)
      expect(evaluation.messages[0]?.role).toBe("user")
      expect(evaluation.expected_must_include.length).toBeGreaterThan(1)
      expect(evaluation.rubric.length).toBeGreaterThan(80)
      expect(
        evaluation.expected_must_not_include.every(
          (term) => !term.toLowerCase().startsWith("do not ")
        )
      ).toBe(true)
    }
  })

  it("contains no raw customer identifiers", () => {
    expect(migration).not.toMatch(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
    )
    expect(migration).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
    )
  })
})
