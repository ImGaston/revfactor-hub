-- Who operates a listing day to day. 'hostpricing' (the India team) is the
-- default and the only value /monthly-summary counts; 'revfactor' listings are
-- managed internally and excluded from that summary. Covered by the existing
-- listings UPDATE policy (listings:edit) — no new RLS.
ALTER TABLE public.listings
  ADD COLUMN managed_by TEXT NOT NULL DEFAULT 'hostpricing'
  CONSTRAINT listings_managed_by_check CHECK (managed_by IN ('hostpricing', 'revfactor'));
