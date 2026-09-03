import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const script = readFileSync(
  join(process.cwd(), "scripts/verify-market-intelligence-foundation.ts"),
  "utf8"
)
const runbook = readFileSync(
  join(process.cwd(), "docs/market-signals/foundation-deployment-runbook.md"),
  "utf8"
)
describe("Market & Event Intelligence production verifier", () => {
  it("uses the standard server-side Supabase client and only bounded reads", () => {
    expect(script).toContain(
      'import { createAdminClient } from "@/lib/supabase/admin"'
    )
    expect(script).toContain("const MAX_ROWS = 5_000")
    expect(script).toContain('.select("*", { count: "exact", head: true })')
    expect(script).toContain("result.count !== result.data.length")
    expect(script).toContain(".limit(MAX_ROWS + 1)")
    expect(script).not.toMatch(/\.(?:insert|upsert|update|delete|rpc)\s*\(/)
  })

  it("requires a preflight baseline and fails closed", () => {
    expect(script).toContain('args.includes("--baseline-only")')
    expect(script).toContain('args.indexOf("--baseline")')
    expect(script).toContain(
      "Post-deployment verification requires --baseline <aggregate-json>"
    )
    expect(script).toContain("if (!output.ok) process.exitCode = 1")
    expect(script).toContain("process.exitCode = 1")
  })

  it("covers the automatable release invariants", () => {
    for (const invariant of [
      "core_counts_not_decreased",
      "active_market_primary_jurisdiction",
      "approved_listing_primary_market",
      "listing_locality_matches_market",
      "smokies_locality_boundary",
      "university_registry_did_not_create_markets",
      "proposal_seed_is_review_only",
      "package_created_no_market_or_listing_assignment",
      "proposal_listing_decisions_are_reviewed",
      "pilot_institution_sources_are_dormant",
      "predicthq_is_reference_only",
      "source_catalog_coverage",
      "annual_series_three_year_watch_horizon",
    ]) {
      expect(script).toContain(`"${invariant}"`)
    }
  })

  it("does not select or print sensitive operational fields", () => {
    expect(script).not.toMatch(
      /\.select\([^)]*(?:airbnb|address|client_id|email|payload|credential|token|api_key)/i
    )
    expect(script).not.toMatch(
      /console\.(?:log|error)\s*\(\s*(?:process\.env|error)/
    )
    expect(script).toContain("JSON.stringify(output, null, 2)")
  })

  it("documents the two-step command through the repository-local binary", () => {
    expect(runbook).toContain(
      "./node_modules/.bin/tsx --env-file=.env.local scripts/verify-market-intelligence-foundation.ts --baseline-only"
    )
    expect(runbook).toContain(
      "./node_modules/.bin/tsx --env-file=.env.local scripts/verify-market-intelligence-foundation.ts --baseline /tmp/rf-intel-baseline.json"
    )
    expect(runbook).toContain("pnpm ignored-builds hook")
    expect(runbook).toContain("If `SUPABASE_SERVICE_ROLE_KEY` is absent")
    expect(runbook).toContain("performs bounded reads only")
  })
})
