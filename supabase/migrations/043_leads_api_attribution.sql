-- ============================================================
-- 043: Leads Read API — attribution, stage history, api_keys
--
-- Marketing (external, `marketing` role from 041) needs to tie
-- lead source -> booked call -> closed deal. None of that data exists today:
-- `lead_source` is one free-text column, there is no stage history, and no
-- conversion timestamp. This migration captures all three, and adds the
-- `api_keys` table backing GET /api/v1/leads.
-- ============================================================

-- ==========================================================
-- 1. Attribution columns on leads
-- ==========================================================
-- Flat columns for the fixed UTM vocabulary (indexable, typed, part of the
-- published API contract), plus a jsonb catch-all so marketing can add a
-- tracking param without a migration.
ALTER TABLE leads
  ADD COLUMN utm_source   TEXT,
  ADD COLUMN utm_medium   TEXT,
  ADD COLUMN utm_campaign TEXT,
  ADD COLUMN utm_content  TEXT,
  ADD COLUMN utm_term     TEXT,
  ADD COLUMN gclid        TEXT,
  ADD COLUMN fbclid       TEXT,
  ADD COLUMN referrer     TEXT,
  ADD COLUMN landing_page TEXT,
  ADD COLUMN attribution_extra JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX idx_leads_utm_source   ON leads(utm_source);
CREATE INDEX idx_leads_utm_campaign ON leads(utm_campaign);

-- ==========================================================
-- 2. converted_at — the canonical "closed deal" timestamp
-- ==========================================================
-- Won = assembly_client_id IS NOT NULL, not stage = 'retainer_paid' (the stage
-- keeps advancing to 'planning', so a won lead rarely sits there) and not
-- is_completed (that flag is kanban housekeeping). assembly_client_id is
-- written by exactly one deliberate business action, createAssemblyClientForLead,
-- it is monotonic, and it corresponds to a real row in `clients`.
ALTER TABLE leads ADD COLUMN converted_at TIMESTAMPTZ;

-- Approximate backfill: no historical timestamp exists for already-converted leads.
UPDATE leads SET converted_at = updated_at
  WHERE assembly_client_id IS NOT NULL AND converted_at IS NULL;

-- ==========================================================
-- 3. Stage transition history
-- ==========================================================
CREATE TABLE lead_stage_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage   TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL for webhook / cron / admin-client writes, where auth.uid() is null.
  changed_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_lead_stage_events_lead     ON lead_stage_events(lead_id, changed_at);
CREATE INDEX idx_lead_stage_events_to_stage ON lead_stage_events(to_stage, changed_at);

-- SECURITY DEFINER for two reasons, both required: it fires for admin-client
-- writes (webhooks, cron, the Assembly conversion) which is the whole point,
-- and it inserts into a table that has no INSERT policy.
CREATE OR REPLACE FUNCTION public.record_lead_stage_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO lead_stage_events (lead_id, from_stage, to_stage, changed_at, changed_by)
      VALUES (NEW.id, NULL, NEW.stage, COALESCE(NEW.created_at, NOW()), auth.uid());
  ELSIF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO lead_stage_events (lead_id, from_stage, to_stage, changed_at, changed_by)
      VALUES (NEW.id, OLD.stage, NEW.stage, NOW(), auth.uid());
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_lead_stage_event_insert
  AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION public.record_lead_stage_event();

CREATE TRIGGER trg_lead_stage_event_update
  AFTER UPDATE OF stage ON leads
  FOR EACH ROW EXECUTE FUNCTION public.record_lead_stage_event();

-- PostgREST exposes every public function as an RPC. Postgres checks EXECUTE at
-- CREATE TRIGGER time, not at fire time, so revoking it does not stop the
-- triggers above — it only removes /rest/v1/rpc/record_lead_stage_event.
REVOKE EXECUTE ON FUNCTION public.record_lead_stage_event() FROM PUBLIC, anon, authenticated;

ALTER TABLE lead_stage_events ENABLE ROW LEVEL SECURITY;

-- 038 forbids USING(true): mirror the SELECT gate on `leads`. No write policies —
-- rows are only ever written by the SECURITY DEFINER trigger above.
CREATE POLICY "Authorized users can view lead stage events"
  ON lead_stage_events FOR SELECT TO authenticated
  USING (public.has_permission('pipeline', 'view'));

-- Backfill one synthetic event per existing lead. Intermediate transitions are
-- unrecoverable, so historical leads carry a single event at their current stage:
-- booked_call_at / retainer_paid_at are approximate before this migration.
INSERT INTO lead_stage_events (lead_id, from_stage, to_stage, changed_at, changed_by)
SELECT id, NULL, stage, COALESCE(updated_at, created_at, NOW()), NULL
FROM leads
WHERE NOT EXISTS (SELECT 1 FROM lead_stage_events e WHERE e.lead_id = leads.id);

-- ==========================================================
-- 4. updated_at trigger on leads
-- ==========================================================
-- No updated_at trigger existed on any table; every server action set the column
-- by hand. The API's `updated_since` cursor cannot depend on that discipline —
-- one write that forgets it silently drops a lead out of marketing's sync.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leads_set_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- ==========================================================
-- 5. api_keys
-- ==========================================================
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,                  -- "Marketing tracking stack"
  key_prefix   TEXT NOT NULL,                  -- "rvf_live_a1b2c3d4", safe to log
  key_hash     TEXT NOT NULL UNIQUE,           -- sha256 hex of the full plaintext token
  scopes       TEXT[] NOT NULL DEFAULT '{}',   -- e.g. {'leads:read'}
  owner_email  TEXT,
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_hash_active ON api_keys(key_hash) WHERE revoked_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- super_admin only. Never USING(true) (038). The API route reads through the
-- admin client, which bypasses RLS entirely, so these policies only govern
-- access from the app session or the SQL editor.
CREATE POLICY "Super admins can view api_keys"
  ON api_keys FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can write api_keys"
  ON api_keys FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');
