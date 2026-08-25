-- Migration 076: read-only Market Signals persistence foundation
--
-- This creates governed market identity, source registry, normalized event,
-- immutable evidence/version, market-impact, and human-review records. It does
-- not call external APIs and exposes no PriceLabs, PMS, OTA, or Adjustment
-- mutation path.

-- ==========================================================
-- 1. Permission resource
-- ==========================================================

INSERT INTO public.role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'market_signals', a.action, FALSE
FROM public.roles r
CROSS JOIN (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')
) AS a(action)
WHERE r.name <> 'super_admin'
ON CONFLICT (role_name, resource, action) DO UPDATE
SET allowed = EXCLUDED.allowed;

INSERT INTO public.role_permissions (role_name, resource, action, allowed) VALUES
  ('admin', 'market_signals', 'view', TRUE),
  ('admin', 'market_signals', 'create', TRUE),
  ('admin', 'market_signals', 'edit', TRUE),
  ('admin', 'market_signals', 'delete', FALSE),
  ('admin', 'market_signals', 'publish', FALSE),
  ('admin', 'market_signals', 'control', FALSE)
ON CONFLICT (role_name, resource, action) DO UPDATE
SET allowed = EXCLUDED.allowed;

-- ==========================================================
-- 2. Governed markets and source registry
-- ==========================================================

CREATE TABLE public.revenue_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 2 AND 120),
  country_code TEXT NOT NULL DEFAULT 'US'
    CHECK (country_code ~ '^[A-Z]{2}$'),
  timezone TEXT NOT NULL CHECK (CHAR_LENGTH(timezone) BETWEEN 3 AND 80),
  center_lat NUMERIC(9, 6) NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lon NUMERIC(9, 6) NOT NULL CHECK (center_lon BETWEEN -180 AND 180),
  radius_miles NUMERIC(6, 2) NOT NULL CHECK (radius_miles > 0 AND radius_miles <= 150),
  market_kind TEXT NOT NULL DEFAULT 'urban'
    CHECK (market_kind IN ('urban', 'destination', 'cabin', 'coastal', 'mixed')),
  query_terms TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'inactive')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'active' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR status <> 'active'
  )
);

CREATE INDEX idx_revenue_markets_status_name
  ON public.revenue_markets (status, name);

CREATE TABLE public.revenue_market_listings (
  market_id UUID NOT NULL REFERENCES public.revenue_markets(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  distance_miles NUMERIC(7, 2) CHECK (distance_miles IS NULL OR distance_miles >= 0),
  assignment_source TEXT NOT NULL
    CHECK (assignment_source IN ('manual', 'coordinate_import', 'source_suggestion')),
  membership_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (membership_status IN ('proposed', 'approved', 'excluded')),
  override_reason TEXT CHECK (
    override_reason IS NULL OR CHAR_LENGTH(override_reason) <= 1000
  ),
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (market_id, listing_id),
  CHECK (
    (membership_status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR membership_status <> 'approved'
  )
);

CREATE INDEX idx_revenue_market_listings_listing
  ON public.revenue_market_listings (listing_id, membership_status);
CREATE INDEX idx_revenue_market_listings_market
  ON public.revenue_market_listings (market_id, membership_status);

CREATE TABLE public.revenue_market_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID REFERENCES public.revenue_markets(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (
    source_type IN (
      'official_feed', 'ticketmaster', 'nws', 'gdelt',
      'predicthq', 'google_news', 'curated'
    )
  ),
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 2 AND 160),
  source_url TEXT CHECK (source_url IS NULL OR CHAR_LENGTH(source_url) <= 2000),
  query_config JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(query_config) = 'object'),
  trust_tier SMALLINT NOT NULL DEFAULT 3 CHECK (trust_tier BETWEEN 1 AND 4),
  cadence_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (cadence_minutes BETWEEN 5 AND 10080),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  high_water_mark TEXT,
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_status TEXT CHECK (
    last_status IS NULL OR last_status IN ('ok', 'stale', 'rate_limited', 'error')
  ),
  last_error TEXT CHECK (last_error IS NULL OR CHAR_LENGTH(last_error) <= 2000),
  last_rows_read INTEGER CHECK (last_rows_read IS NULL OR last_rows_read >= 0),
  last_rows_changed INTEGER CHECK (last_rows_changed IS NULL OR last_rows_changed >= 0),
  last_dedupe_count INTEGER CHECK (last_dedupe_count IS NULL OR last_dedupe_count >= 0),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, source_type, name)
);

