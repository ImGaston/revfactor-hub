-- ============================================================
-- 044: Lead outcome (Lost/Disqualified) + Microsoft Ads click id
--
-- Marketing needs a clean won/lost/open outcome to compute close rate per
-- campaign and to feed offline conversions back to the ad platforms. "Won"
-- already exists (assembly_client_id IS NOT NULL). "Lost" did not: `is_archived`
-- means "hide it from the board" (its reverse action is literally "Reactivate")
-- and can coexist with a won lead, so it cannot be overloaded as loss. This adds
-- an explicit lost signal. `msclkid` mirrors `gclid` for Microsoft/Bing Ads.
-- ============================================================

ALTER TABLE leads
  ADD COLUMN lost_at     TIMESTAMPTZ,
  ADD COLUMN lost_reason TEXT,
  ADD COLUMN msclkid     TEXT;

CREATE INDEX idx_leads_msclkid ON leads(msclkid);

-- No CHECK coupling lost_at with assembly_client_id: the API derives `outcome`
-- with won taking precedence, so the impossible "won and lost" reads as won, and
-- a hard constraint would be a new invariant the existing setters don't maintain.
