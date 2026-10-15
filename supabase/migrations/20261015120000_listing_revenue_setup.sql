-- Listing revenue setup: the decided pricing/channel settings per listing and
-- an append-only history of every change. Design: docs/ontology/listing-revenue-setup.md.
--
-- Objects:
--   listing_setting_change_sets  one approved batch (e.g. "cleaning fee + Vrbo 20%")
--   listing_settings             the current intended value per (listing, key, channel, date range)
--   listing_setting_changes      append-only: every Propose/Approve/Apply/Verify/Drift/Revert
--
-- The setting-key catalog lives in code (lib/listing-settings.ts, versioned),
-- like the listing-review checklist, so keys are app-validated, not CHECKed here.
-- Reads: listings:view. No write policies: rows are written server-side only
-- (actions check hasPermission in code). History is never updated, and a
-- listing with setup history can't be hard-deleted (RESTRICT), so evidence is
-- never cascade-deleted (same rule as the RM event ledger).

CREATE TABLE IF NOT EXISTS listing_setting_change_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'applied', 'verified', 'rejected')),
  plan_ref TEXT,
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by_label TEXT,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_setting_change_sets_listing
  ON listing_setting_change_sets(listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS listing_setting_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  change_set_id UUID REFERENCES listing_setting_change_sets(id) ON DELETE RESTRICT,
  setting_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'all'
    CHECK (channel IN ('all', 'airbnb', 'booking', 'vrbo', 'direct', 'expedia')),
  date_from DATE,
  date_to DATE,
  action TEXT NOT NULL CHECK (action IN (
    'ProposeSettingChange', 'ApproveSettingChange', 'ApplySetting',
    'VerifySetting', 'FlagDrift', 'RevertSetting', 'RecordObservation'
  )),
  old_value JSONB,
  new_value JSONB,
  system TEXT NOT NULL,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  adjustment_id UUID REFERENCES adjustments(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'agent', 'owner', 'system')),
  actor_id TEXT,
  approved_by_label TEXT,
  -- When it happened in the external system (backfills carry the original time).
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_to IS NULL OR date_from IS NULL OR date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_listing_setting_changes_listing
  ON listing_setting_changes(listing_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_setting_changes_change_set
  ON listing_setting_changes(change_set_id) WHERE change_set_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listing_setting_changes_adjustment
  ON listing_setting_changes(adjustment_id) WHERE adjustment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS listing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'all'
    CHECK (channel IN ('all', 'airbnb', 'booking', 'vrbo', 'direct', 'expedia')),
  date_from DATE,
  date_to DATE,
  value JSONB NOT NULL,
  system TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied'
    CHECK (status IN ('planned', 'applied', 'verified', 'drift', 'retired')),
  last_change_id UUID REFERENCES listing_setting_changes(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_to IS NULL OR date_from IS NULL OR date_to >= date_from)
);

-- One current row per scope; NULL dates mean "no date range".
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_settings_scope
  ON listing_settings (
    listing_id, setting_key, channel,
    COALESCE(date_from, '0001-01-01'::date), COALESCE(date_to, '9999-12-31'::date)
  );

-- History rows are immutable.
CREATE OR REPLACE FUNCTION public.listing_setting_changes_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'listing_setting_changes is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_listing_setting_changes_immutable ON listing_setting_changes;
CREATE TRIGGER trg_listing_setting_changes_immutable
  BEFORE UPDATE ON listing_setting_changes
  FOR EACH ROW EXECUTE FUNCTION public.listing_setting_changes_immutable();

ALTER TABLE listing_setting_change_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_setting_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Listings users can view setting change sets"
  ON listing_setting_change_sets FOR SELECT TO authenticated
  USING (public.has_permission('listings', 'view'));
CREATE POLICY "Listings users can view setting changes"
  ON listing_setting_changes FOR SELECT TO authenticated
  USING (public.has_permission('listings', 'view'));
CREATE POLICY "Listings users can view listing settings"
  ON listing_settings FOR SELECT TO authenticated
  USING (public.has_permission('listings', 'view'));
-- No INSERT/UPDATE/DELETE policies: rows are written server-side only.

REVOKE ALL ON listing_setting_change_sets, listing_setting_changes, listing_settings FROM anon;
REVOKE ALL ON FUNCTION public.listing_setting_changes_immutable() FROM PUBLIC, anon, authenticated;
