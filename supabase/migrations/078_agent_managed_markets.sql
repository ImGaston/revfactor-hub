-- Migration 078: make market footprint management an agent responsibility.
--
-- Human review remains required for commercial recommendations. Coordinate-
-- matched market membership and monitoring readiness can be agent-managed.

ALTER TABLE public.revenue_markets
  ADD COLUMN management_mode TEXT NOT NULL DEFAULT 'agent'
  CHECK (management_mode IN ('agent', 'human'));

ALTER TABLE public.revenue_market_listings
  ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'human'
  CHECK (approval_mode IN ('agent', 'human'));

ALTER TABLE public.revenue_markets
  DROP CONSTRAINT revenue_markets_check;

ALTER TABLE public.revenue_markets
  ADD CONSTRAINT revenue_markets_activation_check CHECK (
    status <> 'active'
    OR management_mode = 'agent'
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  );

ALTER TABLE public.revenue_market_listings
  DROP CONSTRAINT revenue_market_listings_check;

ALTER TABLE public.revenue_market_listings
  ADD CONSTRAINT revenue_market_listings_approval_check CHECK (
    membership_status <> 'approved'
    OR approval_mode = 'agent'
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  );

UPDATE public.revenue_market_listings
SET
  membership_status = 'approved',
  approval_mode = 'agent'
WHERE membership_status = 'proposed';

UPDATE public.revenue_markets
SET
  status = 'active',
  management_mode = 'agent',
  updated_at = NOW()
WHERE status = 'draft';

