-- ==========================================================
-- reservation_page_stats: multi-client/listing filters + booking window
--
-- /reservations now lets the client and listing filters hold several ids
-- ("is" any of them / "is not" any of them) and adds a booking-window
-- range (booking_window_days between min and max). The header stats must
-- describe the same population as the table (lib/reservations.ts
-- applyReservationFilters), so the function gains:
--   p_client_ids / p_listing_ids  UUID[]  — used instead of the scalar
--                                           p_client_id / p_listing_id
--   p_bw_min / p_bw_max           INT     — inclusive booking-window bounds
--
-- The scalar p_client_id / p_listing_id args stay (folded into the arrays
-- when the arrays are NULL) so the app version deployed before this change
-- keeps working during rollout. Exclusions keep NULL client/listing rows,
-- matching the PostgREST is.null,not.in filter. A booking-window bound
-- drops rows whose booking_window_days is NULL, like PostgREST gte/lte.
--
-- The previous 8-arg signature is dropped so there is exactly one overload.
-- ==========================================================

DROP FUNCTION IF EXISTS public.reservation_page_stats(UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.reservation_page_stats(
  p_client_id         UUID DEFAULT NULL,
  p_listing_id        UUID DEFAULT NULL,  -- hub listing (listings.id)
  p_date_field        TEXT DEFAULT 'booked',  -- 'booked' → booked_date, 'checkin' → check_in
  p_from              DATE DEFAULT NULL,
  p_to                DATE DEFAULT NULL,
  p_search            TEXT DEFAULT NULL,
  p_exclude_client    BOOLEAN DEFAULT FALSE,  -- true → all but the client ids
  p_exclude_listing   BOOLEAN DEFAULT FALSE,  -- true → all but the listing ids
  p_client_ids        UUID[] DEFAULT NULL,
  p_listing_ids       UUID[] DEFAULT NULL,
  p_bw_min            INT DEFAULT NULL,
  p_bw_max            INT DEFAULT NULL
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
DECLARE
  v_client_ids  UUID[] := COALESCE(
    p_client_ids,
    CASE WHEN p_client_id IS NOT NULL THEN ARRAY[p_client_id] END
  );
  v_listing_ids UUID[] := COALESCE(
    p_listing_ids,
    CASE WHEN p_listing_id IS NOT NULL THEN ARRAY[p_listing_id] END
  );
BEGIN
  -- IS NOT TRUE, not NOT(...): has_permission evaluates to NULL for a
  -- session with no profile row, and a plain NOT would let it through.
  IF public.has_permission('reservations', 'view') IS NOT TRUE THEN
    RAISE EXCEPTION 'insufficient_privilege: reservations:view required'
      USING ERRCODE = '42501';
  END IF;

  IF cardinality(v_client_ids) = 0 THEN v_client_ids := NULL; END IF;
  IF cardinality(v_listing_ids) = 0 THEN v_listing_ids := NULL; END IF;

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
      v_client_ids IS NULL
      OR (p_exclude_client AND (r.client_id IS NULL OR NOT (r.client_id = ANY (v_client_ids))))
      OR (NOT p_exclude_client AND r.client_id = ANY (v_client_ids))
    )
    AND (
      v_listing_ids IS NULL
      OR (p_exclude_listing AND (r.hub_listing_id IS NULL OR NOT (r.hub_listing_id = ANY (v_listing_ids))))
      OR (NOT p_exclude_listing AND r.hub_listing_id = ANY (v_listing_ids))
    )
    AND (p_bw_min IS NULL OR r.booking_window_days >= p_bw_min)
    AND (p_bw_max IS NULL OR r.booking_window_days <= p_bw_max)
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
      OR r.listing_name ILIKE '%' || p_search || '%'
      OR r.channel_confirmation_code ILIKE '%' || p_search || '%'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reservation_page_stats(UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN, BOOLEAN, UUID[], UUID[], INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservation_page_stats(UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN, BOOLEAN, UUID[], UUID[], INT, INT) TO authenticated, service_role;
