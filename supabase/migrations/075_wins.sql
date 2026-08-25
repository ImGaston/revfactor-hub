-- Migration 075: Wins dashboard (/wins)
--
-- Detects listings with positive performance by crossing two PriceLabs-derived
-- sources and persists an auditable snapshot of every detection run:
--   * booking pickup over consecutive 31-day windows, by BOOKED DATE, derived
--     from the pricelabs_reservations_cache matview (migrations 054-056);
--   * period revenue TY vs STLY plus market context, read from report_metrics
--     (migrations 035-036).
--
-- Design notes that the app depends on:
--   * Every run freezes its rules (rules_snapshot) and its evidence
--     (win_candidates.evidence) so a later recompute can never rewrite the
--     figures a teammate already copied into a message.
--   * win_reviews hangs off the LISTING, not the candidate, so operational
--     state survives recomputes.
--   * win_message_drafts and win_events are append-only: no UPDATE/DELETE
--     policy is defined, which denies those operations by default.
--
-- SEMANTIC RULE, do not weaken:
--   'copied' and 'assembly_opened' are user-intent events inside the Hub.
--   NEITHER means the message was sent. The Hub cannot observe Assembly.
--   Only 'marked_shared' records that a human asserts they shared it, and it
--   is only ever written by an explicit, clearly-labelled manual action.
--   This feature never writes to Assembly.

-- ==========================================================
-- 1. Detection runs
-- ==========================================================
CREATE TABLE win_detection_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of_date           DATE NOT NULL,
  period_start         DATE NOT NULL,
  period_end           DATE NOT NULL,
  rules_version        TEXT NOT NULL,
  rules_snapshot       JSONB NOT NULL,
  report_run_id        UUID REFERENCES report_runs(id) ON DELETE SET NULL,
  reservations_fetched_at TIMESTAMPTZ,
  reservations_max_booked_date DATE,
  status               TEXT NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'completed', 'failed')),
  candidate_count      INTEGER NOT NULL DEFAULT 0,
  currency             TEXT,
  error_reason         TEXT,
  triggered_by         TEXT NOT NULL DEFAULT 'manual'
                       CHECK (triggered_by IN ('manual', 'cron')),
  triggered_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ,
  -- Idempotency: re-running the same parameters replaces, never duplicates.
  UNIQUE (as_of_date, period_start, period_end, rules_version)
);

-- ==========================================================
-- 2. Candidates (grain: one listing x one run)
-- ==========================================================
CREATE TABLE win_candidates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               UUID NOT NULL REFERENCES win_detection_runs(id) ON DELETE CASCADE,
  hub_listing_id       UUID REFERENCES listings(id) ON DELETE SET NULL,
  pricelabs_listing_id TEXT NOT NULL,
  client_id            UUID REFERENCES clients(id) ON DELETE SET NULL,
  -- Snapshots: listings get renamed and reassigned; evidence must not drift.
  listing_name_snapshot TEXT NOT NULL,
  client_name_snapshot  TEXT,
  category             TEXT NOT NULL CHECK (category IN (
                         'double_win', 'yoy_positive_steady', 'market_compass_candidate',
                         'conflicting_signal', 'insufficient_data', 'no_win')),
  confidence           TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'none')),
  pickup_trend         TEXT NOT NULL CHECK (pickup_trend IN (
                         'up', 'held', 'down', 'up_from_zero', 'no_pickup', 'insufficient_data')),
  reason_codes         TEXT[] NOT NULL DEFAULT '{}',
  is_blocked           BOOLEAN NOT NULL DEFAULT FALSE,
  priority_rank        INTEGER NOT NULL,
  evidence             JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Grain is one HUB listing per run, not one PriceLabs listing: the
  -- reservations matview fans a single PriceLabs listing_id across several hub
  -- listings (3 of 239 today), so keying on pricelabs_listing_id collides.
  -- hub_listing_id is what review state, messages and the client all key on.
  UNIQUE (run_id, hub_listing_id)
);

-- ==========================================================
-- 3. Review state (grain: one listing -- survives recomputes)
-- ==========================================================
CREATE TABLE win_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_listing_id    UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  state             TEXT NOT NULL DEFAULT 'new'
                    CHECK (state IN ('new', 'in_review', 'shared_manually', 'dismissed', 'snoozed')),
  dismiss_reason    TEXT,
  snoozed_until     DATE,
  last_candidate_id UUID REFERENCES win_candidates(id) ON DELETE SET NULL,
  updated_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Optimistic concurrency: two reviewers on the same win must not clobber.
  version           INTEGER NOT NULL DEFAULT 1,
  UNIQUE (hub_listing_id)
);

-- ==========================================================
-- 4. Message drafts (append-only)
-- ==========================================================
CREATE TABLE win_message_drafts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      UUID REFERENCES win_candidates(id) ON DELETE SET NULL,
  client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
  scope             TEXT NOT NULL DEFAULT 'listing' CHECK (scope IN ('listing', 'client')),
  template_key      TEXT NOT NULL,
  template_version  TEXT NOT NULL,
  generated_body    TEXT NOT NULL,
  edited_body       TEXT,
  -- Frozen copy of the figures used at generation time. Editing the body must
  -- never touch this: it is what makes an already-copied message auditable.
  evidence_snapshot JSONB NOT NULL,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- 5. Events (append-only audit)
