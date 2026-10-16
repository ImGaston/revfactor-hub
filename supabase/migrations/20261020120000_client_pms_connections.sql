-- Client PMS connections, phase 1 (2026-10-16).
--
-- Clients submit read-only PMS API credentials from the owner portal
-- (/portal/connections, an Assembly Custom App). Hospitable is checked live
-- (GET /properties); every other PMS is stored as "pending verification" until
-- staff mark it verified or rejected. Nothing is imported: discovered
-- properties are only suggested matches until staff confirm each mapping.
--
--   * client_pms_connections        one row per submitted credential. Holds only
--                                   a Supabase Vault reference (secret_id) and
--                                   the last 4 characters for display — never
--                                   the credential itself.
--   * client_pms_properties         properties discovered through a connection
--                                   (Hospitable today), with a suggested Hub
--                                   listing and the staff-confirmed mapping.
--   * client_pms_connection_events  append-only audit, written by triggers so
--                                   service-role writes are captured too. Never
--                                   holds secret values.
--
-- Secrets: one Vault secret per connection holding a small JSON blob of the
-- provider's credential parts ({"v":1,"provider":…,"fields":{…}}). Vault access
-- goes only through the SECURITY DEFINER functions below. Create/read/portal
-- disconnect are EXECUTE-able by service_role only; the staff disconnect and
-- review functions run as the session and check has_permission themselves.
--
-- Permissions: new resource `data_connections`. view = see status, properties
-- and history; edit = "manage" (review, disconnect, confirm mappings — mapping
-- also needs listings:edit). RLS is permission-based; no USING (true).

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ---------------------------------------------------------------------------
-- 1. Connections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_pms_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('hospitable', 'guesty', 'hostaway', 'hostfully', 'ownerrez', 'lodgify', 'other')),
  -- Free-text PMS name, only for provider = 'other'.
  provider_name TEXT CHECK (provider_name IS NULL OR char_length(provider_name) BETWEEN 1 AND 80),
  label TEXT CHECK (label IS NULL OR char_length(label) <= 80),
  status TEXT NOT NULL
    CHECK (status IN ('pending_verification', 'connected', 'verified', 'rejected', 'error', 'disconnected')),
  -- vault.secrets.id. NULL once disconnected (the secret is deleted).
  secret_id UUID,
  token_last4 TEXT CHECK (token_last4 IS NULL OR char_length(token_last4) <= 4),
  -- Client-entered token expiry, when they know it.
  expires_at DATE,
  -- When to remind the client to renew: expires_at − 30 days, else
  -- connected/submitted + 11 months (Hospitable tokens default to ~12 months).
  remind_at DATE NOT NULL,
  property_count INTEGER CHECK (property_count IS NULL OR property_count >= 0),
  last_validated_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'invalid_token', 'forbidden', 'rate_limited', 'provider_unavailable', 'timeout', 'unexpected_response'
    )
  ),
  -- Optional client note (provider = 'other'); app-checked for credentials.
  client_note TEXT CHECK (client_note IS NULL OR char_length(client_note) <= 500),
  submitted_via TEXT NOT NULL DEFAULT 'portal' CHECK (submitted_via IN ('portal', 'hub')),
  -- Who acted last: a Hub profile (staff) or an Assembly client (portal).
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_assembly_client_id TEXT CHECK (created_by_assembly_client_id IS NULL OR char_length(created_by_assembly_client_id) <= 100),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by_assembly_client_id TEXT CHECK (updated_by_assembly_client_id IS NULL OR char_length(updated_by_assembly_client_id) <= 100),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((provider = 'other') = (provider_name IS NOT NULL)),
  CHECK ((status = 'disconnected') = (disconnected_at IS NOT NULL)),
  CHECK (status = 'disconnected' OR secret_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_client_pms_connections_client
  ON public.client_pms_connections (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_pms_connections_open
  ON public.client_pms_connections (status)
  WHERE status <> 'disconnected';

-- ---------------------------------------------------------------------------
-- 2. Discovered properties and their mapping
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_pms_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.client_pms_connections(id) ON DELETE CASCADE,
  -- Denormalized from the connection (checked by trigger) for scoping.
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  external_property_id TEXT NOT NULL CHECK (char_length(external_property_id) BETWEEN 1 AND 100),
  name TEXT CHECK (name IS NULL OR char_length(name) <= 300),
  airbnb_id TEXT CHECK (airbnb_id IS NULL OR airbnb_id ~ '^[0-9]{1,30}$'),
  vrbo_id TEXT CHECK (vrbo_id IS NULL OR char_length(vrbo_id) <= 60),
  suggested_listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  suggestion_reason TEXT CHECK (suggestion_reason IS NULL OR suggestion_reason IN ('airbnb_id', 'vrbo_id')),
  mapped_listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  -- suggested/unmatched = awaiting staff; confirmed = mapped to a listing;
  -- ignored = staff decided this property is not managed by RevFactor.
  mapping_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (mapping_status IN ('suggested', 'unmatched', 'confirmed', 'ignored')),
  confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_property_id),
  CHECK ((mapping_status = 'confirmed') = (mapped_listing_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_client_pms_properties_client
  ON public.client_pms_properties (client_id);
-- One Hub listing maps to at most one property per connection.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_pms_properties_mapped_once
  ON public.client_pms_properties (connection_id, mapped_listing_id)
  WHERE mapped_listing_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Append-only audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_pms_connection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.client_pms_connections(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Plain reference (no FK): an FK action would UPDATE this append-only table.
  property_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'submitted', 'validated', 'validation_failed', 'verified', 'rejected', 'disconnected',
    'mapping_confirmed', 'mapping_ignored', 'mapping_reset'
  )),
  from_status TEXT,
  to_status TEXT,
  -- Non-secret context only (error code, listing ids, property count).
  detail JSONB CHECK (detail IS NULL OR pg_column_size(detail) <= 2000),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_assembly_client_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_pms_connection_events_client
  ON public.client_pms_connection_events (client_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.block_client_pms_event_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'client_pms_connection_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_client_pms_connection_events_append_only ON public.client_pms_connection_events;
CREATE TRIGGER trg_client_pms_connection_events_append_only
  BEFORE UPDATE ON public.client_pms_connection_events
  FOR EACH ROW EXECUTE FUNCTION public.block_client_pms_event_update();

-- ---------------------------------------------------------------------------
-- 4. Triggers: stamps, guards and audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_client_pms_connection()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'A PMS connection cannot change its client or provider';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'disconnected' AND NEW.status <> 'disconnected' THEN
    RAISE EXCEPTION 'A disconnected PMS connection cannot be reopened; submit a new one';
  END IF;
  NEW.updated_at := now();
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_by := auth.uid();
    NEW.updated_by_assembly_client_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_pms_connections_stamp ON public.client_pms_connections;
CREATE TRIGGER trg_client_pms_connections_stamp
  BEFORE INSERT OR UPDATE ON public.client_pms_connections
  FOR EACH ROW EXECUTE FUNCTION public.stamp_client_pms_connection();

CREATE OR REPLACE FUNCTION public.record_client_pms_connection_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO client_pms_connection_events
      (connection_id, client_id, event_type, from_status, to_status, detail, actor_id, actor_assembly_client_id)
    VALUES (NEW.id, NEW.client_id, 'submitted', NULL, NEW.status,
      jsonb_build_object('provider', NEW.provider, 'property_count', NEW.property_count),
      COALESCE(auth.uid(), NEW.created_by), NEW.created_by_assembly_client_id);
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_type := CASE NEW.status
      WHEN 'connected' THEN 'validated'
      WHEN 'verified' THEN 'verified'
      WHEN 'rejected' THEN 'rejected'
      WHEN 'error' THEN 'validation_failed'
      WHEN 'disconnected' THEN 'disconnected'
      ELSE NULL
    END;
  ELSIF NEW.last_validated_at IS DISTINCT FROM OLD.last_validated_at THEN
    v_type := 'validated';
  END IF;

  IF v_type IS NOT NULL THEN
    INSERT INTO client_pms_connection_events
      (connection_id, client_id, event_type, from_status, to_status, detail, actor_id, actor_assembly_client_id)
    VALUES (NEW.id, NEW.client_id, v_type, OLD.status, NEW.status,
      jsonb_strip_nulls(jsonb_build_object(
        'error_code', NEW.last_error_code,
        'property_count', NEW.property_count,
        'review_note', CASE WHEN v_type IN ('verified', 'rejected') THEN NEW.review_note END
      )),
      COALESCE(auth.uid(), NEW.updated_by), NEW.updated_by_assembly_client_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_pms_connections_event ON public.client_pms_connections;
CREATE TRIGGER trg_client_pms_connections_event
  AFTER INSERT OR UPDATE ON public.client_pms_connections
  FOR EACH ROW EXECUTE FUNCTION public.record_client_pms_connection_event();

CREATE OR REPLACE FUNCTION public.guard_client_pms_property()
RETURNS TRIGGER
LANGUAGE plpgsql
-- DEFINER so the ownership checks can read connections/listings whatever the
-- editor's grants; it only reads and stamps NEW.
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM client_pms_connections WHERE id = NEW.connection_id AND client_id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'Property client does not match its connection';
    END IF;
  ELSE
    IF NEW.connection_id IS DISTINCT FROM OLD.connection_id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.external_property_id IS DISTINCT FROM OLD.external_property_id THEN
      RAISE EXCEPTION 'A PMS property cannot change its connection, client or external id';
    END IF;
    -- Session editors may only change the mapping; discovery fields come from
    -- the provider via the service role.
    IF auth.uid() IS NOT NULL AND (
      NEW.name IS DISTINCT FROM OLD.name
      OR NEW.airbnb_id IS DISTINCT FROM OLD.airbnb_id
      OR NEW.vrbo_id IS DISTINCT FROM OLD.vrbo_id
      OR NEW.suggested_listing_id IS DISTINCT FROM OLD.suggested_listing_id
      OR NEW.suggestion_reason IS DISTINCT FROM OLD.suggestion_reason
      OR NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at
    ) THEN
      RAISE EXCEPTION 'Only the mapping of a PMS property can be edited';
    END IF;
  END IF;

  IF NEW.mapped_listing_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM listings WHERE id = NEW.mapped_listing_id AND client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'Listing % does not belong to client %', NEW.mapped_listing_id, NEW.client_id;
  END IF;
  IF NEW.suggested_listing_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM listings WHERE id = NEW.suggested_listing_id AND client_id = NEW.client_id
  ) THEN
    NEW.suggested_listing_id := NULL;
    NEW.suggestion_reason := NULL;
  END IF;

  NEW.updated_at := now();
  IF TG_OP = 'INSERT' OR NEW.mapping_status IS DISTINCT FROM OLD.mapping_status
     OR NEW.mapped_listing_id IS DISTINCT FROM OLD.mapped_listing_id THEN
    IF NEW.mapping_status IN ('confirmed', 'ignored') THEN
      NEW.confirmed_at := now();
      NEW.confirmed_by := COALESCE(auth.uid(), NEW.confirmed_by);
    ELSE
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_pms_properties_guard ON public.client_pms_properties;
CREATE TRIGGER trg_client_pms_properties_guard
  BEFORE INSERT OR UPDATE ON public.client_pms_properties
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_pms_property();

CREATE OR REPLACE FUNCTION public.record_client_pms_property_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
BEGIN
  IF NEW.mapping_status IS NOT DISTINCT FROM OLD.mapping_status
     AND NEW.mapped_listing_id IS NOT DISTINCT FROM OLD.mapped_listing_id THEN
    RETURN NULL;
  END IF;
  v_type := CASE NEW.mapping_status
    WHEN 'confirmed' THEN 'mapping_confirmed'
    WHEN 'ignored' THEN 'mapping_ignored'
    ELSE 'mapping_reset'
  END;
  INSERT INTO client_pms_connection_events
    (connection_id, client_id, property_id, event_type, from_status, to_status, detail, actor_id)
  VALUES (NEW.connection_id, NEW.client_id, NEW.id, v_type, OLD.mapping_status, NEW.mapping_status,
    jsonb_strip_nulls(jsonb_build_object(
      'external_property_id', NEW.external_property_id,
      'from_listing_id', OLD.mapped_listing_id,
      'to_listing_id', NEW.mapped_listing_id
    )),
    COALESCE(auth.uid(), NEW.confirmed_by));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_pms_properties_event ON public.client_pms_properties;
CREATE TRIGGER trg_client_pms_properties_event
  AFTER UPDATE ON public.client_pms_properties
  FOR EACH ROW EXECUTE FUNCTION public.record_client_pms_property_event();

-- EXECUTE is checked at CREATE TRIGGER time, not fire time; this only removes
-- the PostgREST /rpc/ endpoints.
REVOKE EXECUTE ON FUNCTION public.block_client_pms_event_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_client_pms_connection() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_client_pms_connection_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_client_pms_property() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_client_pms_property_event() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Vault access (SECURITY DEFINER; secrets never leave the server)
-- ---------------------------------------------------------------------------

-- Create a connection and its Vault secret atomically. service_role only: the
-- portal action calls it after validating the Assembly session server-side.
CREATE OR REPLACE FUNCTION public.pms_connection_create(
  p_client_id UUID,
  p_provider TEXT,
  p_provider_name TEXT,
  p_label TEXT,
  p_status TEXT,
  p_secret TEXT,
  p_token_last4 TEXT,
  p_expires_at DATE,
  p_remind_at DATE,
  p_property_count INTEGER,
  p_last_validated_at TIMESTAMPTZ,
  p_client_note TEXT,
  p_submitted_via TEXT,
  p_created_by UUID,
  p_created_by_assembly_client_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID := gen_random_uuid();
  v_secret_id UUID;
BEGIN
  IF p_status NOT IN ('pending_verification', 'connected') THEN
    RAISE EXCEPTION 'New connections start as pending_verification or connected';
  END IF;
  IF p_secret IS NULL OR char_length(p_secret) < 8 OR char_length(p_secret) > 8000 THEN
    RAISE EXCEPTION 'Invalid credential payload';
  END IF;

  v_secret_id := vault.create_secret(
    p_secret,
    'pms_connection_' || v_id::text,
    'Client PMS credential (read-only API access)'
  );

  INSERT INTO client_pms_connections (
    id, client_id, provider, provider_name, label, status, secret_id, token_last4,
    expires_at, remind_at, property_count, last_validated_at, client_note,
    submitted_via, created_by, created_by_assembly_client_id,
    updated_by, updated_by_assembly_client_id
  ) VALUES (
    v_id, p_client_id, p_provider, p_provider_name, p_label, p_status, v_secret_id, p_token_last4,
    p_expires_at, p_remind_at, p_property_count, p_last_validated_at, p_client_note,
    COALESCE(p_submitted_via, 'portal'), p_created_by, p_created_by_assembly_client_id,
    p_created_by, p_created_by_assembly_client_id
  );
  RETURN v_id;
END;
$$;

-- Decrypted credential for a server-side provider call. service_role only;
-- the caller checks permissions/scope in code before asking.
CREATE OR REPLACE FUNCTION public.pms_connection_secret(p_connection_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT s.decrypted_secret INTO v_secret
  FROM client_pms_connections c
  JOIN vault.decrypted_secrets s ON s.id = c.secret_id
  WHERE c.id = p_connection_id AND c.status <> 'disconnected';
  RETURN v_secret;
END;
$$;

-- Shared disconnect: delete the Vault secret, keep the row and its history.
CREATE OR REPLACE FUNCTION public._pms_connection_disconnect(
  p_connection_id UUID,
  p_client_id UUID,
  p_actor UUID,
  p_actor_assembly_client_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT secret_id INTO v_secret_id
  FROM client_pms_connections
  WHERE id = p_connection_id
    AND (p_client_id IS NULL OR client_id = p_client_id)
    AND status <> 'disconnected'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE client_pms_connections
  SET status = 'disconnected',
      disconnected_at = now(),
      secret_id = NULL,
      updated_by = p_actor,
      updated_by_assembly_client_id = p_actor_assembly_client_id
  WHERE id = p_connection_id;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;
  RETURN TRUE;
END;
$$;

-- Portal disconnect: service_role only, scoped to the portal viewer's client.
CREATE OR REPLACE FUNCTION public.pms_connection_disconnect_for_client(
  p_connection_id UUID,
  p_client_id UUID,
  p_assembly_client_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._pms_connection_disconnect(p_connection_id, p_client_id, NULL, p_assembly_client_id);
$$;

-- Staff disconnect from the Hub: runs as the session, checks the permission.
CREATE OR REPLACE FUNCTION public.pms_connection_disconnect_staff(p_connection_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- IS NOT TRUE: has_permission returns NULL for a session with no profile.
  IF auth.uid() IS NULL OR public.has_permission('data_connections', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'Not allowed to manage data connections' USING ERRCODE = '42501';
  END IF;
  RETURN public._pms_connection_disconnect(p_connection_id, NULL, auth.uid(), NULL);
END;
$$;

-- Staff review of a credential that could not be checked live.
CREATE OR REPLACE FUNCTION public.pms_connection_review(
  p_connection_id UUID,
  p_decision TEXT,
  p_note TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_permission('data_connections', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'Not allowed to manage data connections' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be verified or rejected';
  END IF;
  UPDATE client_pms_connections
  SET status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = NULLIF(btrim(COALESCE(p_note, '')), '')
  WHERE id = p_connection_id
    AND status IN ('pending_verification', 'verified', 'rejected');
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pms_connection_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, INTEGER, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pms_connection_secret(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._pms_connection_disconnect(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.pms_connection_disconnect_for_client(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pms_connection_disconnect_staff(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pms_connection_review(UUID, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.pms_connection_create(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, INTEGER, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pms_connection_secret(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pms_connection_disconnect_for_client(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pms_connection_disconnect_staff(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pms_connection_review(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS — data_connections:view reads; mapping needs data_connections:edit
--    AND listings:edit. Connection writes go only through the functions above.
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_pms_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_pms_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_pms_connection_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Data connection viewers can view PMS connections"
  ON public.client_pms_connections FOR SELECT TO authenticated
  USING (public.has_permission('data_connections', 'view'));

CREATE POLICY "Data connection viewers can view PMS properties"
  ON public.client_pms_properties FOR SELECT TO authenticated
  USING (public.has_permission('data_connections', 'view'));
CREATE POLICY "Connection managers with listing edit can map PMS properties"
  ON public.client_pms_properties FOR UPDATE TO authenticated
  USING (public.has_permission('data_connections', 'edit') AND public.has_permission('listings', 'edit'))
  WITH CHECK (public.has_permission('data_connections', 'edit') AND public.has_permission('listings', 'edit'));

CREATE POLICY "Data connection viewers can view PMS connection events"
  ON public.client_pms_connection_events FOR SELECT TO authenticated
  USING (public.has_permission('data_connections', 'view'));

REVOKE ALL ON public.client_pms_connections, public.client_pms_properties, public.client_pms_connection_events FROM anon;
-- secret_id is a Vault reference, not a secret, but the browser never needs it.
REVOKE SELECT ON public.client_pms_connections FROM authenticated;
GRANT SELECT (
  id, client_id, provider, provider_name, label, status, token_last4, expires_at, remind_at,
  property_count, last_validated_at, last_error_code, client_note, submitted_via,
  created_by, created_by_assembly_client_id, updated_by, updated_by_assembly_client_id,
  reviewed_by, reviewed_at, review_note, disconnected_at, created_at, updated_at
) ON public.client_pms_connections TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.client_pms_connections FROM authenticated;
REVOKE INSERT, DELETE ON public.client_pms_properties FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.client_pms_connection_events FROM authenticated;

-- ---------------------------------------------------------------------------
-- 7. Permission resource: data_connections (view / edit = manage)
-- ---------------------------------------------------------------------------
-- super_admin needs no rows: has_permission short-circuits.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT 'admin', 'data_connections', a.action, (a.action IN ('view', 'edit'))
FROM (VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')) AS a(action)
WHERE EXISTS (SELECT 1 FROM roles WHERE name = 'admin')
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- External roles: explicit deny — client credentials stay inside the team.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'data_connections', a.action, FALSE
FROM roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')) AS a(action)
WHERE r.name IN ('contractor', 'marketing', 'hostpricing')
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Any remaining custom roles: complete the grid without touching live grants.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'data_connections', a.action, FALSE
FROM roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')) AS a(action)
WHERE r.name <> 'super_admin'
ON CONFLICT (role_name, resource, action) DO NOTHING;
