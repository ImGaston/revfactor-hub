-- Migration 20260902203300: additive Market & Event Intelligence foundation.
--
-- This migration normalizes State -> Market -> Locality geography, makes the
-- listing-to-market role explicit, separates provider identity from per-market
-- source configuration, and adds recurring event/date-watch primitives. It
-- performs no external requests and creates no pricing, stay-rule, PMS, OTA,
-- or notification write path.

-- ==========================================================
-- 1. Canonical state and locality geography
-- ==========================================================

CREATE TABLE public.revenue_market_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL DEFAULT 'US'
    CHECK (country_code ~ '^[A-Z]{2}$'),
  code TEXT NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,8}$'),
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 2 AND 120),
  subdivision_type TEXT NOT NULL DEFAULT 'state'
    CHECK (subdivision_type IN ('state', 'district', 'territory', 'province', 'other')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code, code)
);

CREATE INDEX idx_revenue_market_states_status_name
  ON public.revenue_market_states (status, country_code, name);

INSERT INTO public.revenue_market_states (
  country_code, code, name, subdivision_type
)
VALUES
  ('US', 'AL', 'Alabama', 'state'),
  ('US', 'AK', 'Alaska', 'state'),
  ('US', 'AZ', 'Arizona', 'state'),
  ('US', 'AR', 'Arkansas', 'state'),
  ('US', 'CA', 'California', 'state'),
  ('US', 'CO', 'Colorado', 'state'),
  ('US', 'CT', 'Connecticut', 'state'),
  ('US', 'DE', 'Delaware', 'state'),
  ('US', 'DC', 'District of Columbia', 'district'),
  ('US', 'FL', 'Florida', 'state'),
  ('US', 'GA', 'Georgia', 'state'),
  ('US', 'HI', 'Hawaii', 'state'),
  ('US', 'ID', 'Idaho', 'state'),
  ('US', 'IL', 'Illinois', 'state'),
  ('US', 'IN', 'Indiana', 'state'),
  ('US', 'IA', 'Iowa', 'state'),
  ('US', 'KS', 'Kansas', 'state'),
  ('US', 'KY', 'Kentucky', 'state'),
  ('US', 'LA', 'Louisiana', 'state'),
  ('US', 'ME', 'Maine', 'state'),
  ('US', 'MD', 'Maryland', 'state'),
  ('US', 'MA', 'Massachusetts', 'state'),
  ('US', 'MI', 'Michigan', 'state'),
  ('US', 'MN', 'Minnesota', 'state'),
  ('US', 'MS', 'Mississippi', 'state'),
  ('US', 'MO', 'Missouri', 'state'),
  ('US', 'MT', 'Montana', 'state'),
  ('US', 'NE', 'Nebraska', 'state'),
  ('US', 'NV', 'Nevada', 'state'),
  ('US', 'NH', 'New Hampshire', 'state'),
  ('US', 'NJ', 'New Jersey', 'state'),
  ('US', 'NM', 'New Mexico', 'state'),
  ('US', 'NY', 'New York', 'state'),
  ('US', 'NC', 'North Carolina', 'state'),
  ('US', 'ND', 'North Dakota', 'state'),
  ('US', 'OH', 'Ohio', 'state'),
  ('US', 'OK', 'Oklahoma', 'state'),
  ('US', 'OR', 'Oregon', 'state'),
  ('US', 'PA', 'Pennsylvania', 'state'),
  ('US', 'RI', 'Rhode Island', 'state'),
  ('US', 'SC', 'South Carolina', 'state'),
  ('US', 'SD', 'South Dakota', 'state'),
  ('US', 'TN', 'Tennessee', 'state'),
  ('US', 'TX', 'Texas', 'state'),
  ('US', 'UT', 'Utah', 'state'),
  ('US', 'VT', 'Vermont', 'state'),
  ('US', 'VA', 'Virginia', 'state'),
  ('US', 'WA', 'Washington', 'state'),
  ('US', 'WV', 'West Virginia', 'state'),
  ('US', 'WI', 'Wisconsin', 'state'),
  ('US', 'WY', 'Wyoming', 'state'),
  ('US', 'AS', 'American Samoa', 'territory'),
  ('US', 'GU', 'Guam', 'territory'),
  ('US', 'MP', 'Northern Mariana Islands', 'territory'),
  ('US', 'PR', 'Puerto Rico', 'territory'),
  ('US', 'VI', 'U.S. Virgin Islands', 'territory')
ON CONFLICT (country_code, code) DO NOTHING;

ALTER TABLE public.revenue_markets
  ADD COLUMN state_id UUID
  REFERENCES public.revenue_market_states(id) ON DELETE RESTRICT;

UPDATE public.revenue_markets market
SET state_id = state.id
FROM public.revenue_market_states state
WHERE market.state_id IS NULL
  AND state.country_code = market.country_code
  AND state.code = UPPER(RIGHT(market.slug, 2));

-- Existing unmatched rows remain visible for cleanup. New/updated active
-- markets must participate in the canonical hierarchy.
ALTER TABLE public.revenue_markets
  ADD CONSTRAINT revenue_markets_active_state_check
  CHECK (status <> 'active' OR state_id IS NOT NULL) NOT VALID;

CREATE INDEX idx_revenue_markets_state_status
  ON public.revenue_markets (state_id, status, name);

CREATE TABLE public.revenue_market_state_memberships (
  market_id UUID NOT NULL
    REFERENCES public.revenue_markets(id) ON DELETE CASCADE,
  state_id UUID NOT NULL
    REFERENCES public.revenue_market_states(id) ON DELETE RESTRICT,
  relationship_type TEXT NOT NULL DEFAULT 'secondary'
    CHECK (relationship_type IN ('primary', 'secondary')),
  assignment_mode TEXT NOT NULL DEFAULT 'agent'
    CHECK (assignment_mode IN ('agent', 'human')),
  is_assignment_locked BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT CHECK (
    override_reason IS NULL OR CHAR_LENGTH(override_reason) <= 1000
  ),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (market_id, state_id)
);

