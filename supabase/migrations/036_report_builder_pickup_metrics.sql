-- Report Builder: 10 new monthly metrics added to the PriceLabs report template.
-- Same grain as the rest of report_metrics (listing × month × run). All nullable
-- so historical runs (which never carried these) stay valid.
--
--   Market Penetration Index %               -> market_penetration_index_pct
--   Booked Nights Pickup (7/14/30 Days)      -> booked_nights_pickup_{7,14,30}d   (cumulative windows)
--   Occupancy Pickup (7d / 8-14 / 15-30)     -> occupancy_pickup_{7d,8_14d,15_30d} (bucketed windows)
--   Rental Revenue Pickup (7d / 8-14 / 15-30)-> rental_revenue_pickup_{7d,8_14d,15_30d} (bucketed windows)

ALTER TABLE report_metrics
  ADD COLUMN IF NOT EXISTS market_penetration_index_pct  NUMERIC(7,2),   -- occupancy-based penetration index (distinct from revpar_index)
  -- Booked nights gained in the trailing window (nights; can be negative on cancellations)
  ADD COLUMN IF NOT EXISTS booked_nights_pickup_7d        NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS booked_nights_pickup_14d       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS booked_nights_pickup_30d       NUMERIC(10,2),
  -- Occupancy points gained, bucketed windows (percentage points)
  ADD COLUMN IF NOT EXISTS occupancy_pickup_7d            NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS occupancy_pickup_8_14d         NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS occupancy_pickup_15_30d        NUMERIC(7,2),
  -- Rental revenue gained, bucketed windows (money)
  ADD COLUMN IF NOT EXISTS rental_revenue_pickup_7d       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS rental_revenue_pickup_8_14d    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS rental_revenue_pickup_15_30d   NUMERIC(12,2);
