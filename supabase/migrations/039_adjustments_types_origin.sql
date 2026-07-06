-- Adjustments spec v0.1: rename tag -> type, widen to 12 values, add origin.
-- Existing 7 values map 1:1 into the new enum; no data backfill needed.

ALTER TABLE adjustments RENAME COLUMN tag TO type;

-- RENAME COLUMN keeps the stale constraint name and the value list must widen anyway
ALTER TABLE adjustments DROP CONSTRAINT adjustments_tag_check;
ALTER TABLE adjustments ADD CONSTRAINT adjustments_type_check
  CHECK (type IN (
    'setup', 'min_stay', 'price', 'min_price', 'max_price', 'target_payout',
    'checkin_checkout', 'discount', 'markup_fees', 'availability', 'review', 'other'
  ));

-- Where the request came from: owner/client, RevFactor, or a HostPricing proposal
ALTER TABLE adjustments ADD COLUMN origin TEXT NOT NULL DEFAULT 'internal'
  CHECK (origin IN ('client', 'internal', 'hostpricing'));