CREATE UNIQUE INDEX uq_revenue_market_state_memberships_primary
  ON public.revenue_market_state_memberships (market_id)
  WHERE relationship_type = 'primary';

CREATE INDEX idx_revenue_market_state_memberships_state
  ON public.revenue_market_state_memberships (state_id, relationship_type);

INSERT INTO public.revenue_market_state_memberships (
  market_id, state_id, relationship_type, assignment_mode
)
SELECT market.id, market.state_id, 'primary', 'agent'
FROM public.revenue_markets market
WHERE market.state_id IS NOT NULL
ON CONFLICT (market_id, state_id) DO NOTHING;

-- revenue_markets.state_id remains the backward-compatible primary anchor.
-- This trigger keeps that anchor and the normalized membership in sync while
-- preserving any locked human jurisdiction decision.
CREATE OR REPLACE FUNCTION public.sync_revenue_market_primary_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.state_id IS NULL
     OR (
       TG_OP = 'UPDATE'
       AND NEW.state_id IS NOT DISTINCT FROM OLD.state_id
     ) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.revenue_market_state_memberships membership
    WHERE membership.market_id = NEW.id
      AND membership.relationship_type = 'primary'
      AND membership.state_id <> NEW.state_id
      AND membership.is_assignment_locked
  ) THEN
    RAISE EXCEPTION 'Cannot replace a locked primary market state';
  END IF;

  UPDATE public.revenue_market_state_memberships
  SET relationship_type = 'secondary', updated_at = NOW()
  WHERE market_id = NEW.id
    AND relationship_type = 'primary'
    AND state_id <> NEW.state_id;

  INSERT INTO public.revenue_market_state_memberships (
    market_id, state_id, relationship_type, assignment_mode, created_by
  )
  VALUES (
    NEW.id, NEW.state_id, 'primary', NEW.management_mode, NEW.created_by
  )
  ON CONFLICT (market_id, state_id) DO UPDATE SET
    relationship_type = 'primary',
    updated_at = NOW()
  WHERE NOT public.revenue_market_state_memberships.is_assignment_locked
     OR public.revenue_market_state_memberships.relationship_type = 'primary';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot promote a locked secondary market state';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_revenue_market_primary_state()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_revenue_markets_sync_primary_state
  AFTER INSERT OR UPDATE OF state_id ON public.revenue_markets
  FOR EACH ROW EXECUTE FUNCTION public.sync_revenue_market_primary_state();

CREATE OR REPLACE FUNCTION public.validate_revenue_market_state_memberships()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_market_id UUID := COALESCE(
    NULLIF(TO_JSONB(NEW)->>'market_id', '')::UUID,
    NULLIF(TO_JSONB(OLD)->>'market_id', '')::UUID,
    NULLIF(TO_JSONB(NEW)->>'id', '')::UUID,
    NULLIF(TO_JSONB(OLD)->>'id', '')::UUID
  );
  anchor_state_id UUID;
  primary_count INTEGER;
  matching_primary_count INTEGER;
BEGIN
  SELECT market.state_id
  INTO anchor_state_id
  FROM public.revenue_markets market
  WHERE market.id = affected_market_id;

  IF anchor_state_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE relationship_type = 'primary'),
    COUNT(*) FILTER (
      WHERE relationship_type = 'primary' AND state_id = anchor_state_id
    )
  INTO primary_count, matching_primary_count
  FROM public.revenue_market_state_memberships
  WHERE market_id = affected_market_id;

  IF primary_count <> 1 OR matching_primary_count <> 1 THEN
    RAISE EXCEPTION
      'Market % must have exactly one primary state matching its anchor',
      affected_market_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_revenue_market_state_memberships()
  FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER trg_validate_revenue_market_state_memberships
  AFTER INSERT OR UPDATE OR DELETE
  ON public.revenue_market_state_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_revenue_market_state_memberships();

CREATE CONSTRAINT TRIGGER trg_validate_revenue_market_anchor_state
  AFTER INSERT OR UPDATE OF state_id
  ON public.revenue_markets
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_revenue_market_state_memberships();

CREATE TABLE public.revenue_market_localities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL
    REFERENCES public.revenue_markets(id) ON DELETE CASCADE,
  state_id UUID NOT NULL
    REFERENCES public.revenue_market_states(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 160),
  locality_type TEXT NOT NULL DEFAULT 'city'
    CHECK (locality_type IN ('city', 'town', 'village', 'cdp', 'neighborhood', 'county', 'district', 'other')),
  aliases TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  postal_codes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  center_lat NUMERIC(9, 6) CHECK (center_lat IS NULL OR center_lat BETWEEN -90 AND 90),
  center_lon NUMERIC(9, 6) CHECK (center_lon IS NULL OR center_lon BETWEEN -180 AND 180),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'inactive', 'excluded')),
  assignment_mode TEXT NOT NULL DEFAULT 'agent'
    CHECK (assignment_mode IN ('agent', 'human')),
  is_assignment_locked BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT CHECK (
    override_reason IS NULL OR CHAR_LENGTH(override_reason) <= 1000
  ),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, slug),
  UNIQUE (market_id, id),
  FOREIGN KEY (market_id, state_id)
    REFERENCES public.revenue_market_state_memberships(market_id, state_id)
    ON DELETE RESTRICT,
  CHECK (
    status <> 'excluded'
    OR (is_assignment_locked AND override_reason IS NOT NULL)
  )
);

CREATE INDEX idx_revenue_market_localities_market
  ON public.revenue_market_localities (market_id, status, name);

