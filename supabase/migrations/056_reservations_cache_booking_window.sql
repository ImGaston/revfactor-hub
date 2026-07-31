-- Migration 056: Add booking_window_days to the reservations cache
-- Lead time in days between booking and check-in (check_in - booked_date).
-- Computed here rather than in the external pricelabs_reservations_bq view,
-- which is managed outside the repo. Matviews can't ALTER columns, so the
-- cache is recreated; the pg_cron refresh job (migration 055) references it
-- by name and needs no change.

DROP MATERIALIZED VIEW public.pricelabs_reservations_cache;

CREATE MATERIALIZED VIEW public.pricelabs_reservations_cache AS
SELECT
  v.reservation_key || '|' || (
    row_number() OVER (
      PARTITION BY v.reservation_key
      ORDER BY v.hub_listing_id NULLS LAST
    )
  )::text AS row_key,
  v.*,
  (v.check_in - v.booked_date) AS booking_window_days
FROM public.pricelabs_reservations_bq v;

CREATE UNIQUE INDEX pricelabs_reservations_cache_row_key_idx
  ON public.pricelabs_reservations_cache (row_key);
CREATE INDEX pricelabs_reservations_cache_client_idx
  ON public.pricelabs_reservations_cache (client_id, booked_at DESC)
  WHERE booking_status = 'booked';
CREATE INDEX pricelabs_reservations_cache_listing_idx
  ON public.pricelabs_reservations_cache (hub_listing_id, booked_at DESC)
  WHERE booking_status = 'booked';
CREATE INDEX pricelabs_reservations_cache_booked_at_idx
  ON public.pricelabs_reservations_cache (booked_at DESC)
  WHERE booking_status = 'booked';

REVOKE ALL ON public.pricelabs_reservations_cache FROM anon;
GRANT SELECT ON public.pricelabs_reservations_cache TO authenticated, service_role;
