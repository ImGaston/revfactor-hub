-- ============================================================
-- 20260928120000: clients.billing_entity (RevFactor vs Blackbird)
--
-- Blackbird Hospitality listings are billed separately by the India
-- team, so portfolio reports (Monthly Summary, dashboard evolution)
-- must tell them apart from RevFactor's. Blackbird lives as a client
-- row ("Blackbird Hospitality (internal)", status `test`) whose
-- listings are `active`, so status alone cannot separate them.
--
-- A listing is Blackbird when its client has billing_entity =
-- 'blackbird' OR it has no client (the migration-091 rule).
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS billing_entity TEXT NOT NULL DEFAULT 'revfactor';

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_billing_entity_check;
ALTER TABLE clients ADD CONSTRAINT clients_billing_entity_check
  CHECK (billing_entity IN ('revfactor', 'blackbird'));

-- Matched by email, never by a hardcoded uuid (same as the test-status migration).
UPDATE clients
SET billing_entity = 'blackbird'
WHERE lower(email) = 'rm@blackbirdhm.com'
  AND billing_entity <> 'blackbird';

-- clients_basic (038) gains the non-sensitive classification so roles
-- without clients:view (hostpricing) can split Monthly Summary too.
-- Appending a column keeps the definer owner and grants.
CREATE OR REPLACE VIEW public.clients_basic AS
  SELECT id, name, status, billing_entity FROM public.clients;
