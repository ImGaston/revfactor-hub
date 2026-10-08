import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260902203400_market_registry_initial_proposals.sql"
  ),
  "utf8"
)

const expectedProposalSlugs = [
  "smokies-tn",
  "knoxville-tn",
  "nashville-tn",
  "myrtle-beach-sc",
  "poconos-pa",
  "lake-geneva-wi",
  "north-lake-tahoe-ca",
  "dallas-fort-worth-tx",
  "deep-creek-lake-md",
  "black-hills-sd",
  "cincinnati-oh",
  "glacier-whitefish-mt",
  "asheville-area-nc",
  "lake-lure-nc",
  "olympic-peninsula-wa",
  "mount-rainier-north-wa",
  "mount-rainier-south-wa",
  "park-city-ut",
  "salt-lake-city-ut",
  "atlantic-city-coast-nj",
  "newark-nyc-influence-nj",
  "orange-county-coast-ca",
  "anaheim-santa-ana-ca",
  "denver-metro-co",
  "boulder-co",
  "tucson-az",
  "san-diego-ca",
  "glenwood-springs-co",
  "milwaukee-wi",
  "austin-tx",
  "omaha-ne",
  "lodi-ca",
  "gainesville-fl",
  "sedona-az",
  "page-az",
  "galveston-tx",
  "charlotte-nc",
  "livingston-mt",
] as const

describe("initial market-registry proposal migration", () => {
  it("seeds every high-confidence census entry as a governed proposal", () => {
    expect(expectedProposalSlugs).toHaveLength(38)
    for (const slug of expectedProposalSlugs) {
      expect(migration).toContain(`'${slug}'`)
    }

    expect(migration).toContain("INSERT INTO public.revenue_market_proposals")
    expect(migration).toContain("'research'")
    expect(migration).toContain("'needs_review'")
  })

  it("stores canonical locality, jurisdiction, count, and confidence evidence", () => {
    for (const field of [
      "'name', locality.name",
      "'slug', locality.slug",
      "'country_code', 'US'",
      "'subdivision_code', seed.state_code",
      "'source_row_count', seed.source_row_count",
      "'count_unit', 'pricelabs_syncing_visible_rows'",
      "'confidence_label', 'high'",
      "'confidence_score', seed.confidence_score",
      "'review_required', TRUE",
      "'exception_codes', TO_JSONB(seed.exception_codes)",
    ]) {
      expect(migration).toContain(field)
    }

    expect(migration).toContain(
      "'source', 'docs/market-signals/market-registry-census.md'"
    )
    expect(migration).toContain("'sevierville_state_conflict'")
    expect(migration).toContain("'hub_market_coverage_mismatch'")
    expect(migration).toContain("'proximity_chain_conflict_with_smokies'")
    expect(migration).toContain("'cross_state_demand_influence_review'")
  })

  it("is idempotent without overwriting a reviewed open proposal", () => {
    expect(migration).toContain("ON CONFLICT (state_id, proposed_slug)")
    expect(migration).toContain(
      "WHERE status IN ('draft', 'needs_review', 'approved')"
    )
    expect(migration).toContain("DO NOTHING")
    expect(migration).not.toMatch(/DO UPDATE/i)
  })

  it("cannot create markets, localities, memberships, events, or external work", () => {
    expect(migration).not.toMatch(
      /INSERT INTO public\.(revenue_markets|revenue_market_localities|revenue_market_listings|revenue_market_state_memberships|market_events|market_event_impacts|market_signal_jobs)/i
    )
    expect(migration).not.toMatch(
      /UPDATE public\.(revenue_markets|revenue_market_listings|listings)/i
    )
    expect(migration).not.toMatch(
      /net\.http|http_post|pg_net|PRICELABS_API_KEY|SUPABASE_SERVICE_ROLE_KEY|TICKETMASTER_API_KEY|CFBD_API_KEY/i
    )
  })

  it("does not invent proposal geometry or resolve a market", () => {
    expect(migration).not.toContain("proposed_center_lat")
    expect(migration).not.toContain("proposed_center_lon")
    expect(migration).not.toContain("proposed_radius_miles")
    expect(migration).not.toContain("resolved_market_id")
  })
})