-- Canonical pilot localities make the intended market boundary explicit. The
-- insert is additive and never replaces a later human exclusion or override.
INSERT INTO public.revenue_market_localities (
  market_id, state_id, slug, name, locality_type, aliases, status,
  assignment_mode
)
SELECT
  market.id,
  market.state_id,
  locality.slug,
  locality.name,
  locality.locality_type,
  locality.aliases,
  'active',
  'agent'
FROM (
  VALUES
    ('smokies-tn', 'sevierville', 'Sevierville', 'city', ARRAY['Sevierville, TN']::TEXT[]),
    ('smokies-tn', 'pigeon-forge', 'Pigeon Forge', 'city', ARRAY['Pigeon Forge, TN']::TEXT[]),
    ('smokies-tn', 'gatlinburg', 'Gatlinburg', 'city', ARRAY['Gatlinburg, TN']::TEXT[]),
    ('smokies-tn', 'pittman-center', 'Pittman Center', 'town', ARRAY['Pittman Center, TN']::TEXT[]),
    ('knoxville-tn', 'knoxville', 'Knoxville', 'city', ARRAY['Knoxville, TN']::TEXT[]),
    ('eastern-connecticut-ct', 'storrs', 'Storrs', 'cdp', ARRAY['Storrs Mansfield']::TEXT[]),
    ('eastern-connecticut-ct', 'mansfield', 'Mansfield', 'town', ARRAY['Mansfield, CT']::TEXT[]),
    ('eastern-connecticut-ct', 'willimantic', 'Willimantic', 'city', ARRAY['Willimantic, CT']::TEXT[]),
    ('washington-dc', 'washington-dc', 'Washington', 'district', ARRAY['Washington DC', 'District of Columbia']::TEXT[]),
    ('tucson-az', 'tucson', 'Tucson', 'city', ARRAY['Tucson, AZ']::TEXT[]),
    ('myrtle-beach-sc', 'myrtle-beach', 'Myrtle Beach', 'city', ARRAY['Grand Strand']::TEXT[]),
    ('park-city-ut', 'park-city', 'Park City', 'city', ARRAY['Park City, UT']::TEXT[])
) AS locality(market_slug, slug, name, locality_type, aliases)
JOIN public.revenue_markets market ON market.slug = locality.market_slug
ON CONFLICT (market_id, slug) DO NOTHING;

-- ==========================================================
-- 2. Primary and secondary listing-market membership
-- ==========================================================

ALTER TABLE public.revenue_market_listings
  ADD COLUMN relationship_type TEXT NOT NULL DEFAULT 'secondary'
  CHECK (relationship_type IN ('primary', 'secondary')),
  ADD COLUMN is_assignment_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN locality_id UUID,
  ADD CONSTRAINT revenue_market_listings_locality_same_market_fkey
    FOREIGN KEY (market_id, locality_id)
    REFERENCES public.revenue_market_localities(market_id, id)
    ON DELETE RESTRICT;

UPDATE public.revenue_market_listings
SET is_assignment_locked = TRUE
WHERE assignment_source = 'manual'
   OR membership_status = 'excluded'
   OR override_reason IS NOT NULL;

-- Choose one existing approved assignment deterministically. A deliberate
-- manual assignment wins; otherwise the closest known market wins. No status,
-- exclusion, source, or override reason is changed.
WITH ranked_approved AS (
  SELECT
    market_id,
    listing_id,
    ROW_NUMBER() OVER (
      PARTITION BY listing_id
      ORDER BY
        CASE WHEN assignment_source = 'manual' THEN 0 ELSE 1 END,
        distance_miles ASC NULLS LAST,
        created_at ASC,
        market_id ASC
    ) AS assignment_rank
  FROM public.revenue_market_listings
  WHERE membership_status = 'approved'
)
UPDATE public.revenue_market_listings membership
SET relationship_type = CASE
  WHEN ranked.assignment_rank = 1 THEN 'primary'
  ELSE 'secondary'
END
FROM ranked_approved ranked
WHERE membership.market_id = ranked.market_id
  AND membership.listing_id = ranked.listing_id;

CREATE UNIQUE INDEX uq_revenue_market_listings_approved_primary
  ON public.revenue_market_listings (listing_id)
  WHERE membership_status = 'approved' AND relationship_type = 'primary';

CREATE INDEX idx_revenue_market_listings_role
  ON public.revenue_market_listings (
    market_id, relationship_type, membership_status
  );

CREATE INDEX idx_revenue_market_listings_locality
  ON public.revenue_market_listings (locality_id, membership_status)
  WHERE locality_id IS NOT NULL;

CREATE VIEW public.market_listing_assignment_audit
WITH (security_invoker = TRUE)
AS
SELECT
  listing.id AS listing_id,
  COUNT(membership.market_id) FILTER (
    WHERE membership.membership_status = 'approved'
  ) AS approved_market_count,
  COUNT(membership.market_id) FILTER (
    WHERE membership.membership_status = 'approved'
      AND membership.relationship_type = 'primary'
  ) AS approved_primary_count,
  COUNT(membership.market_id) FILTER (
    WHERE membership.membership_status = 'approved'
      AND membership.relationship_type = 'secondary'
  ) AS approved_secondary_count,
  COUNT(membership.market_id) FILTER (
    WHERE membership.membership_status = 'proposed'
  ) AS proposed_market_count,
  COUNT(membership.market_id) FILTER (
    WHERE membership.membership_status = 'excluded'
  ) AS excluded_market_count
FROM public.listings listing
LEFT JOIN public.revenue_market_listings membership
  ON membership.listing_id = listing.id
WHERE listing.status = 'active'
GROUP BY listing.id;

GRANT SELECT ON public.market_listing_assignment_audit TO authenticated;

-- ==========================================================
-- 3. Draft market proposals
-- ==========================================================

