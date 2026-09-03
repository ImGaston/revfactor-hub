import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260902203500_university_official_page_adapter_configs.sql"
  ),
  "utf8"
)
const ingestion = readFileSync(
  join(process.cwd(), "lib/market-signals/ingest.server.ts"),
  "utf8"
)
const environmentExample = readFileSync(
  join(process.cwd(), ".env.local.example"),
  "utf8"
)

const sourceNames = [
  "UConn Family Weekend",
  "UConn Commencement",
  "UConn Academic Calendar",
  "UT Knoxville Vol Family Reunions",
  "UT Knoxville Commencement",
  "UT Knoxville Academic Calendar",
  "GW Alumni & Families Weekend",
  "GW Commencement",
  "GW Academic Calendar",
] as const

describe("official university page adapter config migration", () => {
  it("configures the nine researched registry rows without registering URLs", () => {
    for (const sourceName of sourceNames) {
      expect(migration).toContain(`'${sourceName}'`)
    }
    expect(migration).toContain("UPDATE public.revenue_market_sources source")
    expect(migration).toContain(
      "Expected 9 inactive university source configurations"
    )
    expect(migration).toContain("source.source_type = 'official_feed'")
    expect(migration).toContain("source.institution_id IS NOT NULL")
    expect(migration).not.toMatch(/https?:\/\//i)
    expect(migration).not.toMatch(/INSERT INTO/i)
  })

  it("keeps every source behind both registry and runtime activation gates", () => {
    expect(migration).toContain("'collection_status', 'registry_only'")
    expect(migration).toContain("is_active = FALSE")
    expect(migration).toContain("UNIVERSITY_PAGE_INGESTION_ENABLED")
    expect(migration).not.toContain("'collection_status', 'enabled'")
    expect(migration).not.toMatch(/is_active\s*=\s*TRUE/i)
    expect(environmentExample).toContain(
      "UNIVERSITY_PAGE_INGESTION_ENABLED=false"
    )
    expect(ingestion).toContain('source.source_type === "official_feed"')
    expect(ingestion).toContain("UNIVERSITY_PAGE_INGESTION_ENABLED")
    expect(ingestion).toContain(
      "Official university rows are never auto-enabled"
    )
    expect(ingestion).toContain("relationship is queried only when the new")
  })

  it("stores explicit source-specific rules and bounded first-party REST paths", () => {
    expect(migration).toContain("'match_rules'")
    expect(migration).toContain("'event_type', config.event_type")
    expect(migration).toContain("'include_terms', config.include_terms")
    expect(migration).toContain("'exclude_terms', config.exclude_terms")
    expect(migration).toContain("'/family/wp-json/wp/v2/pages'")
    expect(migration).toContain("'/wp-json/academic-calendar/v1/dates'")
    expect(migration).toContain(
      '\'[{"name":"keyword","value":"Commencement"}]\'::JSONB'
    )
  })

  it("contains no external call, secret, event seed, or commercial action", () => {
    expect(migration).not.toMatch(
      /net\.http|http_post|pg_net|API_KEY|ACCESS_TOKEN|SERVICE_ROLE_KEY/i
    )
    expect(migration).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)[\s\S]*public\.(?:market_events|market_event_impacts|revenue_market_listings|adjustments|listings)/i
    )
    expect(migration).not.toMatch(
      /min_stay|check-?in|check-?out|price_override|pricelabs/i
    )
  })
})
