-- Onboarding tab on /clients/[id] (2026-10-15).
--
--   * client_onboarding_items        one row per client × scope × catalog item.
--                                    Scope is the client (listing_id NULL: agreement,
--                                    call, PMS account access, payout floor…) or one
--                                    of the client's listings (Airbnb link, channels,
--                                    PMS, PriceLabs, co-host access, cleaning fee…).
--                                    Keys come from ONBOARDING_ITEMS in
--                                    lib/client-onboarding.ts. Preparation items hold
--                                    a staff-confirmed value (status done = verified);
--                                    call-checklist items hold a check state.
--                                    GHL intake answers are NOT copied here: they
--                                    prefill at read time from clients.ghl_onboarding
--                                    and show as client-submitted until staff confirm.
--   * client_onboarding_item_events  append-only audit of every change (who, when,
--                                    old → new status/value/note), written only by
--                                    trigger, so service-role writes are captured too.
--
-- RLS follows the permission model (migration 038): read = clients:view,
-- write = clients:edit. No USING (true), no DELETE (reset = status open + no
-- value). Actor and completion stamps come from the session, never the request.

-- ---------------------------------------------------------------------------
-- 1. Items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_onboarding_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- NULL = owner-level item. Must belong to client_id (checked by trigger).
  listing_id UUID REFERENCES public.listings(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL CHECK (item_key ~ '^[a-z0-9_]{2,60}$'),
  -- open = not done / staff value not verified yet; done = checked / verified.
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'blocked', 'not_applicable')),
  -- App-validated per catalog item (string, number, boolean or string array).
  value JSONB CHECK (value IS NULL OR pg_column_size(value) <= 4000),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  completed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_onboarding_items_owner_key
  ON public.client_onboarding_items (client_id, item_key)
  WHERE listing_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_onboarding_items_listing_key
  ON public.client_onboarding_items (listing_id, item_key)
  WHERE listing_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_onboarding_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.client_onboarding_items(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  item_key TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  from_value JSONB,
  to_value JSONB,
  note TEXT,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_onboarding_item_events_client
  ON public.client_onboarding_item_events (client_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Triggers: scope check + actor/completion stamps, then audit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_client_onboarding_item()
RETURNS TRIGGER
LANGUAGE plpgsql
-- DEFINER so the ownership check sees the listing even when the editor lacks
-- listings:view; it only reads listings and stamps NEW.
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.listing_id IS DISTINCT FROM OLD.listing_id
    OR NEW.item_key IS DISTINCT FROM OLD.item_key
  ) THEN
    RAISE EXCEPTION 'An onboarding item cannot change its client, listing or key';
  END IF;

  IF NEW.listing_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM listings WHERE id = NEW.listing_id AND client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'Listing % does not belong to client %', NEW.listing_id, NEW.client_id;
  END IF;

  NEW.updated_at := now();
  -- auth.uid() is NULL for service-role writes; keep whatever they passed.
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_by := auth.uid();
  END IF;

  IF NEW.status = 'done' OR NEW.status = 'not_applicable' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
      NEW.completed_at := now();
      NEW.completed_by := COALESCE(auth.uid(), NEW.updated_by);
    END IF;
  ELSE
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_onboarding_items_stamp ON public.client_onboarding_items;
CREATE TRIGGER trg_client_onboarding_items_stamp
  BEFORE INSERT OR UPDATE ON public.client_onboarding_items
  FOR EACH ROW EXECUTE FUNCTION public.stamp_client_onboarding_item();

CREATE OR REPLACE FUNCTION public.record_client_onboarding_item_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO client_onboarding_item_events
      (item_id, client_id, listing_id, item_key, from_status, to_status, from_value, to_value, note, actor_id)
      VALUES (NEW.id, NEW.client_id, NEW.listing_id, NEW.item_key, NULL, NEW.status, NULL, NEW.value, NEW.note, NEW.updated_by);
  ELSIF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.note IS DISTINCT FROM OLD.note THEN
    INSERT INTO client_onboarding_item_events
      (item_id, client_id, listing_id, item_key, from_status, to_status, from_value, to_value, note, actor_id)
      VALUES (NEW.id, NEW.client_id, NEW.listing_id, NEW.item_key, OLD.status, NEW.status, OLD.value, NEW.value, NEW.note, NEW.updated_by);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_onboarding_items_event ON public.client_onboarding_items;
CREATE TRIGGER trg_client_onboarding_items_event
  AFTER INSERT OR UPDATE ON public.client_onboarding_items
  FOR EACH ROW EXECUTE FUNCTION public.record_client_onboarding_item_event();

-- EXECUTE is checked at CREATE TRIGGER time, not fire time; this only removes
-- the PostgREST /rpc/ endpoints.
REVOKE EXECUTE ON FUNCTION public.record_client_onboarding_item_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_client_onboarding_item() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS — clients:view reads, clients:edit writes (child-table convention)
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_onboarding_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_onboarding_item_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Client viewers can view onboarding items"
  ON public.client_onboarding_items FOR SELECT TO authenticated
  USING (public.has_permission('clients', 'view'));
CREATE POLICY "Client editors can create onboarding items"
  ON public.client_onboarding_items FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('clients', 'edit'));
CREATE POLICY "Client editors can update onboarding items"
  ON public.client_onboarding_items FOR UPDATE TO authenticated
  USING (public.has_permission('clients', 'edit'))
  WITH CHECK (public.has_permission('clients', 'edit'));

-- No write policies: rows come only from the SECURITY DEFINER trigger.
CREATE POLICY "Client viewers can view onboarding item events"
  ON public.client_onboarding_item_events FOR SELECT TO authenticated
  USING (public.has_permission('clients', 'view'));

REVOKE ALL ON public.client_onboarding_items, public.client_onboarding_item_events FROM anon;