CREATE TABLE public.revenue_market_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id UUID NOT NULL
    REFERENCES public.revenue_market_states(id) ON DELETE RESTRICT,
  proposed_slug TEXT NOT NULL
    CHECK (proposed_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  proposed_name TEXT NOT NULL
    CHECK (CHAR_LENGTH(proposed_name) BETWEEN 2 AND 160),
  proposed_market_kind TEXT NOT NULL DEFAULT 'urban'
    CHECK (proposed_market_kind IN ('urban', 'destination', 'cabin', 'coastal', 'mixed')),
  proposed_localities JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (JSONB_TYPEOF(proposed_localities) = 'array'),
  proposed_center_lat NUMERIC(9, 6)
    CHECK (proposed_center_lat IS NULL OR proposed_center_lat BETWEEN -90 AND 90),
  proposed_center_lon NUMERIC(9, 6)
    CHECK (proposed_center_lon IS NULL OR proposed_center_lon BETWEEN -180 AND 180),
  proposed_radius_miles NUMERIC(6, 2)
    CHECK (proposed_radius_miles IS NULL OR proposed_radius_miles > 0),
  proposal_source TEXT NOT NULL
    CHECK (proposal_source IN ('human', 'onboarding', 'coordinate_cluster', 'grok', 'research')),
  rationale TEXT NOT NULL CHECK (CHAR_LENGTH(rationale) BETWEEN 10 AND 3000),
  evidence JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (JSONB_TYPEOF(evidence) = 'array'),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'needs_review', 'approved', 'rejected', 'merged')),
  resolved_market_id UUID
    REFERENCES public.revenue_markets(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'merged' OR resolved_market_id IS NOT NULL),
  CHECK (
    status NOT IN ('approved', 'rejected', 'merged')
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX idx_revenue_market_proposals_queue
  ON public.revenue_market_proposals (status, state_id, created_at);

CREATE UNIQUE INDEX uq_revenue_market_proposals_open_slug
  ON public.revenue_market_proposals (state_id, proposed_slug)
  WHERE status IN ('draft', 'needs_review', 'approved');

-- Candidate listings remain normalized and reviewable while a proposed market
-- is unresolved. Accepting a candidate records only a review decision; it does
-- not create a market, locality, or listing-market membership.
CREATE TABLE public.revenue_market_proposal_listings (
  proposal_id UUID NOT NULL
    REFERENCES public.revenue_market_proposals(id) ON DELETE RESTRICT,
  listing_id UUID NOT NULL
    REFERENCES public.listings(id) ON DELETE RESTRICT,
  proposed_locality_slug TEXT CHECK (
    proposed_locality_slug IS NULL
    OR proposed_locality_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  candidate_source TEXT NOT NULL
    CHECK (candidate_source IN (
      'human', 'onboarding', 'coordinate_cluster', 'grok', 'research'
    )),
  distance_miles NUMERIC(7, 2)
    CHECK (distance_miles IS NULL OR distance_miles >= 0),
  confidence_score NUMERIC(4, 3)
    CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  rationale TEXT NOT NULL CHECK (CHAR_LENGTH(rationale) BETWEEN 10 AND 2000),
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(evidence) = 'object'),
  review_status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review', 'accepted', 'rejected', 'withdrawn')),
  review_notes TEXT CHECK (
    review_notes IS NULL OR CHAR_LENGTH(review_notes) <= 2000
  ),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (proposal_id, listing_id),
  CHECK (
    review_status NOT IN ('accepted', 'rejected')
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX idx_revenue_market_proposal_listings_review
  ON public.revenue_market_proposal_listings (
    proposal_id, review_status, created_at
  );

CREATE INDEX idx_revenue_market_proposal_listings_listing
  ON public.revenue_market_proposal_listings (listing_id, review_status);

-- ==========================================================
-- 4. Provider-level catalog, separate from market sources
-- ==========================================================

CREATE TABLE public.market_signal_source_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL UNIQUE
    CHECK (provider_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 2 AND 160),
  provider_class TEXT NOT NULL
    CHECK (provider_class IN ('official', 'structured_provider', 'aggregator', 'discovery', 'reference')),
  implementation_status TEXT NOT NULL DEFAULT 'research'
    CHECK (implementation_status IN ('research', 'credentials_pending', 'pilot', 'active', 'reference_only', 'disabled')),
  auth_method TEXT NOT NULL DEFAULT 'none'
    CHECK (auth_method IN ('none', 'api_key', 'oauth', 'custom', 'unknown')),
  cost_model TEXT NOT NULL DEFAULT 'unknown'
    CHECK (cost_model IN ('open', 'free_tier', 'paid', 'trial', 'unknown')),
  geographic_scope TEXT,
  event_types TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  available_fields TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  default_cadence_minutes INTEGER
    CHECK (default_cadence_minutes IS NULL OR default_cadence_minutes BETWEEN 5 AND 10080),
  maximum_lookahead_days INTEGER
    CHECK (maximum_lookahead_days IS NULL OR maximum_lookahead_days >= 0),
  reliability_tier SMALLINT NOT NULL DEFAULT 3
    CHECK (reliability_tier BETWEEN 1 AND 4),
  corroboration_policy TEXT NOT NULL DEFAULT 'reliable_two'
    CHECK (corroboration_policy IN ('official_single', 'reliable_two', 'manual_only')),
  licensing_notes TEXT CHECK (
    licensing_notes IS NULL OR CHAR_LENGTH(licensing_notes) <= 3000
  ),
  coverage_notes TEXT CHECK (
    coverage_notes IS NULL OR CHAR_LENGTH(coverage_notes) <= 3000
  ),
  backup_provider_keys TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  capabilities JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(capabilities) = 'object'),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.market_signal_source_catalog (
  provider_key, name, provider_class, implementation_status, auth_method,
  cost_model, event_types, available_fields, default_cadence_minutes,
  maximum_lookahead_days, reliability_tier, corroboration_policy,
  coverage_notes
)
VALUES
  ('official_feed', 'Official organizer feeds and pages', 'official', 'pilot', 'none', 'open',
    ARRAY['commencement', 'family_weekend', 'festival', 'convention'],
    ARRAY['title', 'dates', 'venue', 'status'], 1440, NULL, 1, 'official_single',
    'Institution, organizer, venue, tourism, and municipal sources registered individually per market.'),
  ('ticketmaster', 'Ticketmaster Discovery', 'structured_provider', 'pilot', 'api_key', 'free_tier',
    ARRAY['concert', 'sports', 'theater', 'attraction'],
    ARRAY['title', 'dates', 'venue', 'coordinates', 'sales_status'], 180, 180, 2, 'reliable_two',
    'Ticketed-event coverage varies by organizer and does not establish attendance.'),
  ('cfbd', 'College Football Data', 'structured_provider', 'pilot', 'api_key', 'free_tier',
    ARRAY['college_football'],
    ARRAY['teams', 'schedule', 'venue', 'status', 'scores'], 360, 370, 2, 'reliable_two',
    'Home games are mapped through the governed institution registry.'),
  ('nws', 'National Weather Service', 'official', 'pilot', 'custom', 'open',
    ARRAY['weather'],
    ARRAY['alert_type', 'severity', 'certainty', 'urgency', 'dates', 'geography'], 15, NULL, 1, 'official_single',
    'Official United States weather alert source.'),
  ('gdelt', 'GDELT', 'discovery', 'research', 'none', 'open',
    ARRAY['breaking_news', 'disruption'],
    ARRAY['title', 'publication_time', 'publisher', 'url'], 240, NULL, 3, 'reliable_two',
    'Discovery layer; never sufficient as the sole verification source.'),
  ('google_news', 'Google News', 'aggregator', 'research', 'none', 'open',
    ARRAY['breaking_news', 'announcement'],
    ARRAY['title', 'publication_time', 'publisher', 'url'], 240, NULL, 3, 'reliable_two',
    'Discovery layer; linked publisher evidence determines authority.'),
  ('curated', 'Human-curated sources', 'official', 'active', 'none', 'open',
    ARRAY['all'], ARRAY['source_url', 'notes'], NULL, NULL, 1, 'manual_only',
    'Governed manual registry; authority is evaluated per source.'),
  ('predicthq', 'PredictHQ reference archive', 'reference', 'reference_only', 'api_key', 'trial',
    ARRAY['all'], ARRAY['historical_provider_record'], NULL, 90, 3, 'reliable_two',
    'Historical trial data retained only to measure independent recovery coverage.'),
  ('seatgeek', 'SeatGeek', 'structured_provider', 'credentials_pending', 'api_key', 'unknown',
    ARRAY['concert', 'sports', 'theater'], ARRAY['title', 'dates', 'venue', 'coordinates'], NULL, NULL, 2, 'reliable_two',
    'Account approval is pending; no active collector exists.'),
  ('ipeds', 'IPEDS / College Scorecard', 'official', 'research', 'api_key', 'open',
    ARRAY['institution_registry'], ARRAY['institution', 'campus', 'enrollment', 'coordinates'], NULL, NULL, 1, 'official_single',
    'Institution identity and eligibility source, not an event calendar.'),
  ('university_pages', 'Official university event pages', 'official', 'research', 'none', 'open',
    ARRAY['commencement', 'family_weekend', 'homecoming'], ARRAY['title', 'dates', 'location', 'status'], 1440, NULL, 1, 'official_single',
    'Prefer official feeds or structured data; page collectors require per-source validation.'),
  ('fema', 'OpenFEMA', 'official', 'research', 'none', 'open',
    ARRAY['disaster', 'disruption'], ARRAY['declaration', 'dates', 'geography', 'status'], 360, NULL, 1, 'official_single',
    'Official disaster declarations; not a substitute for time-sensitive NWS alerts.'),
  ('tourism_calendars', 'Tourism and convention calendars', 'official', 'research', 'none', 'open',
    ARRAY['festival', 'convention', 'destination_event'], ARRAY['title', 'dates', 'venue', 'url'], 1440, NULL, 1, 'official_single',
    'Market-specific official destination and convention-bureau sources.'),
  ('pro_sports', 'Professional sports schedules', 'structured_provider', 'research', 'unknown', 'unknown',
    ARRAY['professional_sports', 'playoffs'], ARRAY['teams', 'schedule', 'venue', 'status', 'scores'], NULL, NULL, 2, 'reliable_two',
    'Provider selection and playoff-probability method remain design decisions.'),
  ('transportation', 'Transportation disruption feeds', 'official', 'research', 'unknown', 'unknown',
    ARRAY['airport_disruption', 'road_closure'], ARRAY['dates', 'severity', 'geography', 'status'], NULL, NULL, 1, 'official_single',
    'Future FAA, airport, state DOT, and 511 coverage evaluated per market.')
ON CONFLICT (provider_key) DO NOTHING;

ALTER TABLE public.revenue_market_sources
  ADD COLUMN provider_id UUID
  REFERENCES public.market_signal_source_catalog(id) ON DELETE RESTRICT;

UPDATE public.revenue_market_sources source
SET provider_id = catalog.id
FROM public.market_signal_source_catalog catalog
WHERE source.provider_id IS NULL
  AND catalog.provider_key = source.source_type;

ALTER TABLE public.revenue_market_sources
  ALTER COLUMN provider_id SET NOT NULL;

CREATE INDEX idx_revenue_market_sources_provider
  ON public.revenue_market_sources (provider_id, market_id, is_active);

-- ==========================================================
-- 5. Recurring event series and unknown-date watches
-- ==========================================================

CREATE TABLE public.market_event_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_key TEXT NOT NULL UNIQUE
    CHECK (series_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 2 AND 300),
  event_type TEXT NOT NULL CHECK (CHAR_LENGTH(event_type) BETWEEN 1 AND 80),
  event_subtype TEXT CHECK (
    event_subtype IS NULL OR CHAR_LENGTH(event_subtype) <= 120
  ),
  recurrence_frequency TEXT NOT NULL
    CHECK (recurrence_frequency IN ('annual', 'seasonal', 'irregular', 'nonrecurring')),
  recurrence_rule JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(recurrence_rule) = 'object'),
  anchor_market_id UUID
    REFERENCES public.revenue_markets(id) ON DELETE SET NULL,
  institution_id UUID
    REFERENCES public.market_signal_institutions(id) ON DELETE SET NULL,
  canonical_source_id UUID
    REFERENCES public.revenue_market_sources(id) ON DELETE SET NULL,
  audience_segments TEXT[] NOT NULL DEFAULT ARRAY['broad']::TEXT[]
    CHECK (audience_segments <@ ARRAY[
      'families', 'couples', 'friends_groups', 'business', 'students_alumni',
      'sports_fans', 'broad'
    ]::TEXT[]),
  monitor_unknown_dates BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'inactive', 'ended')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_market_event_series_status_type
  ON public.market_event_series (status, event_type, name);

