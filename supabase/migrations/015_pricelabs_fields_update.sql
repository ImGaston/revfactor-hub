-- Remove columns not returned by PriceLabs /listings API
ALTER TABLE listings
  DROP COLUMN IF EXISTS pl_occupancy_next_60,
  DROP COLUMN IF EXISTS pl_market_occupancy_next_60,
  DROP COLUMN IF EXISTS pl_revenue_past_7,
  DROP COLUMN IF EXISTS pl_stly_revenue_past_7;

-- Add new fields from PriceLabs API
ALTER TABLE listings
  ADD COLUMN pl_mpi_next_30 NUMERIC(4,2),
  ADD COLUMN pl_mpi_next_60 NUMERIC(4,2),
  ADD COLUMN pl_last_booked_date TIMESTAMPTZ,
  ADD COLUMN pl_wknd_occupancy_next_30 INTEGER,
  ADD COLUMN pl_market_wknd_occupancy_next_30 INTEGER;

COMMENT ON COLUMN listings.pl_mpi_next_30 IS 'Market Performance Index 30-day (listing occ / market occ)';
COMMENT ON COLUMN listings.pl_mpi_next_60 IS 'Market Performance Index 60-day';
COMMENT ON COLUMN listings.pl_last_booked_date IS 'Last booked date from PriceLabs';
COMMENT ON COLUMN listings.pl_wknd_occupancy_next_30 IS 'Weekend adjusted occupancy next 30 nights';
COMMENT ON COLUMN listings.pl_market_wknd_occupancy_next_30 IS 'Market weekend adjusted occupancy next 30 nights';
