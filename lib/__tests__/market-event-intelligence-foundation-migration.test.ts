import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260902203300_market_event_intelligence_foundation.sql"
  ),
  "utf8"
)

const newTables = [
  "revenue_market_states",
  "revenue_market_state_memberships",
  "revenue_market_localities",
  "revenue_market_proposals",
  "revenue_market_proposal_listings",
  "market_signal_source_catalog",
  "market_event_series",
  "market_event_series_watches",
  "market_event_conditions",
]

describe("Market & Event Intelligence foundation migration", () => {
  it("creates the State -> Market -> Locality hierarchy", () => {
    expect(migration).toContain("CREATE TABLE public.revenue_market_states")
    expect(migration).toContain("ADD COLUMN state_id UUID")
    expect(migration).toContain("CREATE TABLE public.revenue_market_localities")
    expect(migration).toContain(
      "CREATE TABLE public.revenue_market_state_memberships"
    )
    expect(migration).toContain("FOREIGN KEY (market_id, state_id)")
    expect(migration).toContain(
      "REFERENCES public.revenue_market_state_memberships(market_id, state_id)"
    )
    expect(migration).toContain(
      "REFERENCES public.revenue_markets(id) ON DELETE CASCADE"
    )
    expect(migration).toContain("revenue_markets_active_state_check")
    expect(migration).toContain("('US', 'TN', 'Tennessee', 'state')")
    expect(migration).toContain(
      "('US', 'DC', 'District of Columbia', 'district')"
    )
    for (const locality of [
      "'sevierville', 'Sevierville'",
      "'pigeon-forge', 'Pigeon Forge'",
      "'gatlinburg', 'Gatlinburg'",
      "'pittman-center', 'Pittman Center'",
      "'knoxville', 'Knoxville'",
    ]) {
      expect(migration).toContain(locality)
    }
    expect(migration).toContain("('smokies-tn', 'sevierville'")
    expect(migration).toContain("('knoxville-tn', 'knoxville'")
    expect(migration).not.toContain("ARRAY['Sevier County']")
    expect(migration).toContain("ARRAY['Sevierville, TN']")
  })

  it("supports cross-jurisdiction markets with one anchored primary state", () => {
    expect(migration).toContain(
      "CREATE UNIQUE INDEX uq_revenue_market_state_memberships_primary"
    )
    expect(migration).toContain("WHERE relationship_type = 'primary'")
    expect(migration).toContain(
      "FUNCTION public.sync_revenue_market_primary_state"
    )
    expect(migration).toContain(
      "FUNCTION public.validate_revenue_market_state_memberships"
    )
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED")
    expect(migration).toContain(
      "must have exactly one primary state matching its anchor"
    )
    expect(migration).toContain("Cannot replace a locked primary market state")
  })

  it("allows one approved primary market and secondary influences", () => {
    expect(migration).toContain("ADD COLUMN relationship_type TEXT")
    expect(migration).toContain("IN ('primary', 'secondary')")
    expect(migration).toContain(
      "CREATE UNIQUE INDEX uq_revenue_market_listings_approved_primary"
    )
    expect(migration).toContain(
      "membership_status = 'approved' AND relationship_type = 'primary'"
    )
    expect(migration).toContain(
      "CREATE VIEW public.market_listing_assignment_audit"
    )
  })

  it("optionally maps a listing membership to a locality in the same market", () => {
    expect(migration).toContain("ADD COLUMN locality_id UUID")
    expect(migration).toContain("UNIQUE (market_id, id)")
    expect(migration).toContain(
      "CONSTRAINT revenue_market_listings_locality_same_market_fkey"
    )
    expect(migration).toContain("FOREIGN KEY (market_id, locality_id)")
    expect(migration).toContain(
      "REFERENCES public.revenue_market_localities(market_id, id)"
    )
    expect(migration).toContain("WHERE locality_id IS NOT NULL")
    expect(migration).not.toMatch(
      /UPDATE public\.revenue_market_listings[\s\S]{0,200}locality_id/i
    )
  })

  it("preserves and exposes manual membership protections", () => {
    expect(migration).toContain("ADD COLUMN is_assignment_locked BOOLEAN")
    expect(migration).toContain("assignment_source = 'manual'")
    expect(migration).toContain("membership_status = 'excluded'")
    expect(migration).toContain("OR override_reason IS NOT NULL")
    expect(migration).toContain(
      "No status,\n-- exclusion, source, or override reason is changed."
    )
    expect(migration).not.toMatch(
      /SET\s+(membership_status|assignment_source|override_reason)\s*=/i
    )
  })

  it("stores new-market ideas as governed drafts", () => {
    expect(migration).toContain("CREATE TABLE public.revenue_market_proposals")
    expect(migration).toContain(
      "proposal_source IN ('human', 'onboarding', 'coordinate_cluster', 'grok', 'research')"
    )
    expect(migration).toContain(
      "status IN ('draft', 'needs_review', 'approved', 'rejected', 'merged')"
    )
    expect(migration).toContain("reviewed_by IS NOT NULL")
    expect(migration).toContain("resolved_market_id IS NOT NULL")
  })

  it("keeps proposal-to-listing candidates normalized and review-only", () => {
    expect(migration).toContain(
      "CREATE TABLE public.revenue_market_proposal_listings"
    )
    expect(migration).toContain("PRIMARY KEY (proposal_id, listing_id)")
    expect(migration).toContain(
      "REFERENCES public.revenue_market_proposals(id) ON DELETE RESTRICT"
    )
    expect(migration).toContain(
      "REFERENCES public.listings(id) ON DELETE RESTRICT"
    )
    expect(migration).toContain(
      "candidate_source IN (\n      'human', 'onboarding', 'coordinate_cluster', 'grok', 'research'"
    )
    expect(migration).toContain(
      "review_status IN ('needs_review', 'accepted', 'rejected', 'withdrawn')"
    )
    expect(migration).toContain(
      "reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL"
    )
    expect(migration).toContain(
      "ON public.revenue_market_proposal_listings FOR SELECT TO authenticated"
    )
    expect(migration).toContain(
      "ON public.revenue_market_proposal_listings FOR INSERT TO authenticated"
    )
    expect(migration).toContain(
      "ON public.revenue_market_proposal_listings FOR UPDATE TO authenticated"
    )
    expect(migration).not.toMatch(
      /INSERT INTO public\.revenue_market_proposal_listings/i
    )
  })

  it("separates provider metadata from per-market source configuration", () => {
    expect(migration).toContain(
      "CREATE TABLE public.market_signal_source_catalog"
    )
    expect(migration).toContain("ADD COLUMN provider_id UUID")
    expect(migration).toContain(
      "REFERENCES public.market_signal_source_catalog(id) ON DELETE RESTRICT"
    )
    expect(migration).toContain("ALTER COLUMN provider_id SET NOT NULL")
    expect(migration).toContain("corroboration_policy")
    expect(migration).toContain("licensing_notes")
    expect(migration).toContain("coverage_notes")
    expect(migration).toContain("'predicthq', 'PredictHQ reference archive'")
    expect(migration).toContain("'reference_only'")
    expect(migration).toContain("'seatgeek', 'SeatGeek'")
  })

  it("models recurring series and creates exactly three unknown-date watches", () => {
    expect(migration).toContain("CREATE TABLE public.market_event_series")
    expect(migration).toContain(
      "CREATE TABLE public.market_event_series_watches"
    )
    expect(migration).toContain("UNIQUE (series_id, target_year)")
    expect(migration).toContain(
      "FUNCTION public.ensure_market_event_series_date_watches"
    )
    expect(migration).toContain("COALESCE(auth.uid(), NEW.created_by)")
    expect(migration).toContain("first_watch_year + 2")
    expect(migration).toContain(
      "ON CONFLICT (series_id, target_year) DO NOTHING"
    )
    expect(migration).toContain("date_status = 'unknown'")
    expect(migration).toContain(
      "FUNCTION public.replenish_market_event_series_date_watches"
    )
    expect(migration).toContain("TO service_role")
    expect(migration).toContain("ADD COLUMN occurrence_key TEXT")
    expect(migration).toContain("(series_id, occurrence_year, occurrence_key)")
  })

  it("tracks conditional playoff qualification without acting on pricing", () => {
    expect(migration).toContain("CREATE TABLE public.market_event_conditions")
    expect(migration).toContain("'playoff_qualification'")
    expect(migration).toContain(
      "'pending', 'qualified', 'eliminated', 'confirmed', 'expired'"
    )
    expect(migration).toContain("qualification_probability")
    expect(migration).toContain("probability_provenance")
    expect(migration).toContain("next_check_at")
    expect(migration).toContain("resolved_at")
  })

  it("enriches events and market impacts without inventing attendance", () => {
    for (const field of [
      "audience_segments",
      "attendance_lower_bound",
      "attendance_upper_bound",
      "attendance_confidence",
      "attendance_provenance",
    ]) {
      expect(
        migration.match(new RegExp(`ADD COLUMN ${field}`, "g"))
      ).toHaveLength(2)
    }

    for (const field of [
      "date_certainty",
      "announced_at",
      "last_verified_at",
      "next_verification_at",
      "booking_window_open_days_prior",
      "booking_window_peak_start_days_prior",
      "booking_window_peak_end_days_prior",
      "booking_window_confidence",
    ]) {
      expect(migration).toContain(`ADD COLUMN ${field}`)
    }

    expect(migration).toContain("event_type = category")
    expect(migration).toContain("last_verified_at = last_seen_at")
    expect(migration).toContain(
      "FUNCTION public.sync_market_event_type_from_category"
    )
    expect(migration).toContain("trg_market_events_sync_event_type")
    expect(migration).not.toMatch(
      /SET\s+(predicted_attendance|attendance_lower_bound|attendance_upper_bound)\s*=/i
    )
  })

  it("enables permission-based RLS on every new table", () => {
    for (const table of newTables) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
      )
    }

    expect(migration).toContain(
      "public.has_permission('market_signals', 'view')"
    )
    expect(migration).toContain(
      "public.has_permission('market_signals', 'create')"
    )
    expect(migration).toContain(
      "public.has_permission('market_signals', 'edit')"
    )
    expect(migration).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(migration).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i)
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]{0,140}FOR DELETE/i)
  })

  it("contains no provider call, secret, or commercial execution path", () => {
    expect(migration).not.toMatch(
      /PREDICTHQ_ACCESS_TOKEN|TICKETMASTER_API_KEY|CFBD_API_KEY|PRICELABS_API_KEY|SUPABASE_SERVICE_ROLE_KEY/i
    )
    expect(migration).not.toMatch(/net\.http|http_post|pg_net/i)
    expect(migration).not.toMatch(
      /UPDATE\s+public\.(adjustments|listings)|INSERT\s+INTO\s+public\.adjustments/i
    )
    expect(migration).not.toMatch(/min_stay|checkin|checkout|price_override/i)
  })
})
