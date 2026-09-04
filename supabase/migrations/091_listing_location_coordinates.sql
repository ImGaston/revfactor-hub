-- Store non-address listing coordinates from PriceLabs for market mapping.
-- Coordinates are operational geography, not public listing content.
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS location_latitude NUMERIC(9, 6)
    CHECK (location_latitude IS NULL OR location_latitude BETWEEN -90 AND 90),
  ADD COLUMN IF NOT EXISTS location_longitude NUMERIC(9, 6)
    CHECK (location_longitude IS NULL OR location_longitude BETWEEN -180 AND 180),
  ADD COLUMN IF NOT EXISTS location_source TEXT
    CHECK (location_source IS NULL OR location_source IN ('pricelabs', 'manual', 'geocoded')),
  ADD COLUMN IF NOT EXISTS location_observed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.listings.location_latitude IS 'Private operational coordinate used for market assignment and map visualization.';
COMMENT ON COLUMN public.listings.location_longitude IS 'Private operational coordinate used for market assignment and map visualization.';
COMMENT ON COLUMN public.listings.location_source IS 'Provenance for the stored operational coordinates.';
COMMENT ON COLUMN public.listings.location_observed_at IS 'Timestamp when the coordinate was observed from its source.';
