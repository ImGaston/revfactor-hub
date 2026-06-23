-- PriceLabs Report Builder ingestion.
-- The Report Builder API returns the whole portfolio in a single call: a
-- listing × month grid (currently 234 listings × 12 months) with 20 listing
-- attributes + 35 monthly metrics (revenue, occupancy, ADR, RevPAR, RevPAR
-- Index, booking window) plus their market / STLY / LY / YoY variants, all
-- precalculated. This is distinct from the daily `pl_*` snapshot on `listings`
-- (current-state pricing/occupancy); here we store a full monthly series.
--
-- Three live tables (no jsonb for live data — typed columns for filters and
-- type-safety) + an observability/state-machine table that also keeps the raw
-- envelope of the last few runs for the future Snapshots module.
--
-- Listing ID is the hard key and is heterogeneous (huge Airbnb integers that
-- overflow bigint AND UUIDs / alphanumeric ids from other PMS) → always TEXT.

-- One row per ingestion attempt. Drives the async state machine
-- (pending → polling → ingesting → completed/failed) and observability.
CREATE TABLE report_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id          TEXT NOT NULL,
  request_id           TEXT,                         -- from POST /data; null if data came inline
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','polling','ingesting','completed','failed')),
  triggered_by         TEXT NOT NULL DEFAULT 'cron'
                         CHECK (triggered_by IN ('cron','manual')),
  triggered_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_expires_at   TIMESTAMPTZ,                  -- request_id obtained + 30 min (PriceLabs session window)
  last_polled_at       TIMESTAMPTZ,
  poll_attempts        INT NOT NULL DEFAULT 0,
  completed_at         TIMESTAMPTZ,
  listing_count        INT,
  metric_row_count     INT,
  unresolved_count     INT,                          -- listings that resolved to no hub client
  payload_bytes        BIGINT,
  report_currency      TEXT,
  error_reason         TEXT,
  raw_envelope         JSONB,                         -- crude envelope; pruned to last N runs
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_runs_status ON report_runs(status, started_at DESC);
CREATE INDEX idx_report_runs_polling ON report_runs(session_expires_at) WHERE status = 'polling';

