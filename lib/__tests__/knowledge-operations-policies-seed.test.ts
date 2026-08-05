import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const pacing = readFileSync(
  join(process.cwd(), "supabase/migrations/066_pacing_questions_policy.sql"),
  "utf8"
)
const calendar = readFileSync(
  join(process.cwd(), "supabase/migrations/067_calendar_availability_policy.sql"),
  "utf8"
)
const updates = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/068_operational_update_request_policy.sql"
  ),
  "utf8"
)

function dollarQuotedJson(source: string, tag: string): unknown {
  const expression = new RegExp(
    `\\$${tag}\\$\\s*([\\s\\S]*?)\\s*\\$${tag}\\$`
  )
  const match = source.match(expression)
  if (!match?.[1]) throw new Error(`Missing $${tag}$ JSON block`)
  return JSON.parse(match[1])
}

describe("Knowledge operations policy seeds", () => {
  it("makes pacing evidence-aligned and diagnosis-safe", () => {
    expect(pacing).toContain("There is no universal occupancy percentage")
    expect(pacing).toContain("Diagnose in this order")
    expect(pacing).toContain("Market pace")
    expect(pacing).toContain("Year-over-year pace")
    expect(pacing).toContain("Negative-performance framing")
    expect(pacing).toContain("Do not diagnose price")
    expect(pacing).toContain("live pricing, restriction, availability")
  })

  it("distinguishes calendar blocks from booking restrictions", () => {
    expect(calendar).toContain("blocked versus unbookable")
    expect(calendar).toContain("Reservation or reservation sync")
    expect(calendar).toContain("Intentional manual block")
    expect(calendar).toContain("full Hospitable PMS connection")
    expect(calendar).toContain("restricted connection")
    expect(calendar).toContain("Search as a guest")
    expect(calendar).toContain("All live availability changes remain human-owned")
  })

  it("branches update requests by setting and preserves approval", () => {
    expect(updates).toContain("Required intake")
    expect(updates).toContain("Branch A: price, discount")
    expect(updates).toContain("Branch B: fee or channel markup")
    expect(updates).toContain("Branch C: minimum stay")
    expect(updates).toContain("fixed PriceLabs override")
    expect(updates).toContain("Lowest Minimum Stay Allowed")
    expect(updates).toContain("proposed—human approval required")
    expect(updates).toContain("All live changes remain human-owned")
  })

  it("keeps all three articles review-only and agent-disabled", () => {
    for (const migration of [pacing, calendar, updates]) {
      expect(migration).toContain("status = 'draft'")
      expect(migration).toContain("review_status = 'needs_review'")
      expect(migration).toContain("agent_enabled = FALSE")
      expect(migration).toContain(
        "knowledge_articles.review_status <> 'approved'"
      )
    }
  })

  it("adds thirteen unique synthetic regression cases", () => {
    const pacingCases = dollarQuotedJson(
      pacing,
      "pacing_evaluations"
    ) as Array<{ name: string; rubric: string }>
    const calendarCases = dollarQuotedJson(
      calendar,
      "calendar_evaluations"
    ) as Array<{ name: string; rubric: string }>
    const updateCases = dollarQuotedJson(
      updates,
      "update_evaluations"
    ) as Array<{ name: string; rubric: string }>

    expect(pacingCases).toHaveLength(4)
    expect(calendarCases).toHaveLength(4)
    expect(updateCases).toHaveLength(5)

    const all = [...pacingCases, ...calendarCases, ...updateCases]
    expect(new Set(all.map((item) => item.name)).size).toBe(13)
    expect(all.every((item) => item.rubric.length > 150)).toBe(true)
  })

  it("uses only synthetic source snapshots and no client identifiers", () => {
    const migrations = [pacing, calendar, updates]
    for (const migration of migrations) {
      expect(migration).toContain('"id": "synthetic-')
      expect(migration).not.toMatch(
        /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/i
      )
      expect(migration).not.toMatch(
        /\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b/i
      )
    }
  })
})
