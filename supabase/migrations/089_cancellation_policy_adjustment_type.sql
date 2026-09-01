-- Add cancellation policy as a first-class adjustment type.

ALTER TABLE adjustments DROP CONSTRAINT adjustments_type_check;
ALTER TABLE adjustments ADD CONSTRAINT adjustments_type_check
  CHECK (type IN (
    'setup', 'min_stay', 'price', 'min_price', 'max_price', 'target_payout',
    'checkin_checkout', 'discount', 'markup_fees', 'availability', 'review',
    'recommendation', 'visibility', 'blocked_dates', 'pricing_flexibility',
    'cancellation_policy', 'other'
  ));

INSERT INTO adjustment_type_settings (type, internal_enabled, hostpricing_enabled)
VALUES ('cancellation_policy', TRUE, TRUE)
ON CONFLICT (type) DO NOTHING;
