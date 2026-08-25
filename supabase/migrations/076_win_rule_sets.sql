-- Migration 076: Editable, versioned Wins detection rules
--
-- Migration 075 froze the thresholds in a typed constant (WINS_RULES_V1) so
-- that a detection run's evidence stayed reproducible. Making them editable
-- without versioning would break exactly that: a message reviewed under one
-- set of thresholds could no longer be explained by the rules in force later.
--
-- So rule sets are IMMUTABLE ROWS, not mutable settings. Editing publishes a
-- new version and points `is_active` at it; the previous version stays on
-- record. win_detection_runs already stores `rules_version` and a full
-- `rules_snapshot`, so every historical run remains explainable by the exact
-- numbers that produced it.

CREATE TABLE win_rule_sets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version                 INTEGER NOT NULL UNIQUE,
  -- Why this version exists. Shown next to the run that used it.
  note                    TEXT,

  -- Pickup trend cuts, as fractions (0.15 = 15%).
  pickup_up_threshold     NUMERIC(6,4) NOT NULL,
  pickup_down_threshold   NUMERIC(6,4) NOT NULL,
  pickup_window_days      INTEGER NOT NULL,

  -- Below this STLY base a percentage is meaningless and is suppressed.
  min_stly_revenue        NUMERIC(12,2) NOT NULL,
  -- Above this magnitude (fraction; 3 = 300%) a percentage is suppressed.
  extreme_yoy_pct         NUMERIC(6,2) NOT NULL,

  -- Market Compass banding.
  revpar_index_win_floor  NUMERIC(6,2) NOT NULL,
  revpar_index_qa_ceiling NUMERIC(6,2) NOT NULL,

  -- Freshness and the occupancy-up/ADR-down watch signal.
  max_staleness_days      INTEGER NOT NULL,
  occ_up_pp_threshold     NUMERIC(6,2) NOT NULL,
  adr_down_pct_threshold  NUMERIC(6,4) NOT NULL,

  is_active               BOOLEAN NOT NULL DEFAULT FALSE,
  created_by              UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Guardrails on the guardrails: a saved rule set must be internally coherent
  -- or detection would produce nonsense with no obvious cause.
  CONSTRAINT win_rules_pickup_order CHECK (pickup_up_threshold > pickup_down_threshold),
  CONSTRAINT win_rules_pickup_up_range CHECK (pickup_up_threshold BETWEEN 0 AND 5),
  CONSTRAINT win_rules_pickup_down_range CHECK (pickup_down_threshold BETWEEN -1 AND 0),
  CONSTRAINT win_rules_window CHECK (pickup_window_days BETWEEN 7 AND 90),
  CONSTRAINT win_rules_stly_floor CHECK (min_stly_revenue >= 0),
  CONSTRAINT win_rules_extreme CHECK (extreme_yoy_pct > 0),
  CONSTRAINT win_rules_revpar_order CHECK (revpar_index_qa_ceiling > revpar_index_win_floor),
  CONSTRAINT win_rules_revpar_floor CHECK (revpar_index_win_floor BETWEEN 50 AND 200),
  CONSTRAINT win_rules_staleness CHECK (max_staleness_days BETWEEN 0 AND 30),
  CONSTRAINT win_rules_occ_pp CHECK (occ_up_pp_threshold >= 0),
  CONSTRAINT win_rules_adr_pct CHECK (adr_down_pct_threshold <= 0)
);

-- Exactly one active rule set at a time.
CREATE UNIQUE INDEX win_rule_sets_one_active_idx
  ON win_rule_sets (is_active) WHERE is_active;

CREATE INDEX win_rule_sets_version_idx ON win_rule_sets (version DESC);

-- ==========================================================
-- Immutability: a published rule set is history
--
-- Only `is_active` may change after insert. Without this, editing a row in
-- place would silently rewrite the meaning of every past run that cites its
-- version -- the precise failure this table exists to prevent.
-- ==========================================================
CREATE OR REPLACE FUNCTION public.enforce_win_rule_set_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.version, NEW.note, NEW.pickup_up_threshold, NEW.pickup_down_threshold,
      NEW.pickup_window_days, NEW.min_stly_revenue, NEW.extreme_yoy_pct,
      NEW.revpar_index_win_floor, NEW.revpar_index_qa_ceiling,
      NEW.max_staleness_days, NEW.occ_up_pp_threshold, NEW.adr_down_pct_threshold,
      NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.version, OLD.note, OLD.pickup_up_threshold, OLD.pickup_down_threshold,
      OLD.pickup_window_days, OLD.min_stly_revenue, OLD.extreme_yoy_pct,
      OLD.revpar_index_win_floor, OLD.revpar_index_qa_ceiling,
      OLD.max_staleness_days, OLD.occ_up_pp_threshold, OLD.adr_down_pct_threshold,
      OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Win rule sets are immutable. Publish a new version instead.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER win_rule_sets_immutable
  BEFORE UPDATE ON win_rule_sets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_win_rule_set_immutable();

-- ==========================================================
-- Activation helper
--
-- Deactivating the old row and activating the new one must happen together, or
-- the partial unique index rejects the second statement and detection is left
-- with no active rule set. SECURITY INVOKER: RLS still applies to the caller.
-- ==========================================================
CREATE OR REPLACE FUNCTION public.activate_win_rule_set(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- IS NOT TRUE, never a bare NOT: has_permission returns NULL for a session
  -- with no profile row, and `IF NOT NULL THEN` skips its branch. See
  -- conventions.md.
  IF public.has_permission('wins', 'control') IS NOT TRUE THEN
    RAISE EXCEPTION 'insufficient_privilege: wins:control required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE win_rule_sets SET is_active = FALSE WHERE is_active AND id <> p_id;
  UPDATE win_rule_sets SET is_active = TRUE WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_win_rule_set(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_win_rule_set(UUID) TO authenticated;

-- ==========================================================
-- RLS
--
-- Reading the thresholds rides on wins:view -- the detail drawer explains them.
-- Publishing a new version is a wins:control action: it changes what the whole
-- team sees as communicable, and therefore what reaches clients.
-- No DELETE policy: published versions are history.
-- ==========================================================
ALTER TABLE win_rule_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view win_rule_sets"
  ON win_rule_sets FOR SELECT TO authenticated
  USING (public.has_permission('wins', 'view'));

CREATE POLICY "Authorized users can insert win_rule_sets"
  ON win_rule_sets FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('wins', 'control') AND created_by = auth.uid());

CREATE POLICY "Authorized users can update win_rule_sets"
  ON win_rule_sets FOR UPDATE TO authenticated
  USING      (public.has_permission('wins', 'control'))
  WITH CHECK (public.has_permission('wins', 'control'));

-- ==========================================================
-- Seed version 1 -- the constants migration 075 shipped with, verified against
-- the reference workbook (lowest Up +15.18%, highest Down -15.46%).
-- ==========================================================
INSERT INTO win_rule_sets (
  version, note,
  pickup_up_threshold, pickup_down_threshold, pickup_window_days,
  min_stly_revenue, extreme_yoy_pct,
  revpar_index_win_floor, revpar_index_qa_ceiling,
  max_staleness_days, occ_up_pp_threshold, adr_down_pct_threshold,
  is_active
) VALUES (
  1, 'Initial rules, reconciled against the RevFactor Wins workbook.',
  0.15, -0.15, 31,
  5000, 3,
  105, 250,
  2, 3, -0.10,
  TRUE
) ON CONFLICT (version) DO NOTHING;