CREATE INDEX idx_revenue_market_sources_due
  ON public.revenue_market_sources (is_active, last_success_at)
  WHERE is_active = TRUE;
CREATE INDEX idx_revenue_market_sources_market
  ON public.revenue_market_sources (market_id, source_type);

-- ==========================================================
-- 3. Canonical events, provider observations, and evidence
-- ==========================================================

CREATE TABLE public.market_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_fingerprint TEXT NOT NULL UNIQUE
    CHECK (CHAR_LENGTH(canonical_fingerprint) BETWEEN 12 AND 160),
  family_key TEXT NOT NULL CHECK (CHAR_LENGTH(family_key) BETWEEN 6 AND 300),
  title TEXT NOT NULL CHECK (CHAR_LENGTH(title) BETWEEN 2 AND 300),
  category TEXT NOT NULL CHECK (CHAR_LENGTH(category) BETWEEN 1 AND 80),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL CHECK (CHAR_LENGTH(timezone) BETWEEN 3 AND 80),
  venue_name TEXT CHECK (venue_name IS NULL OR CHAR_LENGTH(venue_name) <= 200),
  city TEXT NOT NULL CHECK (CHAR_LENGTH(city) BETWEEN 1 AND 120),
  region TEXT CHECK (region IS NULL OR CHAR_LENGTH(region) <= 120),
  country_code TEXT NOT NULL DEFAULT 'US'
    CHECK (country_code ~ '^[A-Z]{2}$'),
  latitude NUMERIC(9, 6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9, 6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  state TEXT NOT NULL DEFAULT 'candidate' CHECK (
    state IN (
      'candidate', 'corroborating', 'verified', 'review_required',
      'actioned', 'monitoring', 'ended', 'rejected', 'duplicate',
      'postponed', 'canceled', 'unwind_required', 'superseded'
    )
  ),
  duplicate_of UUID REFERENCES public.market_events(id) ON DELETE RESTRICT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at >= start_at),
  CHECK (duplicate_of IS NULL OR duplicate_of <> id),
  CHECK ((state = 'duplicate' AND duplicate_of IS NOT NULL) OR state <> 'duplicate')
);

CREATE INDEX idx_market_events_state_start
  ON public.market_events (state, start_at);
CREATE INDEX idx_market_events_family_start
  ON public.market_events (family_key, start_at DESC);
CREATE INDEX idx_market_events_last_seen
  ON public.market_events (last_seen_at DESC);

CREATE TABLE public.market_event_provider_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.market_events(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.revenue_market_sources(id) ON DELETE RESTRICT,
  external_id TEXT NOT NULL CHECK (CHAR_LENGTH(external_id) BETWEEN 1 AND 300),
  source_url TEXT CHECK (source_url IS NULL OR CHAR_LENGTH(source_url) <= 2000),
  provider_status TEXT CHECK (
    provider_status IS NULL OR CHAR_LENGTH(provider_status) <= 80
  ),
  provider_first_seen_at TIMESTAMPTZ,
  provider_updated_at TIMESTAMPTZ,
  first_observed_at TIMESTAMPTZ NOT NULL,
  last_observed_at TIMESTAMPTZ NOT NULL,
  content_hash TEXT NOT NULL CHECK (CHAR_LENGTH(content_hash) BETWEEN 8 AND 128),
  normalized_fields JSONB NOT NULL CHECK (JSONB_TYPEOF(normalized_fields) = 'object'),
  raw_retained_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX idx_market_provider_records_event
  ON public.market_event_provider_records (event_id, last_observed_at DESC);
CREATE INDEX idx_market_provider_records_source
  ON public.market_event_provider_records (source_id, last_observed_at DESC);

CREATE TABLE public.market_event_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.market_events(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  change_type TEXT NOT NULL CHECK (
    change_type IN (
      'new', 'date_moved', 'postponed', 'canceled', 'restored',
      'details_changed', 'merged', 'state_changed'
    )
  ),
  before_snapshot JSONB CHECK (
    before_snapshot IS NULL OR JSONB_TYPEOF(before_snapshot) = 'object'
  ),
  after_snapshot JSONB NOT NULL CHECK (JSONB_TYPEOF(after_snapshot) = 'object'),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, version)
);

