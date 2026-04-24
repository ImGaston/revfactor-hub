-- ============================================================
-- 031: Leads external_ref
-- Adds a source-tagged reference (e.g. "scheduler:<bookingId>")
-- so webhook ingests from external systems can be idempotent.
-- ============================================================

ALTER TABLE leads ADD COLUMN external_ref TEXT;

CREATE UNIQUE INDEX idx_leads_external_ref
  ON leads(external_ref)
  WHERE external_ref IS NOT NULL;
