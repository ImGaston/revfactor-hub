-- Migration 077: align the Smokies pilot with the reviewed three-city corridor.
--
-- The original Gatlinburg-centered 5-mile circle did not cover the full
-- Sevierville / Pigeon Forge / Gatlinburg operating market. Membership changes
-- remain an operational review action and are intentionally not seeded here.

UPDATE public.revenue_markets
SET
  name = 'Sevierville / Pigeon Forge / Gatlinburg, TN',
  center_lat = 35.790000,
  center_lon = -83.554300,
  radius_miles = 10.00,
  query_terms = ARRAY[
    'Sevierville',
    'Pigeon Forge',
    'Gatlinburg',
    'Great Smoky Mountains'
  ],
  updated_at = NOW()
WHERE id = '76000000-0000-4000-8000-000000000005';
