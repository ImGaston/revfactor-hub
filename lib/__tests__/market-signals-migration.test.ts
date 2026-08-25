import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { RESOURCES } from "@/lib/permissions"

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/076_market_signals_foundation.sql"),
  "utf8"
)

const agentManagementMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/078_agent_managed_markets.sql"),
  "utf8"
)

const vulnerabilityMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/081_market_signal_listing_vulnerability.sql"
  ),
  "utf8"
)

const briefsMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/082_market_signal_briefs_and_actions.sql"
  ),
  "utf8"
)

const scaleMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/083_market_signal_scale_orchestration.sql"
  ),
  "utf8"
)

const cadenceMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/084_market_signal_due_cadence.sql"),
  "utf8"
)

const workerRoute = readFileSync(
  join(process.cwd(), "app/api/cron/market-signals/route.ts"),
  "utf8"
)

const stripeCronRoute = readFileSync(
  join(process.cwd(), "app/api/cron/sync-stripe/route.ts"),
  "utf8"
)

const vercelConfiguration = readFileSync(
  join(process.cwd(), "vercel.json"),
  "utf8"
)

const tables = [
  "revenue_markets",
  "revenue_market_listings",
  "revenue_market_sources",
  "market_events",
  "market_event_provider_records",
  "market_event_versions",
  "market_event_evidence",
  "market_event_impacts",
  "market_signal_reviews",
]

