-- Add stripe_subscription_id to listings
-- A listing can be linked to a specific Stripe subscription.
-- Multiple listings can share the same subscription (e.g., bundled plans).
ALTER TABLE listings ADD COLUMN stripe_subscription_id TEXT;

-- Index for quick lookups by subscription
CREATE INDEX idx_listings_stripe_subscription_id ON listings(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
