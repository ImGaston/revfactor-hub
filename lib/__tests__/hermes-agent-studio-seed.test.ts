import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  compileAgentFlow,
  normalizeAgentFlowGraph,
  validateAgentFlowGraph,
} from "@/lib/agent-flows"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/062_hermes_client_service_drafts.sql"
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

describe("Hermes Agent Studio seed migration", () => {
  it("contains a valid governed master flow with four explicit intent routes", () => {
    const graph = normalizeAgentFlowGraph(dollarQuotedJson("hermes_graph"))
    const validation = validateAgentFlowGraph(graph)

    expect(validation).toEqual({ valid: true, issues: [] })
    expect(graph.nodes).toHaveLength(24)
    expect(graph.edges).toHaveLength(32)

    const routeEdges = graph.edges.filter(
      (edge) => edge.source === "route-intent"
    )
    expect(routeEdges.map((edge) => edge.label)).toEqual([
      "Pricing, stay rule, calendar, or event change",
      "Performance, plan, listing quality, or comps",
      "PMS, PriceLabs, sync, or access status",
      "Reservation, refund, billing, cancellation, or sensitive issue",
    ])

    const compiled = compileAgentFlow(
      "RevFactor Client Service — Intent Routing",
      1,
      graph
    )
    expect(compiled).toContain("Triage operational change")
    expect(compiled).toContain("Frame negative performance")
    expect(compiled).toContain("Assess integration health")
    expect(compiled).toContain("Separate policy from live decision")
    expect(compiled).toContain("Never send")
  })

  it("seeds ten synthetic cases with concrete snapshots and lexical checks", () => {
    const evaluations = dollarQuotedJson("hermes_evaluations") as Array<{
      name: string
      snapshot: string
      messages: Array<{ role: string; content: string }>
      expected_disposition: string
      expected_must_include: string[]
      expected_must_not_include: string[]
      rubric: string
    }>

    expect(evaluations).toHaveLength(10)
    expect(new Set(evaluations.map((item) => item.name)).size).toBe(10)
    expect(new Set(evaluations.map((item) => item.snapshot))).toEqual(
      new Set(["good", "missing", "credential"])
    )

    for (const evaluation of evaluations) {
      expect(["answer", "clarify", "escalate"]).toContain(
        evaluation.expected_disposition
      )
      expect(evaluation.messages).toHaveLength(1)
      expect(evaluation.messages[0]?.role).toBe("user")
      expect(evaluation.rubric.length).toBeGreaterThan(40)
      expect(
        evaluation.expected_must_not_include.every(
          (term) => !term.toLowerCase().startsWith("do not ")
        )
      ).toBe(true)
    }
  })

  it("keeps Knowledge and flow artifacts review-only and avoids raw identifiers", () => {
    expect(migration).toContain("'revenue-management-metrics-glossary'")
    expect(migration).toContain("'needs_review'")
    expect(migration).toContain("agent_enabled")
    expect(migration).toContain("'draft'")
    expect(migration).not.toMatch(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
    )
    expect(migration).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
    )
  })
})