describe("Market Signals persistence migration", () => {
  it("creates the production foundation and enables RLS everywhere", () => {
    for (const table of tables) {
      expect(migration).toContain(`CREATE TABLE public.${table}`)
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
      )
    }
  })

  it("registers fail-closed Market Signals permissions", () => {
    expect(
      RESOURCES.some((resource) => resource.key === "market_signals")
    ).toBe(true)
    expect(migration).toContain("('admin', 'market_signals', 'view', TRUE)")
    expect(migration).toContain("('admin', 'market_signals', 'edit', TRUE)")
    expect(migration).toContain("('admin', 'market_signals', 'control', FALSE)")
    expect(migration).toContain("WHERE r.name <> 'super_admin'")
  })

  it("uses permission-based policies and never opens a table", () => {
    expect(migration).toContain(
      "public.has_permission('market_signals', 'view')"
    )
    expect(migration).toContain(
      "public.has_permission('market_signals', 'edit')"
    )
    expect(migration).toContain("public.has_permission('listings', 'view')")
    expect(migration).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(migration).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i)
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]{0,120}FOR DELETE/i)
  })

  it("keeps versions, evidence, and reviewer decisions append-only", () => {
    expect(migration).toContain("trg_market_event_versions_append_only")
    expect(migration).toContain("trg_market_event_evidence_append_only")
    expect(migration).toContain("trg_market_signal_reviews_append_only")
    expect(migration).toContain("prevent_market_signal_append_only_mutation")
  })

  it("seeds the initial pilot market and disabled-source definitions", () => {
    expect(migration).toContain("'washington-dc'")
    expect(migration).toContain("'tucson-az'")
    expect(migration).toContain("'myrtle-beach-sc'")
    expect(migration).toContain("'park-city-ut'")
    expect(migration).toContain("'smokies-tn'")
    expect(migration).not.toMatch(
      /INSERT INTO public\.(market_events|market_event_impacts|market_signal_reviews)/
    )
    expect(migration).toContain("'predicthq', 'PredictHQ Events'")
    expect(migration).toContain("2, 60, FALSE")
  })

  it("moves setup approval to agent management without enabling pricing writes", () => {
    expect(agentManagementMigration).toContain("management_mode")
    expect(agentManagementMigration).toContain("approval_mode")
    expect(agentManagementMigration).toContain("management_mode = 'agent'")
    expect(agentManagementMigration).toContain("approval_mode = 'agent'")
    expect(agentManagementMigration).toContain("membership_status = 'approved'")
    expect(agentManagementMigration).toContain("status = 'active'")
    expect(agentManagementMigration).not.toMatch(
      /PRICELABS_API_KEY|PREDICTHQ_ACCESS_TOKEN|http_post|pg_net/i
    )
  })

  it("contains no provider secret or external mutation path", () => {
    expect(migration).not.toMatch(
      /PREDICTHQ_TOKEN|TICKETMASTER_API_KEY|PRICELABS_API_KEY/i
    )
    expect(migration).not.toMatch(/https?:\/\//i)
    expect(migration).not.toMatch(/net\.http|http_post|pg_net/i)
  })

  it("persists permission-gated listing evidence without a pricing write path", () => {
    expect(vulnerabilityMigration).toContain(
      "CREATE TABLE public.market_event_listing_exposures"
    )
    expect(vulnerabilityMigration).toContain(
      "ALTER TABLE public.market_event_listing_exposures ENABLE ROW LEVEL SECURITY"
    )
    expect(vulnerabilityMigration).toContain(
      "public.has_permission('market_signals', 'view')"
    )
    expect(vulnerabilityMigration).toContain(
      "public.has_permission('listings', 'view')"
    )
    expect(vulnerabilityMigration).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(vulnerabilityMigration).not.toMatch(
      /PRICELABS_API_KEY|PREDICTHQ_ACCESS_TOKEN|net\.http|http_post|pg_net/i
    )
  })

  it("caches governed Signal Briefs and keeps model output away from execution", () => {
    expect(briefsMigration).toContain(
      "CREATE TABLE public.market_signal_briefs"
    )
    expect(briefsMigration).toContain(
      "ALTER TABLE public.market_signal_briefs ENABLE ROW LEVEL SECURITY"
    )
    expect(briefsMigration).toContain(
      "public.has_permission('market_signals', 'view')"
    )
    expect(briefsMigration).toContain("input_hash")
    expect(briefsMigration).toContain("prompt_version")
    expect(briefsMigration).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(briefsMigration).not.toMatch(
      /PRICELABS_API_KEY|PREDICTHQ_ACCESS_TOKEN|net\.http|http_post|pg_net/i
    )
  })

  it("creates or links Adjustments only through authenticated human RPCs", () => {
    expect(briefsMigration).toContain(
      "FUNCTION public.create_market_signal_adjustment"
    )
    expect(briefsMigration).toContain(
      "FUNCTION public.link_market_signal_adjustment"
    )
    expect(briefsMigration).toContain(
      "public.has_permission('adjustments', 'create')"
    )
    expect(briefsMigration).toContain("mei.action_gate = 'review_now'")
    expect(briefsMigration).toContain("mele.vulnerability_score >= 45")
    expect(briefsMigration).toContain("'recommendation'")
    expect(briefsMigration).toContain(
      "No commercial change is approved by this request."
    )
    expect(briefsMigration).not.toMatch(/UPDATE\s+public\.adjustments/i)
  })

  it("leases one durable job per market and restricts workers to service role", () => {
    expect(scaleMigration).toContain("CREATE TABLE public.market_signal_jobs")
    expect(scaleMigration).toContain("FOR UPDATE SKIP LOCKED")
    expect(scaleMigration).toContain("WHERE status IN ('queued', 'running')")
    expect(scaleMigration).toContain("lease_expires_at")
    expect(scaleMigration).toContain("max_attempts")
    expect(scaleMigration).toContain("TO service_role")
    expect(scaleMigration).toContain(
      "ALTER TABLE public.market_signal_jobs ENABLE ROW LEVEL SECURITY"
    )
    expect(scaleMigration).not.toMatch(/USING\s*\(\s*true\s*\)/i)
  })

  it("replaces only derived scoring state without an execution path", () => {
    expect(scaleMigration).toContain(
      "FUNCTION public.replace_market_signal_scoring"
    )
    expect(scaleMigration).toContain("JSONB_TO_RECORDSET(p_exposures)")
    expect(scaleMigration).toContain("JSONB_TO_RECORDSET(p_impacts)")
    expect(scaleMigration).not.toMatch(
      /UPDATE\s+public\.(adjustments|listings)|PRICELABS_API_KEY|PREDICTHQ_ACCESS_TOKEN|net\.http|http_post|pg_net/i
    )
  })

  it("enqueues scheduled markets only when their source cadence is due", () => {
    expect(cadenceMigration).toContain("cadence_minutes")
    expect(cadenceMigration).toContain("last_attempt_at")
    expect(cadenceMigration).toContain("make_interval")
    expect(cadenceMigration).toContain("p_reason <> 'scheduled'")
    expect(cadenceMigration).toContain("TO service_role")
    expect(cadenceMigration).not.toMatch(/USING\s*\(\s*true\s*\)/i)
  })

  it("keeps the protected worker callable and drains work through an existing cron", () => {
    expect(workerRoute).toContain("export const maxDuration = 300")
    expect(workerRoute).toContain("runtime.configuredSources")
    expect(workerRoute).toContain("processMarketSignalJobs")
    expect(workerRoute).toContain("MARKET_SIGNALS_JOBS_PER_RUN")
    expect(workerRoute).toContain("Bearer ${cronSecret}")
    expect(stripeCronRoute).toContain("processMarketSignalJobs")
    expect(stripeCronRoute).toContain("maximumJobs: 5")
    expect(vercelConfiguration).not.toContain('"/api/cron/market-signals"')
  })
})
