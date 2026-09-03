-- Migration 20260902203200: create the governed university-event source registry and
-- register the first three institution pilots. Only George Washington is
-- linked to an existing reviewed market. UConn and UT Knoxville remain
-- institution-scoped registry entries until their market proposals are
-- reviewed and created separately. This migration stores no provider
-- credentials, performs no external HTTP requests, and does not seed events
-- whose dates have not been observed through the ingestion pipeline.

-- ==========================================================
-- 1. Institution identity and market relevance
-- ==========================================================

CREATE TABLE public.market_signal_institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipeds_unitid TEXT UNIQUE CHECK (
    ipeds_unitid IS NULL OR ipeds_unitid ~ '^[0-9]{6}$'
  ),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 2 AND 200),
  aliases TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  official_domain TEXT NOT NULL CHECK (
    CHAR_LENGTH(official_domain) BETWEEN 4 AND 255
    AND official_domain !~ '^[a-z]+://'
  ),
  city TEXT NOT NULL CHECK (CHAR_LENGTH(city) BETWEEN 1 AND 120),
  region TEXT NOT NULL CHECK (CHAR_LENGTH(region) BETWEEN 2 AND 120),
  country_code TEXT NOT NULL DEFAULT 'US'
    CHECK (country_code ~ '^[A-Z]{2}$'),
  timezone TEXT NOT NULL CHECK (CHAR_LENGTH(timezone) BETWEEN 3 AND 80),
  latitude NUMERIC(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_market_signal_institutions_status_name
  ON public.market_signal_institutions (status, name);

CREATE TABLE public.revenue_market_institutions (
  market_id UUID NOT NULL
    REFERENCES public.revenue_markets(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL
    REFERENCES public.market_signal_institutions(id) ON DELETE CASCADE,
  relevance_status TEXT NOT NULL DEFAULT 'watch'
    CHECK (relevance_status IN ('active', 'watch', 'excluded')),
  distance_miles NUMERIC(7, 2)
    CHECK (distance_miles IS NULL OR distance_miles >= 0),
  event_types TEXT[] NOT NULL DEFAULT ARRAY[
    'commencement', 'family_weekend'
  ]::TEXT[] CHECK (
    event_types <@ ARRAY[
      'commencement', 'family_weekend', 'homecoming', 'college_football'
    ]::TEXT[]
  ),
  demand_rationale TEXT NOT NULL CHECK (
    CHAR_LENGTH(demand_rationale) BETWEEN 10 AND 1000
  ),
  assignment_mode TEXT NOT NULL DEFAULT 'agent'
    CHECK (assignment_mode IN ('agent', 'human')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (market_id, institution_id)
);

CREATE INDEX idx_revenue_market_institutions_institution
  ON public.revenue_market_institutions (institution_id, relevance_status);
CREATE INDEX idx_revenue_market_institutions_market
  ON public.revenue_market_institutions (market_id, relevance_status);

ALTER TABLE public.revenue_market_sources
  ADD COLUMN institution_id UUID
  REFERENCES public.market_signal_institutions(id) ON DELETE SET NULL;

CREATE INDEX idx_revenue_market_sources_institution
  ON public.revenue_market_sources (institution_id, source_type);

CREATE TRIGGER trg_market_signal_institutions_updated_at
  BEFORE UPDATE ON public.market_signal_institutions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_revenue_market_institutions_updated_at
  BEFORE UPDATE ON public.revenue_market_institutions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================
-- 2. Permission-based RLS
-- ==========================================================

ALTER TABLE public.market_signal_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_market_institutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Market Signals viewers can view institutions"
  ON public.market_signal_institutions FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can create institutions"
  ON public.market_signal_institutions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update institutions"
  ON public.market_signal_institutions FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

CREATE POLICY "Market Signals viewers can view market institutions"
  ON public.revenue_market_institutions FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can map institutions"
  ON public.revenue_market_institutions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update institution mappings"
  ON public.revenue_market_institutions FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

-- ==========================================================
-- 3. Three-institution registry pilot
-- ==========================================================

INSERT INTO public.market_signal_institutions (
  ipeds_unitid, slug, name, aliases, official_domain, city, region,
  country_code, timezone, latitude, longitude, status
) VALUES
  (
    '129020', 'university-of-connecticut', 'University of Connecticut',
    ARRAY['UConn', 'Connecticut Huskies'], 'uconn.edu', 'Storrs', 'CT',
    'US', 'America/New_York', 41.807700, -72.254000, 'active'
  ),
  (
    '221759', 'university-of-tennessee-knoxville',
    'University of Tennessee, Knoxville',
    ARRAY['UT Knoxville', 'UTK', 'Tennessee Volunteers'], 'utk.edu',
    'Knoxville', 'TN', 'US', 'America/New_York',
    35.954400, -83.929500, 'active'
  ),
  (
    '131469', 'george-washington-university',
    'George Washington University',
    ARRAY['GW', 'GWU', 'GW Revolutionaries'], 'gwu.edu',
    'Washington', 'DC', 'US', 'America/New_York',
    38.899700, -77.048600, 'active'
  )
ON CONFLICT (slug) DO UPDATE SET
  ipeds_unitid = EXCLUDED.ipeds_unitid,
  name = EXCLUDED.name,
  aliases = EXCLUDED.aliases,
  official_domain = EXCLUDED.official_domain,
  city = EXCLUDED.city,
  region = EXCLUDED.region,
  country_code = EXCLUDED.country_code,
  timezone = EXCLUDED.timezone,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  status = EXCLUDED.status;

INSERT INTO public.revenue_market_institutions (
  market_id, institution_id, relevance_status, distance_miles,
  event_types, demand_rationale, assignment_mode
)
SELECT
  market.id,
  institution.id,
  'active',
  mapping.distance_miles,
  ARRAY['commencement', 'family_weekend', 'college_football']::TEXT[],
  mapping.demand_rationale,
  'agent'
FROM (
  VALUES
    (
      'washington-dc',
      'george-washington-university',
      1.70::NUMERIC,
      'Centrally located university whose National Mall commencement and family programming affect the Washington lodging market.'
    )
) AS mapping(market_slug, institution_slug, distance_miles, demand_rationale)
JOIN public.revenue_markets market ON market.slug = mapping.market_slug
JOIN public.market_signal_institutions institution
  ON institution.slug = mapping.institution_slug
ON CONFLICT (market_id, institution_id) DO UPDATE SET
  relevance_status = EXCLUDED.relevance_status,
  distance_miles = EXCLUDED.distance_miles,
  event_types = EXCLUDED.event_types,
  demand_rationale = EXCLUDED.demand_rationale,
  assignment_mode = EXCLUDED.assignment_mode;

-- Preserve the UConn and Tennessee CFBD research as inactive,
-- institution-scoped registry rows. They deliberately have no market until a
-- reviewed market proposal is created and linked in a later migration. GW
-- does not sponsor varsity football.
INSERT INTO public.revenue_market_sources (
  market_id, institution_id, source_type, name, source_url, query_config,
  trust_tier, cadence_minutes, is_active
)
SELECT
  NULL::UUID,
  institution.id,
  'cfbd',
  source.name,
  'https://collegefootballdata.com/',
  source.query_config,
  2,
  360,
  FALSE
FROM (
  VALUES
    (
      'university-of-connecticut',
      'College Football Data — UConn Huskies',
      '{"team":"UConn","days_forward":370,"max_games":40,"home_only":true,"official_schedule_url":"https://uconnhuskies.com/sports/football/schedule"}'::JSONB
    ),
    (
      'university-of-tennessee-knoxville',
      'College Football Data — Tennessee Volunteers',
      '{"team":"Tennessee","days_forward":370,"max_games":40,"home_only":true,"official_schedule_url":"https://utsports.com/sports/football/schedule"}'::JSONB
    )
) AS source(institution_slug, name, query_config)
JOIN public.market_signal_institutions institution
  ON institution.slug = source.institution_slug
WHERE NOT EXISTS (
  SELECT 1
  FROM public.revenue_market_sources existing
  WHERE existing.market_id IS NULL
    AND existing.institution_id = institution.id
    AND existing.source_type = 'cfbd'
    AND existing.name = source.name
);

-- These authoritative pages are registry-only until an official-page adapter
-- is released. Keeping is_active false prevents the worker from claiming that
-- an unimplemented collector is healthy.
INSERT INTO public.revenue_market_sources (
  market_id, institution_id, source_type, name, source_url, query_config,
  trust_tier, cadence_minutes, is_active
)
SELECT
  market.id,
  institution.id,
  'official_feed',
  source.name,
  source.source_url,
  JSONB_BUILD_OBJECT(
    'adapter', 'official_page',
    'collection_status', 'registry_only',
    'event_types', source.event_types,
    'institution_slug', source.institution_slug,
    'source_role', source.source_role
  ),
  1,
  1440,
  FALSE
FROM (
  VALUES
    (NULL::TEXT, 'university-of-connecticut',
      'UConn Family Weekend', 'https://familyweekend.uconn.edu/',
      ARRAY['family_weekend']::TEXT[], 'canonical'),
    (NULL::TEXT, 'university-of-connecticut',
      'UConn Commencement', 'https://commencement.uconn.edu/',
      ARRAY['commencement']::TEXT[], 'canonical'),
    (NULL::TEXT, 'university-of-connecticut',
      'UConn Academic Calendar', 'https://registrar.uconn.edu/academic-calendar/',
      ARRAY['commencement']::TEXT[], 'corroborating'),
    (NULL::TEXT, 'university-of-tennessee-knoxville',
      'UT Knoxville Vol Family Reunions',
      'https://studentlife.utk.edu/family/events/vol-family-reunions/',
      ARRAY['family_weekend']::TEXT[], 'canonical'),
    (NULL::TEXT, 'university-of-tennessee-knoxville',
      'UT Knoxville Commencement', 'https://commencement.utk.edu/',
      ARRAY['commencement']::TEXT[], 'canonical'),
    (NULL::TEXT, 'university-of-tennessee-knoxville',
      'UT Knoxville Academic Calendar', 'https://registrar.utk.edu/academic-calendar/',
      ARRAY['commencement']::TEXT[], 'corroborating'),
    ('washington-dc', 'george-washington-university',
      'GW Alumni & Families Weekend', 'https://alumnifamiliesweekend.gwu.edu/',
      ARRAY['family_weekend']::TEXT[], 'canonical'),
    ('washington-dc', 'george-washington-university',
      'GW Commencement', 'https://commencement.gwu.edu/',
      ARRAY['commencement']::TEXT[], 'canonical'),
    ('washington-dc', 'george-washington-university',
      'GW Academic Calendar', 'https://www.gwu.edu/academic-calendar',
      ARRAY['commencement']::TEXT[], 'corroborating')
) AS source(
  market_slug, institution_slug, name, source_url, event_types, source_role
)
LEFT JOIN public.revenue_markets market ON market.slug = source.market_slug
JOIN public.market_signal_institutions institution
  ON institution.slug = source.institution_slug
WHERE NOT EXISTS (
  SELECT 1
  FROM public.revenue_market_sources existing
  WHERE existing.market_id IS NOT DISTINCT FROM market.id
    AND existing.institution_id = institution.id
    AND existing.source_type = 'official_feed'
    AND existing.name = source.name
);

COMMENT ON TABLE public.market_signal_institutions IS
  'Canonical institution identities used by governed university-event sources.';
COMMENT ON TABLE public.revenue_market_institutions IS
  'Explicit, evidence-backed institution relevance for each revenue market.';
COMMENT ON COLUMN public.revenue_market_sources.institution_id IS
  'Optional institution identity for university-specific sources.';
