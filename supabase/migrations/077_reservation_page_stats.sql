-- ==========================================================
-- 077: Aggregate stats for the /reservations page header
--
-- One round-trip aggregate over pricelabs_reservations_cache so the page
-- never pages 28k rows into Node just to sum four numbers. Filters mirror
-- getReservationsPage (lib/reservations.ts) exactly — client, hub listing,
-- free-text search, and a date range that can anchor on either booked_date
-- or check_in — so the header always describes the same population the
-- table would show for the same filters.
--
-- Currency: the cache mixes USD with a long tail of CAD/EUR. Money figures
-- (revenue sum, ADR) are USD-only by product decision; non_usd_count lets
-- the UI disclose how many reservations were excluded. Nights and booking
-- window are currency-agnostic and aggregate over everything.
--
-- ADR is nights-weighted: sum(revenue)/sum(nights) over rows that have
-- both, not an average of per-reservation ADRs.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.reservation_page_stats(
  p_client_id  UUID DEFAULT NULL,
  p_listing_id UUID DEFAULT NULL,  -- hub listing (listings.id)
  p_date_field TEXT DEFAULT 'booked',  -- 'booked' → booked_date, 'checkin' → check_in
  p_from       DATE DEFAULT NULL,
  p_to         DATE DEFAULT NULL,
  p_search     TEXT DEFAULT NULL
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
  -- Same rationale as wins_pickup_windows (migration 075).
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
    AND (p_client_id IS NULL OR r.client_id = p_client_id)
    AND (p_listing_id IS NULL OR r.hub_listing_id = p_listing_id)
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

REVOKE ALL ON FUNCTION public.reservation_page_stats(UUID, UUID, TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservation_page_stats(UUID, UUID, TEXT, DATE, DATE, TEXT) TO authenticated, service_role;