CREATE TABLE public.market_event_series_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL
    REFERENCES public.market_event_series(id) ON DELETE CASCADE,
  target_year SMALLINT NOT NULL CHECK (target_year BETWEEN 2000 AND 2200),
  date_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (date_status IN ('unknown', 'announced', 'confirmed', 'not_applicable')),
  expected_start DATE,
  expected_end DATE,
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  check_cadence_days SMALLINT NOT NULL DEFAULT 30
    CHECK (check_cadence_days BETWEEN 1 AND 365),
  official_source_url TEXT CHECK (
    official_source_url IS NULL OR CHAR_LENGTH(official_source_url) <= 2000
  ),
  last_result TEXT CHECK (
    last_result IS NULL OR CHAR_LENGTH(last_result) <= 2000
  ),
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (series_id, target_year),
  CHECK (expected_end IS NULL OR expected_start IS NOT NULL),
  CHECK (expected_end IS NULL OR expected_end >= expected_start),
  CHECK (date_status <> 'confirmed' OR expected_start IS NOT NULL)
);

CREATE INDEX idx_market_event_series_watches_due
  ON public.market_event_series_watches (next_check_at, target_year)
  WHERE date_status = 'unknown';

CREATE OR REPLACE FUNCTION public.ensure_market_event_series_date_watches()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  first_watch_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
BEGIN
  IF NEW.status = 'active'
     AND NEW.recurrence_frequency = 'annual'
     AND NEW.monitor_unknown_dates THEN
    INSERT INTO public.market_event_series_watches (
      series_id, target_year, next_check_at, created_by
    )
    SELECT
      NEW.id,
      year_to_watch,
      NOW(),
      COALESCE(auth.uid(), NEW.created_by)
    FROM GENERATE_SERIES(
      first_watch_year,
      first_watch_year + 2
    ) AS year_to_watch
    ON CONFLICT (series_id, target_year) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_market_event_series_date_watches
  AFTER INSERT OR UPDATE OF status, recurrence_frequency, monitor_unknown_dates
  ON public.market_event_series
  FOR EACH ROW EXECUTE FUNCTION public.ensure_market_event_series_date_watches();

