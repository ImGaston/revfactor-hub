-- Client PMS connections, phase 2: booking sync (2026-10-16).
--
-- Reservations pulled from a client's connected PMS (Hospitable first) for
-- staff-confirmed property → listing mappings only, plus job state for the
-- backfill / daily incremental sync. Additive: no existing table changes shape.
--
--   * pms_reservations   one row per (connection, provider reservation id).
--                        Provider-neutral. Holds stay dates, status, channel,
--                        guest COUNT and money in integer minor units. Never
--                        guest names, contacts, messages, door codes or
--                        confirmation codes. `financials` keeps only amounts
--                        and provider categories (labels can hold ids).
--   * pms_sync_runs      one row per sync run: mode, window, resume cursor,
--                        counts, coverage and last error code.
--
-- Writes: service role only (lib/pms-sync.server.ts). listing_id also follows
-- the confirmed mapping through a trigger on client_pms_properties, so a reset
-- or ignored mapping stops feeding the listing right away.
--
-- RLS: permission-based, no USING (true).
--   pms_reservations → reservations:view (same resource as the PriceLabs cache)
--   pms_sync_runs    → data_connections:view

-- ---------------------------------------------------------------------------
-- 1. Reservations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pms_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.client_pms_connections(id) ON DELETE CASCADE,
  -- Denormalized from the connection (checked by trigger) for scoping.
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('hospitable', 'guesty', 'hostaway', 'hostfully', 'ownerrez', 'lodgify', 'other')),
  external_property_id TEXT NOT NULL CHECK (char_length(external_property_id) BETWEEN 1 AND 100),
  -- The confirmed mapping's listing; NULL when the mapping is reset/ignored.
  listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  -- The PMS's internal reservation id (Hospitable: UUID). Never a channel
  -- confirmation code.
  external_reservation_id TEXT NOT NULL CHECK (char_length(external_reservation_id) BETWEEN 1 AND 100),
  platform TEXT CHECK (platform IS NULL OR platform ~ '^[a-z0-9_.-]{1,40}$'),
  status TEXT NOT NULL CHECK (status IN (
    'accepted', 'cancelled', 'request', 'inquiry', 'checkpoint', 'declined', 'expired', 'not_accepted', 'unknown'
  )),
  booked_at TIMESTAMPTZ,
  -- Provider-local booking day (lead time is counted in local days).
  booked_date DATE,
  check_in DATE NOT NULL,
  check_out DATE,
  nights INTEGER CHECK (nights IS NULL OR nights BETWEEN 0 AND 1000),
  guests INTEGER CHECK (guests IS NULL OR guests BETWEEN 0 AND 100),
  currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  -- Money in integer minor units (USD cents). NULL = not provided (not zero).
  -- accommodation: nightly rent after discounts, before channel/host fees.
  accommodation_minor BIGINT,
  -- Signed as the provider returns them (discounts and host fees are normally ≤ 0).
  discounts_minor BIGINT,
  cleaning_fee_minor BIGINT,
  host_fees_minor BIGINT,
  -- Provider "host revenue" (payout basis); not a confirmed owner payout.
  host_revenue_minor BIGINT,
  financials JSONB CHECK (financials IS NULL OR (jsonb_typeof(financials) = 'object' AND pg_column_size(financials) <= 8000)),
  source_fetched_at TIMESTAMPTZ NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_reservation_id),
  CHECK (check_out IS NULL OR check_out >= check_in)
);

CREATE INDEX IF NOT EXISTS idx_pms_reservations_listing_check_in
  ON public.pms_reservations (listing_id, check_in)
  WHERE listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pms_reservations_connection_status
  ON public.pms_reservations (connection_id, status, check_in);
CREATE INDEX IF NOT EXISTS idx_pms_reservations_client
  ON public.pms_reservations (client_id);

CREATE OR REPLACE FUNCTION public.guard_pms_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
-- DEFINER so the ownership checks can read connections/listings; it only
-- reads and stamps NEW.
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM client_pms_connections
      WHERE id = NEW.connection_id AND client_id = NEW.client_id AND provider = NEW.provider
    ) THEN
      RAISE EXCEPTION 'Reservation client/provider does not match its connection';
    END IF;
    NEW.first_seen_at := now();
  ELSE
    IF NEW.connection_id IS DISTINCT FROM OLD.connection_id
      OR NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW.external_reservation_id IS DISTINCT FROM OLD.external_reservation_id THEN
      RAISE EXCEPTION 'A PMS reservation cannot change its connection, client, provider or id';
    END IF;
    NEW.first_seen_at := OLD.first_seen_at;
  END IF;
  IF NEW.listing_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM listings WHERE id = NEW.listing_id AND client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'Listing % does not belong to client %', NEW.listing_id, NEW.client_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pms_reservations_guard ON public.pms_reservations;
