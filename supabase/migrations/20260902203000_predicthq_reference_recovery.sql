-- Migration 20260902203000: retire PredictHQ from automatic ingestion while preserving its
-- historical provider records as a measurable source-recovery backlog.

UPDATE public.revenue_market_sources
SET is_active = FALSE
WHERE source_type = 'predicthq';

CREATE OR REPLACE VIEW public.market_event_source_recovery
WITH (security_invoker = TRUE) AS
WITH provider_coverage AS (
  SELECT
    provider.event_id,
    MIN(provider.first_observed_at) FILTER (
      WHERE source.source_type = 'predicthq'
    ) AS predicthq_first_observed_at,
    MAX(provider.last_observed_at) FILTER (
      WHERE source.source_type = 'predicthq'
    ) AS predicthq_last_observed_at,
    ARRAY_AGG(DISTINCT source.source_type ORDER BY source.source_type) AS source_types,
    ARRAY_AGG(DISTINCT source.source_type ORDER BY source.source_type) FILTER (
      WHERE source.source_type <> 'predicthq'
    ) AS replacement_source_types,
    BOOL_OR(source.source_type <> 'predicthq') AS has_replacement
  FROM public.market_event_provider_records provider
  JOIN public.revenue_market_sources source ON source.id = provider.source_id
  GROUP BY provider.event_id
  HAVING BOOL_OR(source.source_type = 'predicthq')
),
market_coverage AS (
  SELECT
    impact.event_id,
    ARRAY_AGG(DISTINCT market.name ORDER BY market.name) AS market_names
  FROM public.market_event_impacts impact
  JOIN public.revenue_markets market ON market.id = impact.market_id
  GROUP BY impact.event_id
)
SELECT
  event.id AS event_id,
  event.title,
  event.category,
  event.state,
  event.start_at,
  event.end_at,
  event.city,
  event.region,
  event.country_code,
  coverage.predicthq_first_observed_at,
  coverage.predicthq_last_observed_at,
  coverage.source_types,
  COALESCE(coverage.replacement_source_types, ARRAY[]::TEXT[]) AS replacement_source_types,
  COALESCE(markets.market_names, ARRAY[]::TEXT[]) AS market_names,
  CASE
    WHEN coverage.has_replacement THEN 'recovered'
    ELSE 'pending'
  END AS recovery_status
FROM provider_coverage coverage
JOIN public.market_events event ON event.id = coverage.event_id
LEFT JOIN market_coverage markets ON markets.event_id = event.id;

COMMENT ON VIEW public.market_event_source_recovery IS
  'PredictHQ reference events and whether an independent provider has recovered the same canonical event.';

REVOKE ALL ON public.market_event_source_recovery FROM PUBLIC;
GRANT SELECT ON public.market_event_source_recovery TO authenticated;
