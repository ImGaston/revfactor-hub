-- Migration 071: Adjustments as the HostPricing <-> internal ticket channel
--   * 3 new type values for HostPricing's underperforming-listing reviews
--     (visibility, blocked_dates, pricing_flexibility)
--   * signals JSONB: manually-entered report metrics (Airbnb impressions,
--     Rankbreeze, visibility index, conversion, pace, occupancy vs market).
--     Display-only context, never queried — values are free-form strings,
--     validated app-side; keys documented in lib/adjustments.ts
--     ADJUSTMENT_SIGNAL_FIELDS
--   * suggested_actions TEXT[]: known suggestion slugs (top15_discount,
--     mobile_discount, flexible_cancellation) plus free-text entries
--
-- Blocked-dates tickets reuse the existing date_from/date_to columns; the
-- context lives in target_value / origin_message — no new column.
--
-- No RLS changes: the new columns live on adjustments and inherit its row
-- policies. The public share page (/a/<token>) keeps them out via its
-- explicit column projection — do NOT add them there.

ALTER TABLE adjustments DROP CONSTRAINT adjustments_type_check;
ALTER TABLE adjustments ADD CONSTRAINT adjustments_type_check
  CHECK (type IN (
    'setup', 'min_stay', 'price', 'min_price', 'max_price', 'target_payout',
    'checkin_checkout', 'discount', 'markup_fees', 'availability', 'review',
    'recommendation', 'visibility', 'blocked_dates', 'pricing_flexibility',
    'other'
  ));

ALTER TABLE adjustments
  ADD COLUMN signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN suggested_actions TEXT[] NOT NULL DEFAULT '{}';
