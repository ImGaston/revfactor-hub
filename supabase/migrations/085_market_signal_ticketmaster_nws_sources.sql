-- Migration 085: register first-party Ticketmaster and NWS adapters for every
-- managed market. Credentials remain server-side; the agent enables each
-- source only when its corresponding runtime configuration exists.

INSERT INTO public.revenue_market_sources (
  market_id,
  source_type,
  name,
  source_url,
  query_config,
  trust_tier,
  cadence_minutes,
  is_active
)
SELECT
  market.id,
  'ticketmaster',
  'Ticketmaster Discovery',
  'https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/',
  '{"days_forward":180,"max_events":300,"segments":["Music","Sports","Arts & Theatre","Miscellaneous"]}'::JSONB,
  2,
  180,
  FALSE
FROM public.revenue_markets market
ON CONFLICT (market_id, source_type, name) DO UPDATE SET
  source_url = EXCLUDED.source_url,
  query_config = EXCLUDED.query_config,
  trust_tier = EXCLUDED.trust_tier,
  cadence_minutes = EXCLUDED.cadence_minutes;
INSERT INTO public.revenue_market_sources (
  market_id,
  source_type,
  name,
  source_url,
  query_config,
  trust_tier,
  cadence_minutes,
  is_active
)
SELECT
  market.id,
  'nws',
  'National Weather Service Alerts',
  'https://api.weather.gov/alerts',
  '{"max_alerts":200,"statuses":["actual"]}'::JSONB,
  1,
  15,
  FALSE
FROM public.revenue_markets market
WHERE market.country_code = 'US'
ON CONFLICT (market_id, source_type, name) DO UPDATE SET
  source_url = EXCLUDED.source_url,
  query_config = EXCLUDED.query_config,
  trust_tier = EXCLUDED.trust_tier,
  cadence_minutes = EXCLUDED.cadence_minutes;