-- ==========================================================
CREATE TABLE win_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES win_candidates(id) ON DELETE SET NULL,
  draft_id     UUID REFERENCES win_message_drafts(id) ON DELETE SET NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN (
                 'viewed', 'message_generated', 'message_edited', 'copied',
                 'assembly_opened', 'marked_shared', 'dismissed', 'reopened')),
  actor_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Never store message bodies, emails, phone numbers or private URLs here.
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================================
-- 6. Indexes
-- ==========================================================
CREATE INDEX idx_win_candidates_run_rank ON win_candidates(run_id, priority_rank);
CREATE INDEX idx_win_candidates_run_cat  ON win_candidates(run_id, category, confidence);
CREATE INDEX idx_win_candidates_client   ON win_candidates(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_win_candidates_listing  ON win_candidates(hub_listing_id);
CREATE INDEX idx_win_runs_completed      ON win_detection_runs(completed_at DESC) WHERE status = 'completed';
CREATE INDEX idx_win_events_candidate    ON win_events(candidate_id, created_at DESC);
CREATE INDEX idx_win_drafts_candidate    ON win_message_drafts(candidate_id, created_at DESC);

CREATE TRIGGER trg_win_reviews_set_updated_at
  BEFORE UPDATE ON win_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================
-- 7. RLS -- permission-based, never USING (true)
-- ==========================================================
ALTER TABLE win_detection_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE win_candidates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE win_reviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE win_message_drafts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE win_events          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view win_detection_runs"
  ON win_detection_runs FOR SELECT TO authenticated
  USING (public.has_permission('wins', 'view'));
CREATE POLICY "Authorized users can insert win_detection_runs"
  ON win_detection_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('wins', 'edit'));
CREATE POLICY "Authorized users can update win_detection_runs"
  ON win_detection_runs FOR UPDATE TO authenticated
  USING      (public.has_permission('wins', 'edit'))
  WITH CHECK (public.has_permission('wins', 'edit'));
CREATE POLICY "Authorized users can delete win_detection_runs"
  ON win_detection_runs FOR DELETE TO authenticated
  USING (public.has_permission('wins', 'delete'));

CREATE POLICY "Authorized users can view win_candidates"
  ON win_candidates FOR SELECT TO authenticated
  USING (public.has_permission('wins', 'view'));
CREATE POLICY "Authorized users can insert win_candidates"
  ON win_candidates FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('wins', 'edit'));
-- Candidates are recomputable derived data, so a rerun updates them in place.
-- (Drafts and events stay append-only -- they are the audit trail.) Without
-- this the upsert in the detection run fails the USING check on conflict.
CREATE POLICY "Authorized users can update win_candidates"
  ON win_candidates FOR UPDATE TO authenticated
  USING      (public.has_permission('wins', 'edit'))
  WITH CHECK (public.has_permission('wins', 'edit'));
CREATE POLICY "Authorized users can delete win_candidates"
  ON win_candidates FOR DELETE TO authenticated
  USING (public.has_permission('wins', 'edit'));

CREATE POLICY "Authorized users can view win_reviews"
  ON win_reviews FOR SELECT TO authenticated
  USING (public.has_permission('wins', 'view'));
CREATE POLICY "Authorized users can insert win_reviews"
  ON win_reviews FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('wins', 'edit'));
CREATE POLICY "Authorized users can update win_reviews"
  ON win_reviews FOR UPDATE TO authenticated
  USING      (public.has_permission('wins', 'edit'))
  WITH CHECK (public.has_permission('wins', 'edit'));

-- Append-only: SELECT + INSERT only. No UPDATE/DELETE policy is defined, so
-- Postgres denies those by default. That is the mechanism -- do not add one.
CREATE POLICY "Authorized users can view win_message_drafts"
  ON win_message_drafts FOR SELECT TO authenticated
  USING (public.has_permission('wins', 'view'));
CREATE POLICY "Authorized users can insert win_message_drafts"
  ON win_message_drafts FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('wins', 'edit') AND created_by = auth.uid());

CREATE POLICY "Authorized users can view win_events"
  ON win_events FOR SELECT TO authenticated
  USING (public.has_permission('wins', 'view'));
CREATE POLICY "Authorized users can insert win_events"
  ON win_events FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('wins', 'view') AND actor_id = auth.uid());