CREATE INDEX idx_market_event_versions_recent
  ON public.market_event_versions (event_id, version DESC);

CREATE TABLE public.market_event_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.market_events(id) ON DELETE CASCADE,
  source_id UUID REFERENCES public.revenue_market_sources(id) ON DELETE SET NULL,
  evidence_url TEXT NOT NULL CHECK (CHAR_LENGTH(evidence_url) BETWEEN 8 AND 2000),
  publisher TEXT NOT NULL CHECK (CHAR_LENGTH(publisher) BETWEEN 2 AND 200),
  published_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  authority_tier SMALLINT NOT NULL CHECK (authority_tier BETWEEN 1 AND 4),
  extraction_confidence NUMERIC(4, 3) CHECK (
    extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1
  ),
  verification_state TEXT NOT NULL DEFAULT 'unverified' CHECK (
    verification_state IN ('unverified', 'corroborating', 'verified', 'rejected')
  ),
  evidence_summary TEXT CHECK (
    evidence_summary IS NULL OR CHAR_LENGTH(evidence_summary) <= 2000
  ),
  content_hash TEXT NOT NULL CHECK (CHAR_LENGTH(content_hash) BETWEEN 8 AND 128),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, evidence_url, content_hash)
);

CREATE INDEX idx_market_event_evidence_event
  ON public.market_event_evidence (event_id, authority_tier, observed_at DESC);

-- ==========================================================
-- 4. Market impact and append-only reviewer decisions
-- ==========================================================

CREATE TABLE public.market_event_impacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.market_events(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES public.revenue_markets(id) ON DELETE CASCADE,
  impact_start DATE NOT NULL,
  impact_end DATE NOT NULL,
  distance_miles NUMERIC(7, 2) CHECK (distance_miles IS NULL OR distance_miles >= 0),
  predicted_attendance INTEGER CHECK (predicted_attendance IS NULL OR predicted_attendance >= 0),
  local_rank NUMERIC(5, 2) CHECK (local_rank IS NULL OR local_rank BETWEEN 0 AND 100),
  materiality_score NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (materiality_score BETWEEN 0 AND 100),
  vulnerability_score NUMERIC(5, 2)
    CHECK (vulnerability_score IS NULL OR vulnerability_score BETWEEN 0 AND 100),
  action_gate TEXT NOT NULL DEFAULT 'watch'
    CHECK (action_gate IN ('watch', 'review_now', 'unwind')),
  score_components JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(score_components) = 'object'),
  evidence_freshness TEXT NOT NULL DEFAULT 'unknown'
    CHECK (evidence_freshness IN ('current', 'stale', 'unknown')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, market_id),
  CHECK (impact_end >= impact_start)
);

CREATE INDEX idx_market_impacts_queue
  ON public.market_event_impacts (action_gate, status, impact_start);
CREATE INDEX idx_market_impacts_market
  ON public.market_event_impacts (market_id, status, impact_start);

