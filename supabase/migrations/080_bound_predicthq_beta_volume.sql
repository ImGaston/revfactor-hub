-- Migration 080: bound the 90-day PredictHQ beta workload per market.
--
-- The first live Tucson pass returned 329 candidates. A 300-event cap keeps
-- initial and recovery runs within a practical function window while preserving
-- the provider/high-water incremental path for later changes.

UPDATE public.revenue_market_sources
SET
  query_config = jsonb_set(query_config, '{max_events}', '300'::jsonb),
  updated_at = NOW()
WHERE source_type = 'predicthq';

