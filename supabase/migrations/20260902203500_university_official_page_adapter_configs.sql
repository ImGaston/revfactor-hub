-- Migration 20260902203500: prepare the existing official university source
-- rows for the generic page adapter. This updates configuration only. Every
-- source remains inactive and registry-only; the adapter also requires the
-- separate UNIVERSITY_PAGE_INGESTION_ENABLED runtime gate.

WITH adapter_config (
  source_name,
  format,
  endpoint_path,
  endpoint_query,
  event_type,
  event_name,
  include_terms,
  exclude_terms
) AS (
  VALUES
    (
      'UConn Family Weekend', 'html', NULL::TEXT, '[]'::JSONB,
      'family_weekend', 'UConn Family Weekend',
      '["family weekend"]'::JSONB,
      '["2023", "archive", "deadline", "registration opens", "tickets on sale"]'::JSONB
    ),
    (
      'UConn Commencement', 'html', NULL::TEXT, '[]'::JSONB,
      'commencement', 'UConn Commencement',
      '["commencement", "graduation"]'::JSONB,
      '["archive", "deadline", "registration opens", "tickets on sale"]'::JSONB
    ),
    (
      'UConn Academic Calendar', 'html', NULL::TEXT, '[]'::JSONB,
      'commencement', 'UConn Commencement',
      '["commencement"]'::JSONB,
      '["archive", "deadline", "application", "registration opens"]'::JSONB
    ),
    (
      'UT Knoxville Vol Family Reunions', 'rest_html',
      '/family/wp-json/wp/v2/pages',
      '[
        {"name":"slug","value":"vol-family-reunions"},
        {"name":"_fields","value":"id,slug,modified,link,content"}
      ]'::JSONB,
      'family_weekend', 'UT Knoxville Vol Family Reunion',
      '["family reunion", "family weekend"]'::JSONB,
      '["archive", "past event", "deadline", "registration opens", "tickets on sale"]'::JSONB
    ),
    (
      'UT Knoxville Commencement', 'html', NULL::TEXT, '[]'::JSONB,
      'commencement', 'UT Knoxville Commencement',
      '["commencement", "graduation"]'::JSONB,
      '["archive", "deadline", "registration opens", "tickets on sale"]'::JSONB
    ),
    (
      'UT Knoxville Academic Calendar', 'rest_html',
      '/wp-json/academic-calendar/v1/dates',
      '[{"name":"keyword","value":"Commencement"}]'::JSONB,
      'commencement', 'UT Knoxville Commencement',
      '["commencement"]'::JSONB,
      '["archive", "deadline", "application", "registration opens"]'::JSONB
    ),
    (
      'GW Alumni & Families Weekend', 'html', NULL::TEXT, '[]'::JSONB,
      'family_weekend', 'GW Alumni & Families Weekend',
      '["families weekend", "family weekend"]'::JSONB,
      '["archive", "deadline", "registration opens", "tickets on sale"]'::JSONB
    ),
    (
      'GW Commencement', 'html', NULL::TEXT, '[]'::JSONB,
      'commencement', 'GW Commencement',
      '["commencement", "graduation"]'::JSONB,
      '["archive", "deadline", "registration opens", "tickets on sale"]'::JSONB
    ),
    (
      'GW Academic Calendar', 'html', NULL::TEXT, '[]'::JSONB,
      'commencement', 'GW Commencement',
      '["commencement"]'::JSONB,
      '["archive", "deadline", "application", "registration opens"]'::JSONB
    )
)
UPDATE public.revenue_market_sources source
SET
  query_config = source.query_config || JSONB_STRIP_NULLS(
    JSONB_BUILD_OBJECT(
      'collection_status', 'registry_only',
      'format', config.format,
      'endpoint_path', config.endpoint_path,
      'endpoint_query', config.endpoint_query,
      'match_rules', JSONB_BUILD_ARRAY(
        JSONB_BUILD_OBJECT(
          'event_type', config.event_type,
          'event_name', config.event_name,
          'include_terms', config.include_terms,
          'exclude_terms', config.exclude_terms
        )
      )
    )
  ),
  is_active = FALSE,
  updated_at = NOW()
FROM adapter_config config
WHERE source.source_type = 'official_feed'
  AND source.institution_id IS NOT NULL
  AND source.name = config.source_name;

DO $$
DECLARE
  configured_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO configured_count
  FROM public.revenue_market_sources source
  WHERE source.source_type = 'official_feed'
    AND source.institution_id IS NOT NULL
    AND source.name IN (
      'UConn Family Weekend',
      'UConn Commencement',
      'UConn Academic Calendar',
      'UT Knoxville Vol Family Reunions',
      'UT Knoxville Commencement',
      'UT Knoxville Academic Calendar',
      'GW Alumni & Families Weekend',
      'GW Commencement',
      'GW Academic Calendar'
    )
    AND source.query_config->>'collection_status' = 'registry_only'
    AND JSONB_ARRAY_LENGTH(source.query_config->'match_rules') = 1
    AND source.is_active = FALSE;

  IF configured_count <> 9 THEN
    RAISE EXCEPTION
      'Expected 9 inactive university source configurations, found %',
      configured_count;
  END IF;
END;
$$;

COMMENT ON COLUMN public.revenue_market_sources.query_config IS
  'Provider-specific bounded query configuration. Official university pages require registry review, explicit match rules, official-domain URL validation, per-source activation, and a separate runtime flag.';
