-- Where listing content is actually managed. When a channel manager (Guesty,
-- Hostaway, Hospitable...) syncs content to Airbnb, accepted changes must be
-- applied there, or the next sync overwrites them.
ALTER TABLE listing_optimization_reports
  ADD COLUMN IF NOT EXISTS channel_manager TEXT;

COMMENT ON COLUMN listing_optimization_reports.channel_manager IS
  'PMS/channel manager that syncs this listing''s content to Airbnb (null = edited directly in Airbnb).';