-- Listing-level attributes (20 constant-per-listing fields). Current snapshot:
-- upserted by listing_id on every run.
CREATE TABLE report_listings (
  listing_id                TEXT PRIMARY KEY,         -- = report "Listing ID" (hard key)
  listing_name              TEXT,
  group_name                TEXT,                     -- readable label (last name for newer clients)
  sub_group_name            TEXT,
  property_name             TEXT,                     -- currently null from the API
  city                      TEXT,
  latitude                  DOUBLE PRECISION,
  longitude                 DOUBLE PRECISION,
  bedroom_count             INT,
  unit_count                INT,
  pms_name                  TEXT,
  is_parent                 BOOLEAN,
  sync_on                   BOOLEAN,                  -- stored for completeness; no UI logic
  base_price                NUMERIC(12,2),
  min_price                 NUMERIC(12,2),
  max_price                 NUMERIC(12,2),            -- mostly null
  base_price_recommendation NUMERIC(12,2),
  tags                      TEXT[],                   -- report "Tag"
  last_booked_date          TIMESTAMPTZ,
  hub_listing_id            UUID REFERENCES listings(id) ON DELETE SET NULL,  -- resolved linkage
  hub_client_id             UUID REFERENCES clients(id)  ON DELETE SET NULL,
  report_run_id             UUID REFERENCES report_runs(id) ON DELETE SET NULL,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_listings_hub_listing ON report_listings(hub_listing_id);
CREATE INDEX idx_report_listings_hub_client  ON report_listings(hub_client_id);
CREATE INDEX idx_report_listings_group       ON report_listings(group_name);

-- Monthly metrics, grain = listing × month × run. Each completed run is a full
-- snapshot; the dashboard reads the latest completed run. Idempotent on
-- (listing_id, period, report_run_id).
CREATE TABLE report_metrics (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_run_id                     UUID NOT NULL REFERENCES report_runs(id) ON DELETE CASCADE,
  listing_id                        TEXT NOT NULL REFERENCES report_listings(listing_id) ON DELETE CASCADE,
  period                            DATE NOT NULL,    -- 1st of month, derived from "Year Month" ("2026-01.Jan" → 2026-01-01)
  period_label                      TEXT,             -- raw "2026-01.Jan"
  -- Revenue
  rental_revenue                    NUMERIC(12,2),
  rental_revenue_stly               NUMERIC(12,2),
  rental_revenue_ly                 NUMERIC(12,2),
  rental_revenue_stly_yoy_pct       NUMERIC(7,2),
  -- ADR
  rental_adr                        NUMERIC(12,2),
  rental_adr_stly                   NUMERIC(12,2),
  rental_adr_ly                     NUMERIC(12,2),
  rental_adr_stly_yoy_pct           NUMERIC(7,2),
  market_adr                        NUMERIC(12,2),
  market_adr_stly                   NUMERIC(12,2),
  market_adr_stly_yoy_pct           NUMERIC(7,2),
  -- RevPAR
  rental_revpar                     NUMERIC(12,2),
  rental_revpar_stly                NUMERIC(12,2),
  rental_revpar_ly                  NUMERIC(12,2),
  rental_revpar_stly_yoy_pct        NUMERIC(7,2),
  market_revpar                     NUMERIC(12,2),
  market_revpar_stly                NUMERIC(12,2),
  market_revpar_ly                  NUMERIC(12,2),
  market_revpar_stly_yoy_pct        NUMERIC(7,2),
  revpar_index                      NUMERIC(7,2),     -- "Market Penetration RevPar Index"
  -- Occupancy (%)
  adjusted_occupancy_pct            NUMERIC(7,2),
  adjusted_occupancy_stly_pct       NUMERIC(7,2),
  adjusted_occupancy_ly_pct         NUMERIC(7,2),
  market_occupancy_pct              NUMERIC(7,2),
  market_occupancy_stly_pct         NUMERIC(7,2),
  market_occupancy_ly_pct           NUMERIC(7,2),
  -- Booking window (days)
  median_booking_window             NUMERIC(7,2),
  median_booking_window_stly        NUMERIC(7,2),
  median_booking_window_ly          NUMERIC(7,2),
  market_median_booking_window      NUMERIC(7,2),
  market_median_booking_window_stly NUMERIC(7,2),
  market_median_booking_window_ly   NUMERIC(7,2),
  -- Open inventory
  potential_revenue_open_inventory  NUMERIC(12,2),    -- "Available and Bookable dates Recommended Potential Revenue"
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, period, report_run_id)
);

CREATE INDEX idx_report_metrics_run            ON report_metrics(report_run_id);
CREATE INDEX idx_report_metrics_listing_period ON report_metrics(listing_id, period);

-- Manual client overrides for listings that don't match a hub listing by id.
-- Group Name is reliable for newer clients (last name); legacy first-name
-- groups need a punctual override.
CREATE TABLE report_group_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name  TEXT NOT NULL UNIQUE,                   -- matched case-insensitively in code (lower())
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  note        TEXT,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_group_overrides_client ON report_group_overrides(client_id);

-- PriceLabs sync lookup index (also a known perf candidate in docs/agent/performance.md).
CREATE INDEX IF NOT EXISTS idx_listings_listing_id ON listings(listing_id);

-- RLS: performance data (not financial) → all authenticated may read. Writes go
-- through the admin client in server-side ingestion / permission-checked actions,
-- which bypass RLS, so no write policy is defined.
ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_group_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view report_runs"
  ON report_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can view report_listings"
  ON report_listings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can view report_metrics"
  ON report_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can view report_group_overrides"
  ON report_group_overrides FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE report_runs IS
  'PriceLabs Report Builder ingestion runs: async state machine + observability + raw envelope (last N runs).';
COMMENT ON TABLE report_listings IS
  'Listing-level attributes from Report Builder. Current snapshot, upserted by listing_id per run.';
COMMENT ON TABLE report_metrics IS
  'Monthly Report Builder metrics, grain listing × month × run. Dashboard reads the latest completed run.';
COMMENT ON TABLE report_group_overrides IS
  'Manual Group Name → client overrides for listings that do not match a hub listing by id.';
