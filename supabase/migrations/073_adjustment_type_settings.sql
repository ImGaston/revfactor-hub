-- Migration 073: Per-group visibility for adjustment types
--
-- Which adjustment types each creator group (internal team vs HostPricing)
-- can pick in the new-ticket dialog, managed from Settings > Adjustment
-- Types instead of the hardcoded INTERNAL_ONLY_TYPES list. UI-level filter
-- only — the server keeps accepting any valid type (same stance as before).
-- A type missing a row is treated as enabled for both groups (code default).

CREATE TABLE adjustment_type_settings (
  type TEXT PRIMARY KEY,
  internal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  hostpricing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_adjustment_type_settings_set_updated_at
  BEFORE UPDATE ON adjustment_type_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE adjustment_type_settings ENABLE ROW LEVEL SECURITY;

-- Read: anyone who can open the Adjustments dialog, plus settings managers
-- (a settings:edit user is not guaranteed to hold adjustments:view).
CREATE POLICY "Adjustment viewers can read type settings"
  ON adjustment_type_settings FOR SELECT TO authenticated
  USING (
    public.has_permission('adjustments', 'view')
    OR public.has_permission('settings', 'edit')
  );

-- Writes: Settings managers only.
CREATE POLICY "Settings editors can insert type settings"
  ON adjustment_type_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('settings', 'edit'));

CREATE POLICY "Settings editors can update type settings"
  ON adjustment_type_settings FOR UPDATE TO authenticated
  USING (public.has_permission('settings', 'edit'))
  WITH CHECK (public.has_permission('settings', 'edit'));

CREATE POLICY "Settings editors can delete type settings"
  ON adjustment_type_settings FOR DELETE TO authenticated
  USING (public.has_permission('settings', 'edit'));

-- Seed current behavior: every type visible to the internal team;
-- HostPricing sees everything except the internal-only `setup`.
INSERT INTO adjustment_type_settings (type, internal_enabled, hostpricing_enabled) VALUES
  ('setup',               TRUE, FALSE),
  ('min_stay',            TRUE, TRUE),
  ('price',               TRUE, TRUE),
  ('min_price',           TRUE, TRUE),
  ('max_price',           TRUE, TRUE),
  ('target_payout',       TRUE, TRUE),
  ('checkin_checkout',    TRUE, TRUE),
  ('discount',            TRUE, TRUE),
  ('markup_fees',         TRUE, TRUE),
  ('availability',        TRUE, TRUE),
  ('review',              TRUE, TRUE),
  ('recommendation',      TRUE, TRUE),
  ('visibility',          TRUE, TRUE),
  ('blocked_dates',       TRUE, TRUE),
  ('pricing_flexibility', TRUE, TRUE),
  ('other',               TRUE, TRUE);
