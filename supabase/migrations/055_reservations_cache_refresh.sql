-- Migration 055: Hourly refresh of the reservations cache (migration 054).
-- pg_cron jobs run as the role that scheduled them (postgres), which is the
-- only role able to query the BigQuery foreign table behind
-- pricelabs_reservations_bq. The BQ source refreshes daily around 02:20 UTC;
-- hourly keeps the cache close without meaningful cost (~31k rows).

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'refresh_pricelabs_reservations_cache',
  '30 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.pricelabs_reservations_cache$$
);
