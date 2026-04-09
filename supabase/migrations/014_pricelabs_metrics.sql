-- Add PriceLabs synced metrics to listings table
ALTER TABLE listings
  ADD COLUMN pl_base_price INTEGER,
  ADD COLUMN pl_min_price INTEGER,
  ADD COLUMN pl_max_price INTEGER,
  ADD COLUMN pl_recommended_base_price INTEGER,
  ADD COLUMN pl_cleaning_fees NUMERIC(10,2),
  ADD COLUMN pl_no_of_bedrooms INTEGER,
  ADD COLUMN pl_occupancy_next_7 INTEGER,
  ADD COLUMN pl_market_occupancy_next_7 INTEGER,
  ADD COLUMN pl_occupancy_next_30 INTEGER,
  ADD COLUMN pl_market_occupancy_next_30 INTEGER,
  ADD COLUMN pl_occupancy_next_60 INTEGER,
  ADD COLUMN pl_market_occupancy_next_60 INTEGER,
  ADD COLUMN pl_occupancy_past_90 INTEGER,
  ADD COLUMN pl_market_occupancy_past_90 INTEGER,
  ADD COLUMN pl_revenue_past_7 NUMERIC(10,2),
  ADD COLUMN pl_stly_revenue_past_7 NUMERIC(10,2),
  ADD COLUMN pl_push_enabled BOOLEAN,
  ADD COLUMN pl_last_refreshed_at TIMESTAMPTZ,
  ADD COLUMN pl_synced_at TIMESTAMPTZ;

-- Allow service role to update these columns via admin client
-- (RLS already allows super_admin updates, and the cron uses admin client which bypasses RLS)

COMMENT ON COLUMN listings.pl_base_price IS 'PriceLabs base price';
COMMENT ON COLUMN listings.pl_synced_at IS 'Last time PriceLabs data was synced for this listing';
