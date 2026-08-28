-- ============================================================
-- 086: Listing lifecycle dates, status history, monthly summary
--      permission, client PMS/Vrbo
--
-- Billing needs to know how many listings the month started and
-- ended with and what changed in between. `listings` only had a
-- status column: deactivation left no date, actor, or history,
-- and updated_at is clobbered hourly by the PriceLabs sync.
-- HostPricing invoices from actuales + altas + bajas per month,
-- so the counts get their own `monthly_summary` resource.
-- ============================================================

-- ==========================================================
-- 1. Lifecycle columns
-- ==========================================================
ALTER TABLE listings
  ADD COLUMN initial_setup_date        DATE,
  ADD COLUMN adjustment_confirmed_date DATE,
  ADD COLUMN deactivated_date          DATE;

ALTER TABLE clients
  ADD COLUMN pms_name TEXT,
  ADD COLUMN has_vrbo BOOLEAN NOT NULL DEFAULT FALSE;

-- ==========================================================
-- 2. Deactivation stamp
-- ==========================================================
-- In the DB rather than app code so every write path is covered:
-- the Settings toggle, the two client-cascade actions, dialog
-- edits, and any future admin-client write. The PriceLabs sync
-- never writes `status`, so the hourly sync cannot fire this.
CREATE OR REPLACE FUNCTION public.stamp_listing_deactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'inactive' AND OLD.status = 'active' AND NEW.deactivated_date IS NULL THEN
    NEW.deactivated_date := CURRENT_DATE;
  ELSIF NEW.status = 'active' AND OLD.status = 'inactive'
        AND NEW.deactivated_date IS NOT DISTINCT FROM OLD.deactivated_date THEN
    -- Reactivation clears the churn date (mirrors clients.ending_date), unless
    -- the same UPDATE set an explicit date.
    NEW.deactivated_date := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_listings_stamp_deactivation
  BEFORE UPDATE OF status ON listings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_listing_deactivation();

REVOKE EXECUTE ON FUNCTION public.stamp_listing_deactivation() FROM PUBLIC, anon, authenticated;

-- ==========================================================
-- 3. Status transition history
-- ==========================================================
CREATE TABLE listing_status_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL for admin-client / sync writes, where auth.uid() is null.
  changed_by  UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_listing_status_events_listing ON listing_status_events(listing_id, changed_at);
CREATE INDEX idx_listing_status_events_status  ON listing_status_events(to_status, changed_at);

-- SECURITY DEFINER for the same two reasons as record_lead_stage_event (043):
-- it must fire for admin-client writes, and it inserts into a table with no
-- INSERT policy.
CREATE OR REPLACE FUNCTION public.record_listing_status_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO listing_status_events (listing_id, from_status, to_status, changed_at, changed_by)
      VALUES (NEW.id, NULL, NEW.status, COALESCE(NEW.created_at, NOW()), auth.uid());
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO listing_status_events (listing_id, from_status, to_status, changed_at, changed_by)
      VALUES (NEW.id, OLD.status, NEW.status, NOW(), auth.uid());
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_listing_status_event_insert
  AFTER INSERT ON listings
  FOR EACH ROW EXECUTE FUNCTION public.record_listing_status_event();

CREATE TRIGGER trg_listing_status_event_update
  AFTER UPDATE OF status ON listings
  FOR EACH ROW EXECUTE FUNCTION public.record_listing_status_event();

-- EXECUTE is checked at CREATE TRIGGER time, not fire time; this only removes
-- the PostgREST /rpc/ endpoint.
REVOKE EXECUTE ON FUNCTION public.record_listing_status_event() FROM PUBLIC, anon, authenticated;

ALTER TABLE listing_status_events ENABLE ROW LEVEL SECURITY;

-- Mirror the SELECT arms on `listings` (038): hostpricing reads listings via
-- adjustments:view. No write policies — rows come only from the trigger.
CREATE POLICY "Authorized users can view listing status events"
  ON listing_status_events FOR SELECT TO authenticated
  USING (public.has_permission('listings', 'view') OR public.has_permission('adjustments', 'view'));

-- ==========================================================
-- 4. Backfill lifecycle dates (before the synthetic events, so
--    churned listings get a meaningful changed_at)
-- ==========================================================
-- P1: exact Stripe cancellation. canceled_at is epoch seconds.
UPDATE listings l
SET deactivated_date = to_timestamp((s.raw_json->>'canceled_at')::numeric)::date
FROM stripe_subscriptions s
WHERE l.stripe_subscription_id = s.id
  AND l.status = 'inactive'
  AND l.deactivated_date IS NULL
  AND s.raw_json->>'canceled_at' IS NOT NULL;

-- P2: client cascade churn date.
UPDATE listings l
SET deactivated_date = c.ending_date
FROM clients c
WHERE l.client_id = c.id
  AND l.status = 'inactive'
  AND l.deactivated_date IS NULL
  AND c.status = 'inactive'
  AND c.ending_date IS NOT NULL;

-- P3: the remainder (no Stripe sub, no client ending_date) stays NULL for
-- manual entry in Settings > Listings.

-- Setup dates from already-controlled setup adjustments (the only historical
-- source): resolved = when the setup was done, controlled = when verified.
UPDATE listings l
SET initial_setup_date        = COALESCE(l.initial_setup_date, a.resolved_at::date),
    adjustment_confirmed_date = COALESCE(l.adjustment_confirmed_date, a.controlled_at::date)
FROM adjustments a
WHERE a.listing_id = l.id
  AND a.type = 'setup'
  AND a.status = 'controlled';

-- One synthetic event per existing listing at its current status. Intermediate
-- transitions are unrecoverable; don't use updated_at (PriceLabs sync clobbers it).
INSERT INTO listing_status_events (listing_id, from_status, to_status, changed_at, changed_by)
SELECT id, NULL, status, COALESCE(deactivated_date::timestamptz, created_at, NOW()), NULL
FROM listings
WHERE NOT EXISTS (SELECT 1 FROM listing_status_events e WHERE e.listing_id = listings.id);

-- ==========================================================
-- 5. monthly_summary permission resource
-- ==========================================================
-- Settings > Roles pre-seeds combos as FALSE, so intended grants use DO UPDATE.
-- super_admin needs no rows: has_permission short-circuits.
INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('admin', 'monthly_summary', 'view',    TRUE),
  ('admin', 'monthly_summary', 'create',  FALSE),
  ('admin', 'monthly_summary', 'edit',    FALSE),
  ('admin', 'monthly_summary', 'delete',  FALSE),
  ('admin', 'monthly_summary', 'publish', FALSE),
  ('admin', 'monthly_summary', 'control', FALSE)
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- hostpricing invoices from this summary: view only.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT 'hostpricing', 'monthly_summary', a.action, (a.action = 'view')
FROM (VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')) AS a(action)
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Other external roles: explicit deny.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'monthly_summary', a.action, FALSE
FROM roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')) AS a(action)
WHERE r.name IN ('contractor', 'marketing')
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Any remaining custom roles: complete the grid without touching live grants (072).
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'monthly_summary', a.action, FALSE
FROM roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')) AS a(action)
WHERE r.name <> 'super_admin'
ON CONFLICT (role_name, resource, action) DO NOTHING;
