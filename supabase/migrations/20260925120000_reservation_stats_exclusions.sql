-- ==========================================================
-- reservation_page_stats: negative client / listing filters
--
-- /reservations can now filter "everything except client X" or "everything
-- except listing Y". The header stats must describe the same population as
-- the table (lib/reservations.ts applyReservationFilters), so the function
-- gains p_exclude_client / p_exclude_listing flags. Exclusions use
-- IS DISTINCT FROM so rows with a NULL client/listing (unmapped PriceLabs
-- listings) stay in the "all but X" set, matching the PostgREST filter.
--
-- The old 6-arg signature is dropped so there is exactly one overload; the
-- new flags default to false, so existing named-arg callers keep working.
-- ==========================================================

DROP FUNCTION IF EXISTS public.reservation_page_stats(UUID, UUID, TEXT, DATE, DATE, TEXT);

CREATE OR REPLACE FUNCTION public.reservation_page_stats(
  p_client_id         UUID DEFAULT NULL,
  p_listing_id        UUID DEFAULT NULL,  -- hub listing (listings.id)
  p_date_field        TEXT DEFAULT 'booked',  -- 'booked' → booked_date, 'checkin' → check_in
  p_from              DATE DEFAULT NULL,
  p_to                DATE DEFAULT NULL,
  p_search            TEXT DEFAULT NULL,
  p_exclude_client    BOOLEAN DEFAULT FALSE,  -- true → all but p_client_id
  p_exclude_listing   BOOLEAN DEFAULT FALSE   -- true → all but p_listing_id
)
RETURNS TABLE (
  reservation_count        BIGINT,
  total_nights             BIGINT,
  avg_booking_window_days  NUMERIC,
  rental_revenue_usd       NUMERIC,
  adr_usd                  NUMERIC,
  non_usd_count            BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- IS NOT TRUE, not NOT(...): has_permission evaluates to NULL for a
  -- session with no profile row, and a plain NOT would let it through.
  IF public.has_permission('reservations', 'view') IS NOT TRUE THEN
    RAISE EXCEPTION 'insufficient_privilege: reservations:view required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    count(*),
    COALESCE(sum(r.number_of_days), 0)::BIGINT,
    avg(r.booking_window_days),
    COALESCE(sum(r.rental_revenue) FILTER (WHERE r.currency = 'USD'), 0),
    sum(r.rental_revenue) FILTER (
      WHERE r.currency = 'USD' AND r.number_of_days > 0
    ) / NULLIF(
      sum(r.number_of_days) FILTER (
        WHERE r.currency = 'USD' AND r.rental_revenue IS NOT NULL
          AND r.number_of_days > 0
      ),
      0
    ),
    count(*) FILTER (WHERE r.currency IS DISTINCT FROM 'USD')
  FROM public.pricelabs_reservations_cache r
  WHERE r.booking_status = 'booked'
    AND (
      p_client_id IS NULL
      OR (p_exclude_client AND r.client_id IS DISTINCT FROM p_client_id)
      OR (NOT p_exclude_client AND r.client_id = p_client_id)
    )
    AND (
      p_listing_id IS NULL
      OR (p_exclude_listing AND r.hub_listing_id IS DISTINCT FROM p_listing_id)
      OR (NOT p_exclude_listing AND r.hub_listing_id = p_listing_id)
    )
    AND (
      p_from IS NULL
      OR (CASE WHEN p_date_field = 'checkin' THEN r.check_in ELSE r.booked_date END) >= p_from
    )
    AND (
      p_to IS NULL
      OR (CASE WHEN p_date_field = 'checkin' THEN r.check_in ELSE r.booked_date END) <= p_to
    )
    AND (
      p_search IS NULL OR p_search = ''
      OR r.guest_name ILIKE '%' || p_search || '%'
      OR r.listing_name ILIKE '%' || p_search || '%'
      OR r.channel_confirmation_code ILIKE '%' || p_search || '%'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reservation_page_stats(UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservation_page_stats(UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN, BOOLEAN) TO authenticated, service_role;
