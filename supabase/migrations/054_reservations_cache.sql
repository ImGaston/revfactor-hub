-- Migration 054: Local cache for PriceLabs reservations
-- public.pricelabs_reservations_bq reads pricelabs_bq.pricelabs_reservations,
-- a BigQuery FOREIGN TABLE (wrappers FDW). The FDW resolves its credentials
-- from vault at query time as the CALLING role, so only postgres can execute
-- it — authenticated/service_role get "permission denied for schema vault".
-- It would also mean a live BigQuery round-trip per page load.
-- Fix: materialize the view into a local cache the app reads instead
-- (refresh schedule in migration 055).

-- row_key disambiguates the ~150 rows where the listings join fans out one
-- reservation_key into multiple hub listings; it also enables the unique
-- index REFRESH CONCURRENTLY requires.
CREATE MATERIALIZED VIEW public.pricelabs_reservations_cache AS
SELECT
  v.reservation_key || '|' || (
    row_number() OVER (
      PARTITION BY v.reservation_key
      ORDER BY v.hub_listing_id NULLS LAST
    )
  )::text AS row_key,
  v.*
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

-- Matviews don't support RLS; grants are the boundary. No anon access —
-- reservations carry guest names and revenue.
REVOKE ALL ON public.pricelabs_reservations_cache FROM anon;
GRANT SELECT ON public.pricelabs_reservations_cache TO authenticated, service_role;