-- ==========================================================
-- 8. Pickup aggregation RPC
--
-- SECURITY INVOKER on purpose. pricelabs_reservations_cache is a MATERIALIZED
-- VIEW, so it cannot carry RLS -- migration 054 grants SELECT to authenticated
-- and calls the grant "the boundary". An invoker function can therefore read
-- it, and the explicit has_permission() check below adds the gate the matview
-- itself cannot have. A SECURITY DEFINER function would escalate privilege for
-- no benefit.
--
-- Aggregating here rather than in Node is not an optimisation detail: this
-- project caps PostgREST at db-max-rows = 1000, and the window spans ~93 days
-- of reservations across the whole portfolio.
-- ==========================================================
CREATE OR REPLACE FUNCTION public.wins_pickup_windows(p_as_of DATE)
RETURNS TABLE (
  pricelabs_listing_id TEXT,
  hub_listing_id       UUID,
  client_id            UUID,
  pickup_w1            NUMERIC,
  pickup_w2            NUMERIC,
  pickup_w3            NUMERIC,
  reservations_w2      INTEGER,
  reservations_w3      INTEGER,
  median_lead_w3       NUMERIC,
  currencies           TEXT[],
  has_fanout           BOOLEAN,
  has_negative_revenue BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- IS NOT TRUE, not NOT(...): has_permission is
  -- `EXISTS(...) OR get_my_role() = 'super_admin'`, which evaluates to NULL
  -- (not FALSE) for a session with no profile row, because `false OR NULL` is
  -- NULL. `IF NOT NULL THEN` never enters its branch, so a plain NOT would let
  -- an unidentified session straight through. The RLS policies are unaffected
  -- (NULL is not TRUE, so rows are filtered), but this gate is not.
  IF public.has_permission('wins', 'view') IS NOT TRUE THEN
    RAISE EXCEPTION 'insufficient_privilege: wins:view required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH fanout AS (
    -- Migration 054 disambiguates ~150 reservations whose listings join fans
    -- one reservation_key into several hub listings. Per-listing sums stay
    -- correct (one row each), but client/portfolio totals would double-count,
    -- so the affected listings are flagged for the caller to exclude.
    SELECT r.reservation_key
    FROM public.pricelabs_reservations_cache r
    GROUP BY r.reservation_key
    HAVING count(*) > 1
  ),
  src AS (
    SELECT
      r.listing_id,
      r.hub_listing_id,
      r.client_id,
      r.reservation_key,
      r.booked_date,
      r.rental_revenue,
      r.currency,
      GREATEST(r.booking_window_days, 0) AS lead_days
    FROM public.pricelabs_reservations_cache r
    WHERE r.booking_status = 'booked'
      AND r.hub_listing_id IS NOT NULL
      AND r.booked_date IS NOT NULL
      -- 1970-01-01 is the upstream missing-value sentinel, not a real date.
      AND r.booked_date <> DATE '1970-01-01'
      AND r.booked_date >= p_as_of - 92
      AND r.booked_date <= p_as_of
  )
  SELECT
    s.listing_id,
    s.hub_listing_id,
    s.client_id,
    COALESCE(sum(s.rental_revenue) FILTER (
      WHERE s.booked_date >= p_as_of - 92 AND s.booked_date <= p_as_of - 62), 0)::NUMERIC,
    COALESCE(sum(s.rental_revenue) FILTER (
      WHERE s.booked_date >= p_as_of - 61 AND s.booked_date <= p_as_of - 31), 0)::NUMERIC,
    COALESCE(sum(s.rental_revenue) FILTER (
      WHERE s.booked_date >= p_as_of - 30 AND s.booked_date <= p_as_of), 0)::NUMERIC,
    count(*) FILTER (
      WHERE s.booked_date >= p_as_of - 61 AND s.booked_date <= p_as_of - 31)::INTEGER,
    count(*) FILTER (
      WHERE s.booked_date >= p_as_of - 30 AND s.booked_date <= p_as_of)::INTEGER,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY s.lead_days) FILTER (
      WHERE s.booked_date >= p_as_of - 30 AND s.booked_date <= p_as_of)::NUMERIC,
    array_remove(array_agg(DISTINCT s.currency), NULL),
    bool_or(s.reservation_key IN (SELECT f.reservation_key FROM fanout f)),
    bool_or(s.rental_revenue < 0)
  FROM src s
  GROUP BY s.listing_id, s.hub_listing_id, s.client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wins_pickup_windows(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wins_pickup_windows(DATE) TO authenticated;

-- ==========================================================
-- 9. Permission seeds
--
-- The `wins` resource doubles as the rollout flag: every grant starts FALSE
-- and is switched on per role from Settings > Roles, with no deploy.
-- super_admin needs no rows -- has_permission short-circuits on it.
--
-- DO UPDATE, never DO NOTHING: createRole() pre-seeds every resource x action
-- combination as FALSE, so DO NOTHING would silently no-op on a live database.
-- ==========================================================
INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('admin', 'wins', 'view',    FALSE),
  ('admin', 'wins', 'create',  FALSE),
  ('admin', 'wins', 'edit',    FALSE),
  ('admin', 'wins', 'delete',  FALSE),
  ('admin', 'wins', 'publish', FALSE),
  ('admin', 'wins', 'control', FALSE)
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- External roles: explicit deny. Wins exposes client performance and the
-- Assembly deep link, neither of which belongs outside the team.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'wins', a.action, FALSE
FROM roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')) AS a(action)
WHERE r.name IN ('contractor', 'marketing', 'hostpricing')
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Backfill any other role so Settings > Roles renders a complete grid.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'wins', a.action, (r.name = 'super_admin')
FROM roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')) AS a(action)
ON CONFLICT (role_name, resource, action) DO NOTHING;
