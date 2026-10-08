-- Migration 20260902203100: add College Football Data as a normalized Market Signals
-- provider. The API credential stays in the server runtime; only team-specific
-- query configuration is stored in the database.

ALTER TABLE public.revenue_market_sources
  DROP CONSTRAINT IF EXISTS revenue_market_sources_source_type_check;

ALTER TABLE public.revenue_market_sources
  ADD CONSTRAINT revenue_market_sources_source_type_check CHECK (
    source_type IN (
      'official_feed', 'ticketmaster', 'cfbd', 'nws', 'gdelt',
      'predicthq', 'google_news', 'curated'
    )
  );

-- Arizona Stadium sits inside the Tucson market. Other college programs are
-- registered only after their property market and source radius are confirmed;
-- this prevents away games or unrelated campuses from becoming false signals.
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
  'cfbd',
  'College Football Data — Arizona Wildcats',
  'https://collegefootballdata.com/',
  '{
    "team":"Arizona",
    "days_forward":370,
    "max_games":40,
    "home_only":true,
    "official_schedule_url":"https://arizonawildcats.com/sports/football/schedule"
  }'::JSONB,
  2,
  360,
  FALSE
FROM public.revenue_markets market
WHERE market.slug = 'tucson-az'
ON CONFLICT (market_id, source_type, name) DO UPDATE SET
  source_url = EXCLUDED.source_url,
  query_config = EXCLUDED.query_config,
  trust_tier = EXCLUDED.trust_tier,
  cadence_minutes = EXCLUDED.cadence_minutes;