CREATE OR REPLACE FUNCTION public.replenish_market_event_series_date_watches(
  p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER;
  first_watch_year INTEGER := EXTRACT(YEAR FROM p_as_of_date)::INTEGER;
BEGIN
  INSERT INTO public.market_event_series_watches (
    series_id, target_year, next_check_at, created_by
  )
  SELECT
    series.id,
    year_to_watch,
    NOW(),
    series.created_by
  FROM public.market_event_series series
  CROSS JOIN GENERATE_SERIES(
    first_watch_year,
    first_watch_year + 2
  ) AS year_to_watch
  WHERE series.status = 'active'
    AND series.recurrence_frequency = 'annual'
    AND series.monitor_unknown_dates
  ON CONFLICT (series_id, target_year) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replenish_market_event_series_date_watches(DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replenish_market_event_series_date_watches(DATE)
  TO service_role;

ALTER TABLE public.market_events
  ADD COLUMN series_id UUID
    REFERENCES public.market_event_series(id) ON DELETE SET NULL,
  ADD COLUMN occurrence_year SMALLINT
    CHECK (occurrence_year IS NULL OR occurrence_year BETWEEN 2000 AND 2200),
  ADD COLUMN occurrence_key TEXT NOT NULL DEFAULT 'primary'
    CHECK (occurrence_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  ADD COLUMN event_type TEXT
    CHECK (event_type IS NULL OR CHAR_LENGTH(event_type) BETWEEN 1 AND 80),
  ADD COLUMN event_subtype TEXT
    CHECK (event_subtype IS NULL OR CHAR_LENGTH(event_subtype) <= 120),
  ADD COLUMN audience_segments TEXT[] NOT NULL DEFAULT ARRAY['broad']::TEXT[]
    CHECK (audience_segments <@ ARRAY[
      'families', 'couples', 'friends_groups', 'business', 'students_alumni',
      'sports_fans', 'broad'
    ]::TEXT[]),
  ADD COLUMN attendance_lower_bound INTEGER
    CHECK (attendance_lower_bound IS NULL OR attendance_lower_bound >= 0),
  ADD COLUMN attendance_upper_bound INTEGER
    CHECK (attendance_upper_bound IS NULL OR attendance_upper_bound >= 0),
  ADD COLUMN attendance_confidence NUMERIC(4, 3)
    CHECK (attendance_confidence IS NULL OR attendance_confidence BETWEEN 0 AND 1),
  ADD COLUMN attendance_provenance JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(attendance_provenance) = 'object'),
  ADD COLUMN date_certainty TEXT NOT NULL DEFAULT 'exact'
    CHECK (date_certainty IN ('exact', 'announced_window', 'estimated', 'conditional', 'unknown')),
  ADD COLUMN announced_at TIMESTAMPTZ,
  ADD COLUMN last_verified_at TIMESTAMPTZ,
  ADD COLUMN next_verification_at TIMESTAMPTZ,
  ADD CONSTRAINT market_events_attendance_range_check CHECK (
    attendance_upper_bound IS NULL
    OR attendance_lower_bound IS NULL
    OR attendance_upper_bound >= attendance_lower_bound
  ),
  ADD CONSTRAINT market_events_series_year_check CHECK (
    (series_id IS NULL AND occurrence_year IS NULL)
    OR (series_id IS NOT NULL AND occurrence_year IS NOT NULL)
  );

UPDATE public.market_events
SET
  event_type = category,
  last_verified_at = last_seen_at
WHERE event_type IS NULL;

ALTER TABLE public.market_events
  ALTER COLUMN event_type SET NOT NULL;

-- Existing provider adapters write category but predate event_type. Keep the
-- additive column synchronized unless a caller deliberately supplies a more
-- specific event_type.
CREATE OR REPLACE FUNCTION public.sync_market_event_type_from_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.event_type IS NULL
     OR (
       TG_OP = 'UPDATE'
       AND NEW.category IS DISTINCT FROM OLD.category
       AND NEW.event_type IS NOT DISTINCT FROM OLD.event_type
     ) THEN
    NEW.event_type := NEW.category;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_market_events_sync_event_type
  BEFORE INSERT OR UPDATE OF category, event_type ON public.market_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_market_event_type_from_category();

CREATE UNIQUE INDEX uq_market_events_series_occurrence
  ON public.market_events (series_id, occurrence_year, occurrence_key)
  WHERE series_id IS NOT NULL;

CREATE INDEX idx_market_events_verification_due
  ON public.market_events (next_verification_at, state)
  WHERE next_verification_at IS NOT NULL;

ALTER TABLE public.market_event_impacts
  ADD COLUMN audience_segments TEXT[] NOT NULL DEFAULT ARRAY['broad']::TEXT[]
    CHECK (audience_segments <@ ARRAY[
      'families', 'couples', 'friends_groups', 'business', 'students_alumni',
      'sports_fans', 'broad'
    ]::TEXT[]),
  ADD COLUMN attendance_lower_bound INTEGER
    CHECK (attendance_lower_bound IS NULL OR attendance_lower_bound >= 0),
  ADD COLUMN attendance_upper_bound INTEGER
    CHECK (attendance_upper_bound IS NULL OR attendance_upper_bound >= 0),
  ADD COLUMN attendance_confidence NUMERIC(4, 3)
    CHECK (attendance_confidence IS NULL OR attendance_confidence BETWEEN 0 AND 1),
  ADD COLUMN attendance_provenance JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(attendance_provenance) = 'object'),
  ADD COLUMN booking_window_open_days_prior SMALLINT
    CHECK (booking_window_open_days_prior IS NULL OR booking_window_open_days_prior >= 0),
  ADD COLUMN booking_window_peak_start_days_prior SMALLINT
    CHECK (booking_window_peak_start_days_prior IS NULL OR booking_window_peak_start_days_prior >= 0),
  ADD COLUMN booking_window_peak_end_days_prior SMALLINT
    CHECK (booking_window_peak_end_days_prior IS NULL OR booking_window_peak_end_days_prior >= 0),
  ADD COLUMN booking_window_confidence NUMERIC(4, 3)
    CHECK (booking_window_confidence IS NULL OR booking_window_confidence BETWEEN 0 AND 1),
  ADD COLUMN last_assessed_at TIMESTAMPTZ,
  ADD CONSTRAINT market_event_impacts_attendance_range_check CHECK (
    attendance_upper_bound IS NULL
    OR attendance_lower_bound IS NULL
    OR attendance_upper_bound >= attendance_lower_bound
  ),
  ADD CONSTRAINT market_event_impacts_booking_window_check CHECK (
    (
      booking_window_open_days_prior IS NULL
      AND booking_window_peak_start_days_prior IS NULL
      AND booking_window_peak_end_days_prior IS NULL
    )
    OR (
      booking_window_open_days_prior IS NOT NULL
      AND booking_window_peak_start_days_prior IS NOT NULL
      AND booking_window_peak_end_days_prior IS NOT NULL
      AND booking_window_open_days_prior >= booking_window_peak_start_days_prior
      AND booking_window_peak_start_days_prior >= booking_window_peak_end_days_prior
    )
  );

-- A conditional sports event can be monitored before its participant
-- qualifies. This lifecycle is evidence only and has no commercial action.
CREATE TABLE public.market_event_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL
    REFERENCES public.market_events(id) ON DELETE CASCADE,
  subject_key TEXT NOT NULL
    CHECK (subject_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  subject_type TEXT NOT NULL DEFAULT 'team'
    CHECK (subject_type IN ('team', 'participant', 'organizer', 'other')),
  subject_name TEXT NOT NULL CHECK (CHAR_LENGTH(subject_name) BETWEEN 2 AND 200),
  competition_name TEXT CHECK (
    competition_name IS NULL OR CHAR_LENGTH(competition_name) <= 200
  ),
  condition_type TEXT NOT NULL DEFAULT 'playoff_qualification'
    CHECK (condition_type IN ('playoff_qualification', 'advancement', 'selection', 'schedule_confirmation', 'other')),
  lifecycle_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (lifecycle_status IN ('pending', 'qualified', 'eliminated', 'confirmed', 'expired')),
  qualification_probability NUMERIC(5, 4)
    CHECK (qualification_probability IS NULL OR qualification_probability BETWEEN 0 AND 1),
  probability_provenance JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (JSONB_TYPEOF(probability_provenance) = 'object'),
  condition_description TEXT NOT NULL
    CHECK (CHAR_LENGTH(condition_description) BETWEEN 5 AND 2000),
  next_check_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, subject_key, condition_type),
  CHECK (
    lifecycle_status NOT IN ('qualified', 'eliminated', 'confirmed', 'expired')
    OR resolved_at IS NOT NULL
  )
);

