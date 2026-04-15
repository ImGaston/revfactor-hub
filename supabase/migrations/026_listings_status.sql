-- Add status to listings (active = visible in clients/listings, inactive = hidden, only visible in Settings > Listings)
ALTER TABLE listings
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive'));

CREATE INDEX idx_listings_status ON listings(status);
