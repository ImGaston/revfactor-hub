-- Listing outcomes: did a setup change work? (the Outcome step of the
-- listing revenue setup). Design: docs/ontology/listing-revenue-setup.md.
--
-- Objects:
--   listing_daily_snapshots   one row per listing per day with the PriceLabs
--                             numbers the hub otherwise overwrites daily
--                             (own vs market occupancy, MPI, min/base/max).
--                             Reservations already give booking history, so
--                             only the market side needs storing.
--   listing_outcome_reviews   one row per tracked change window × checkpoint
--                             (day 7/14/30/60/90): the computed metrics, the
--                             code-made verdict, and an AI-written summary.
--
-- Reads: snapshots need listings:view; reviews also need reservations:view
-- (they carry booking revenue). No write policies: the daily cron and staff
-- server actions write with the service role after their own checks.

CREATE TABLE IF NOT EXISTS listing_daily_snapshots (
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'pricelabs' CHECK (source IN ('pricelabs')),
  min_price NUMERIC(10,2),
  base_price NUMERIC(10,2),
  max_price NUMERIC(10,2),
  recommended_base_price NUMERIC(10,2),
  push_enabled BOOLEAN,
  occupancy_next_7 NUMERIC(5,2),
  market_occupancy_next_7 NUMERIC(5,2),
  occupancy_next_30 NUMERIC(5,2),
  market_occupancy_next_30 NUMERIC(5,2),
  occupancy_next_90 NUMERIC(5,2),
  market_occupancy_next_90 NUMERIC(5,2),
  wknd_occupancy_next_30 NUMERIC(5,2),
  market_wknd_occupancy_next_30 NUMERIC(5,2),
  mpi_next_30 NUMERIC(6,2),
  mpi_next_60 NUMERIC(6,2),
  last_booked_date DATE,
  pricelabs_refreshed_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_listing_daily_snapshots_date
  ON listing_daily_snapshots(snapshot_date DESC);

CREATE TABLE IF NOT EXISTS listing_outcome_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  -- The first change set of the tracked window (change sets a few days apart
  -- are tracked together). RESTRICT: the review explains that change.
  change_set_id UUID NOT NULL REFERENCES listing_setting_change_sets(id) ON DELETE RESTRICT,
  window_start DATE NOT NULL,
  checkpoint_day INTEGER NOT NULL CHECK (checkpoint_day IN (7, 14, 30, 60, 90)),
  as_of DATE NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('on_track', 'watch', 'off_track', 'too_early')),
  -- Computed by code (lib/listing-outcomes.ts); the AI never produces numbers.
  metrics JSONB NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  suggestion TEXT,
  summary_model TEXT,
  generated_by TEXT NOT NULL CHECK (generated_by IN ('cron', 'staff')),
  generated_by_user UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (change_set_id, checkpoint_day)
);

CREATE INDEX IF NOT EXISTS idx_listing_outcome_reviews_listing
  ON listing_outcome_reviews(listing_id, as_of DESC);

ALTER TABLE listing_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_outcome_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Listings users can view daily snapshots"
  ON listing_daily_snapshots FOR SELECT TO authenticated
  USING (public.has_permission('listings', 'view'));
CREATE POLICY "Reservations users can view outcome reviews"
  ON listing_outcome_reviews FOR SELECT TO authenticated
  USING (
    public.has_permission('listings', 'view')
    AND public.has_permission('reservations', 'view')
  );
-- No INSERT/UPDATE/DELETE policies: rows are written server-side only.

REVOKE ALL ON listing_daily_snapshots, listing_outcome_reviews FROM anon;