CREATE TRIGGER trg_pms_reservations_guard
  BEFORE INSERT OR UPDATE ON public.pms_reservations
  FOR EACH ROW EXECUTE FUNCTION public.guard_pms_reservation();

-- Keep pms_reservations.listing_id equal to the confirmed mapping. Staff edit
-- mappings as the session (no write grant on pms_reservations), so DEFINER.
CREATE OR REPLACE FUNCTION public.follow_pms_property_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.mapping_status IS NOT DISTINCT FROM OLD.mapping_status
     AND NEW.mapped_listing_id IS NOT DISTINCT FROM OLD.mapped_listing_id THEN
    RETURN NULL;
  END IF;
  UPDATE pms_reservations
  SET listing_id = CASE WHEN NEW.mapping_status = 'confirmed' THEN NEW.mapped_listing_id END
  WHERE connection_id = NEW.connection_id
    AND external_property_id = NEW.external_property_id
    AND listing_id IS DISTINCT FROM CASE WHEN NEW.mapping_status = 'confirmed' THEN NEW.mapped_listing_id END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_pms_properties_follow_mapping ON public.client_pms_properties;
CREATE TRIGGER trg_client_pms_properties_follow_mapping
  AFTER UPDATE ON public.client_pms_properties
  FOR EACH ROW EXECUTE FUNCTION public.follow_pms_property_mapping();

-- ---------------------------------------------------------------------------
-- 2. Sync runs (job state + coverage)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pms_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.client_pms_connections(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('hospitable', 'guesty', 'hostaway', 'hostfully', 'ownerrez', 'lodgify', 'other')),
  mode TEXT NOT NULL CHECK (mode IN ('backfill', 'incremental')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'cron')),
  -- running → succeeded | partial (deadline; resumes from next_chunk_start) | failed
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  -- Check-in window of the whole job (a resumed run keeps the original window).
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  -- Start of the next window still to fetch; NULL when done.
  next_chunk_start DATE,
  chunks_total INTEGER NOT NULL DEFAULT 0 CHECK (chunks_total >= 0),
  chunks_done INTEGER NOT NULL DEFAULT 0 CHECK (chunks_done >= 0),
  fetched_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  upserted_count INTEGER NOT NULL DEFAULT 0 CHECK (upserted_count >= 0),
  -- Coverage after a successful run: synced check-in range and stored stays.
  coverage_start DATE,
  coverage_end DATE,
  stay_count INTEGER CHECK (stay_count IS NULL OR stay_count >= 0),
  cancelled_count INTEGER CHECK (cancelled_count IS NULL OR cancelled_count >= 0),
  earliest_check_in DATE,
  latest_check_out DATE,
  error_code TEXT CHECK (error_code IS NULL OR error_code IN (
    'invalid_token', 'forbidden', 'rate_limited', 'provider_unavailable', 'timeout', 'unexpected_response',
    'secret_unavailable', 'write_failed', 'interrupted'
  )),
  started_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CHECK (window_end >= window_start),
  CHECK ((status = 'running') = (finished_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_pms_sync_runs_connection
  ON public.pms_sync_runs (connection_id, started_at DESC);
-- One running sync per connection.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pms_sync_runs_single_running
  ON public.pms_sync_runs (connection_id)
  WHERE status = 'running';

-- EXECUTE is checked at CREATE TRIGGER time, not fire time; this only removes
-- the PostgREST /rpc/ endpoints.
REVOKE EXECUTE ON FUNCTION public.guard_pms_reservation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.follow_pms_property_mapping() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS — reads by permission; writes only through the service role
-- ---------------------------------------------------------------------------
ALTER TABLE public.pms_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pms_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reservation viewers can view PMS reservations"
  ON public.pms_reservations FOR SELECT TO authenticated
  USING (public.has_permission('reservations', 'view'));

CREATE POLICY "Data connection viewers can view PMS sync runs"
  ON public.pms_sync_runs FOR SELECT TO authenticated
  USING (public.has_permission('data_connections', 'view'));

REVOKE ALL ON public.pms_reservations, public.pms_sync_runs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.pms_reservations, public.pms_sync_runs FROM authenticated;
