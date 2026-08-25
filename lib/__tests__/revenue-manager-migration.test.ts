import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { RESOURCES } from "@/lib/permissions"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/075_revenue_manager_persistence.sql"
  ),
  "utf8"
)

const revenueTables = [
  "revenue_property_profiles",
  "revenue_strategy_versions",
  "revenue_review_runs",
  "revenue_recommendations",
  "revenue_recommendation_evidence",
  "revenue_decisions",
  "revenue_executions",
  "revenue_outcome_reviews",
  "revenue_data_issues",
]

const integrityFunctions = [
  "enforce_revenue_profile_governance",
  "enforce_revenue_strategy_governance",
  "enforce_revenue_review_governance",
  "enforce_revenue_recommendation_governance",
  "enforce_revenue_evidence_insert",
  "enforce_revenue_decision_insert",
  "apply_revenue_decision",
  "prevent_revenue_append_only_mutation",
  "enforce_revenue_execution_governance",
  "enforce_revenue_outcome_governance",
  "enforce_revenue_data_issue_governance",
  "enforce_revenue_adjustment_control",
]

describe("Revenue Manager persistence migration", () => {
  it("creates every specified durable table and enables RLS", () => {
    for (const table of revenueTables) {
      expect(migration).toContain(`CREATE TABLE public.${table}`)
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
      )
    }
  })

  it("registers the resource and seeds fail-closed pilot permissions", () => {
    expect(RESOURCES.some((resource) => resource.key === "revenue")).toBe(true)
    expect(migration).toContain("('admin', 'revenue', 'view', TRUE)")
    expect(migration).toContain("('admin', 'revenue', 'create', TRUE)")
    expect(migration).toContain("('admin', 'revenue', 'edit', TRUE)")
    expect(migration).toContain("('admin', 'revenue', 'publish', FALSE)")
    expect(migration).toContain("('admin', 'revenue', 'control', FALSE)")
    expect(migration).toContain("WHERE r.name <> 'super_admin'")
  })

  it("uses permission-based RLS and never creates an open policy", () => {
    expect(migration).toContain(
      "public.has_permission(''revenue'', ''view'') AND public.has_permission(''listings'', ''view'')"
    )
    expect(migration).toContain("public.has_permission('revenue', 'create')")
    expect(migration).toContain("public.has_permission('revenue', 'edit')")
    expect(migration).toContain("public.has_permission('revenue', 'publish')")
    expect(migration).toContain("public.has_permission('revenue', 'control')")
    expect(migration).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(migration).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i)
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]{0,120}FOR DELETE/i)
  })

  it("runs cross-table integrity checks independently of row visibility", () => {
    for (const functionName of integrityFunctions) {
      const start = migration.indexOf(
        `CREATE OR REPLACE FUNCTION public.${functionName}()`
      )
      expect(start).toBeGreaterThan(-1)
      const block = migration.slice(start, migration.indexOf("$$;", start) + 3)
      expect(block).toContain("SECURITY DEFINER")
      expect(block).toContain("SET search_path = public")
      expect(migration).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${functionName}()`
      )
    }
  })

  it("keeps decisions and frozen evidence append-only", () => {
    expect(migration).toContain("trg_revenue_evidence_append_only")
    expect(migration).toContain("trg_revenue_decisions_append_only")
    expect(migration).toContain("prevent_revenue_append_only_mutation")
    expect(migration).toContain(
      "Submitted revenue recommendation content is immutable"
    )
    expect(migration).toContain(
      "Completed revenue review evidence is immutable"
    )
  })

  it("enforces governed recommendation, execution, and verification transitions", () => {
    expect(migration).toContain("trg_revenue_decision_apply")
    expect(migration).toContain(
      "Only an approved recommendation may create an execution"
    )
    expect(migration).toContain(
      "Revenue execution Adjustment must match the recommendation listing"
    )
    expect(migration).toContain("CHECK (execution_mode = 'manual')")
    expect(migration).toContain("trg_revenue_adjustment_control")
    expect(migration).toContain(
      "Revenue-linked adjustments require verified observed state before control"
    )
  })

  it("contains no external write path or client data seed", () => {
    expect(migration).not.toMatch(/https?:\/\//i)
    expect(migration).not.toMatch(/PRICELABS_API_KEY|ASSEMBLY_API_KEY/i)
    expect(migration).not.toMatch(
      /INSERT INTO public\.revenue_(property_profiles|strategy_versions|review_runs|recommendations|executions)/
    )
  })
})