CREATE INDEX idx_market_event_conditions_due
  ON public.market_event_conditions (next_check_at, lifecycle_status)
  WHERE lifecycle_status = 'pending';

-- ==========================================================
-- 6. Updated-at triggers and permission-based RLS
-- ==========================================================

CREATE TRIGGER trg_revenue_market_states_updated_at
  BEFORE UPDATE ON public.revenue_market_states
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_revenue_market_state_memberships_updated_at
  BEFORE UPDATE ON public.revenue_market_state_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_revenue_market_localities_updated_at
  BEFORE UPDATE ON public.revenue_market_localities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_revenue_market_proposals_updated_at
  BEFORE UPDATE ON public.revenue_market_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_revenue_market_proposal_listings_updated_at
  BEFORE UPDATE ON public.revenue_market_proposal_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_market_signal_source_catalog_updated_at
  BEFORE UPDATE ON public.market_signal_source_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_market_event_series_updated_at
  BEFORE UPDATE ON public.market_event_series
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_market_event_series_watches_updated_at
  BEFORE UPDATE ON public.market_event_series_watches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_market_event_conditions_updated_at
  BEFORE UPDATE ON public.market_event_conditions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.revenue_market_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_market_state_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_market_localities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_market_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_market_proposal_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_signal_source_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_event_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_event_series_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_event_conditions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Market Signals viewers can view states"
  ON public.revenue_market_states FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can create states"
  ON public.revenue_market_states FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update states"
  ON public.revenue_market_states FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