CREATE TABLE public.market_signal_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impact_id UUID NOT NULL REFERENCES public.market_event_impacts(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (
    decision IN (
      'watch', 'dismissed', 'create_adjustment',
      'link_adjustment', 'escalated'
    )
  ),
  reason TEXT NOT NULL CHECK (CHAR_LENGTH(reason) BETWEEN 3 AND 2000),
  evidence_snapshot JSONB NOT NULL CHECK (JSONB_TYPEOF(evidence_snapshot) = 'object'),
  adjustment_id UUID REFERENCES public.adjustments(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (decision = 'link_adjustment' AND adjustment_id IS NOT NULL)
    OR decision <> 'link_adjustment'
  )
);

CREATE INDEX idx_market_signal_reviews_impact
  ON public.market_signal_reviews (impact_id, created_at DESC);

-- ==========================================================
-- 5. Integrity and update triggers
-- ==========================================================

CREATE TRIGGER trg_revenue_markets_updated_at
  BEFORE UPDATE ON public.revenue_markets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_revenue_market_listings_updated_at
  BEFORE UPDATE ON public.revenue_market_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_revenue_market_sources_updated_at
  BEFORE UPDATE ON public.revenue_market_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_market_events_updated_at
  BEFORE UPDATE ON public.market_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_market_provider_records_updated_at
  BEFORE UPDATE ON public.market_event_provider_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_market_impacts_updated_at
  BEFORE UPDATE ON public.market_event_impacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_market_signal_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_market_signal_append_only_mutation()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_market_event_versions_append_only
  BEFORE UPDATE OR DELETE ON public.market_event_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_market_signal_append_only_mutation();
CREATE TRIGGER trg_market_event_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.market_event_evidence
  FOR EACH ROW EXECUTE FUNCTION public.prevent_market_signal_append_only_mutation();
CREATE TRIGGER trg_market_signal_reviews_append_only
  BEFORE UPDATE OR DELETE ON public.market_signal_reviews
  FOR EACH ROW EXECUTE FUNCTION public.prevent_market_signal_append_only_mutation();

-- ==========================================================
-- 6. Permission-based RLS
-- ==========================================================

ALTER TABLE public.revenue_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_market_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_market_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_event_provider_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_event_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_event_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_event_impacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_signal_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Market Signals viewers can view markets"
  ON public.revenue_markets FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can create markets"
  ON public.revenue_markets FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update markets"
  ON public.revenue_markets FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (public.has_permission('market_signals', 'edit'));

CREATE POLICY "Market Signals viewers can view market listings"
  ON public.revenue_market_listings FOR SELECT TO authenticated
  USING (
    public.has_permission('market_signals', 'view')
    AND public.has_permission('listings', 'view')
  );
CREATE POLICY "Market Signals creators can propose market listings"
  ON public.revenue_market_listings FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND public.has_permission('listings', 'view')
    AND assigned_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can review market listings"
  ON public.revenue_market_listings FOR UPDATE TO authenticated
  USING (
    public.has_permission('market_signals', 'edit')
    AND public.has_permission('listings', 'view')
  )
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND public.has_permission('listings', 'view')
  );

CREATE POLICY "Market Signals viewers can view source health"
  ON public.revenue_market_sources FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can create sources"
  ON public.revenue_market_sources FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update sources"
  ON public.revenue_market_sources FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (public.has_permission('market_signals', 'edit'));

CREATE POLICY "Market Signals viewers can view canonical events"
  ON public.market_events FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals viewers can view provider records"
  ON public.market_event_provider_records FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals viewers can view event versions"
  ON public.market_event_versions FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals viewers can view event evidence"
  ON public.market_event_evidence FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals viewers can view impacts"
  ON public.market_event_impacts FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals viewers can view reviews"
  ON public.market_signal_reviews FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals editors can record review decisions"
  ON public.market_signal_reviews FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND created_by = auth.uid()
  );

-- ==========================================================
-- 7. Draft pilot registry — requires explicit human activation
-- ==========================================================