CREATE POLICY "Market Signals viewers can view market states"
  ON public.revenue_market_state_memberships FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can map market states"
  ON public.revenue_market_state_memberships FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update market states"
  ON public.revenue_market_state_memberships FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

CREATE POLICY "Market Signals viewers can view localities"
  ON public.revenue_market_localities FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can create localities"
  ON public.revenue_market_localities FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update localities"
  ON public.revenue_market_localities FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

CREATE POLICY "Market Signals viewers can view market proposals"
  ON public.revenue_market_proposals FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can create market proposals"
  ON public.revenue_market_proposals FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can review market proposals"
  ON public.revenue_market_proposals FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

CREATE POLICY "Market Signals viewers can view proposal listings"
  ON public.revenue_market_proposal_listings FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can suggest proposal listings"
  ON public.revenue_market_proposal_listings FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can review proposal listings"
  ON public.revenue_market_proposal_listings FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

CREATE POLICY "Market Signals viewers can view source catalog"
  ON public.market_signal_source_catalog FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can create source catalog entries"
  ON public.market_signal_source_catalog FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update source catalog"
  ON public.market_signal_source_catalog FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

CREATE POLICY "Market Signals viewers can view event series"
  ON public.market_event_series FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can create event series"
  ON public.market_event_series FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update event series"
  ON public.market_event_series FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

CREATE POLICY "Market Signals viewers can view event date watches"
  ON public.market_event_series_watches FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can create event date watches"
  ON public.market_event_series_watches FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update event date watches"
  ON public.market_event_series_watches FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

CREATE POLICY "Market Signals viewers can view event conditions"
  ON public.market_event_conditions FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));
CREATE POLICY "Market Signals creators can create event conditions"
  ON public.market_event_conditions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('market_signals', 'create')
    AND created_by = auth.uid()
  );
CREATE POLICY "Market Signals editors can update event conditions"
  ON public.market_event_conditions FOR UPDATE TO authenticated
  USING (public.has_permission('market_signals', 'edit'))
  WITH CHECK (
    public.has_permission('market_signals', 'edit')
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

COMMENT ON TABLE public.revenue_market_states IS
  'Canonical state or equivalent subdivision above each revenue market.';
COMMENT ON TABLE public.revenue_market_state_memberships IS
  'Cross-jurisdiction market coverage with exactly one primary anchor state and optional secondary states.';
COMMENT ON TABLE public.revenue_market_localities IS
  'Canonical cities and other localities contained by one revenue market.';
COMMENT ON COLUMN public.revenue_market_listings.relationship_type IS
  'One approved primary market is allowed per listing; other approved relationships are secondary influences.';
COMMENT ON COLUMN public.revenue_market_listings.locality_id IS
  'Optional canonical locality constrained to the same market as this listing membership.';
COMMENT ON TABLE public.revenue_market_proposals IS
  'Draft-only proposals for locations that do not match an existing governed market.';
COMMENT ON TABLE public.revenue_market_proposal_listings IS
  'Auditable listing candidates for unresolved market proposals; review decisions never create memberships automatically.';
COMMENT ON TABLE public.market_signal_source_catalog IS
  'Provider-level coverage, trust, cost, auth, and lifecycle metadata; credentials are never stored here.';
COMMENT ON TABLE public.market_event_series IS
  'Recurring event identity shared by dated market_events occurrences.';
COMMENT ON TABLE public.market_event_series_watches IS
  'Three-year publication watch queue for recurring event dates that are not yet known.';
COMMENT ON TABLE public.market_event_conditions IS
  'Evidence-only lifecycle for conditional events such as potential playoff dates; never a pricing action.';