INSERT INTO public.revenue_markets (
  id, slug, name, country_code, timezone, center_lat, center_lon,
  radius_miles, market_kind, query_terms, status
) VALUES
  (
    '76000000-0000-4000-8000-000000000001', 'washington-dc',
    'Washington, DC', 'US', 'America/New_York', 38.907200, -77.036900,
    5.00, 'urban', ARRAY['Washington DC', 'National Mall', 'District of Columbia'], 'draft'
  ),
  (
    '76000000-0000-4000-8000-000000000002', 'tucson-az',
    'Tucson, AZ', 'US', 'America/Phoenix', 32.222600, -110.974700,
    8.00, 'destination', ARRAY['Tucson', 'Pima County', 'Tucson Gem Show'], 'draft'
  ),
  (
    '76000000-0000-4000-8000-000000000003', 'myrtle-beach-sc',
    'Myrtle Beach, SC', 'US', 'America/New_York', 33.689100, -78.886700,
    8.00, 'coastal', ARRAY['Myrtle Beach', 'Grand Strand', 'Horry County'], 'draft'
  ),
  (
    '76000000-0000-4000-8000-000000000004', 'park-city-ut',
    'Park City, UT', 'US', 'America/Denver', 40.646100, -111.498000,
    4.00, 'destination', ARRAY['Park City', 'Summit County Utah'], 'draft'
  ),
  (
    '76000000-0000-4000-8000-000000000005', 'smokies-tn',
    'Gatlinburg / Smokies, TN', 'US', 'America/New_York', 35.714300, -83.510200,
    5.00, 'cabin', ARRAY['Gatlinburg', 'Pigeon Forge', 'Great Smoky Mountains'], 'draft'
  )
ON CONFLICT (id) DO NOTHING;

-- Each market gets a disabled PredictHQ adapter definition. A human must first
-- review coordinate-derived listing membership and activate the pilot market;
-- credentials remain server-side and are never stored in this table.
INSERT INTO public.revenue_market_sources (
  id, market_id, source_type, name, query_config, trust_tier,
  cadence_minutes, is_active
) VALUES
  (
    '76100000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000001',
    'predicthq', 'PredictHQ Events',
    '{"days_forward":90,"rank_gte":40,"max_events":1000,"categories":["community","conferences","concerts","expos","festivals","performing-arts","sports"]}'::JSONB,
    2, 60, FALSE
  ),
  (
    '76100000-0000-4000-8000-000000000002',
    '76000000-0000-4000-8000-000000000002',
    'predicthq', 'PredictHQ Events',
    '{"days_forward":90,"rank_gte":40,"max_events":1000,"categories":["community","conferences","concerts","expos","festivals","performing-arts","sports"]}'::JSONB,
    2, 60, FALSE
  ),
  (
    '76100000-0000-4000-8000-000000000003',
    '76000000-0000-4000-8000-000000000003',
    'predicthq', 'PredictHQ Events',
    '{"days_forward":90,"rank_gte":40,"max_events":1000,"categories":["community","conferences","concerts","expos","festivals","performing-arts","sports"]}'::JSONB,
    2, 60, FALSE
  ),
  (
    '76100000-0000-4000-8000-000000000004',
    '76000000-0000-4000-8000-000000000004',
    'predicthq', 'PredictHQ Events',
    '{"days_forward":90,"rank_gte":40,"max_events":1000,"categories":["community","conferences","concerts","expos","festivals","performing-arts","sports"]}'::JSONB,
    2, 60, FALSE
  ),
  (
    '76100000-0000-4000-8000-000000000005',
    '76000000-0000-4000-8000-000000000005',
    'predicthq', 'PredictHQ Events',
    '{"days_forward":90,"rank_gte":40,"max_events":1000,"categories":["community","conferences","concerts","expos","festivals","performing-arts","sports"]}'::JSONB,
    2, 60, FALSE
  )
ON CONFLICT (id) DO NOTHING;
