-- ============================================================
-- 20260909120000: `test` status for clients and listings
--
-- Internal test data (the "Info RM Test" client and Fede's test
-- listings) was `active`, so it leaked into every KPI, chart,
-- financial aggregate, wins run, and pacing average. A dedicated
-- status keeps the rows visible in the hub (lists, detail, settings,
-- pickers, PriceLabs sync) while every aggregation excludes them
-- with `.neq("status", 'test')` (see lib/status.ts TEST_STATUS).
-- ============================================================

-- ==========================================================
-- 1. Widen the CHECK constraints (002 clients, 026 listings)
-- ==========================================================
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_status_check;
ALTER TABLE clients ADD CONSTRAINT clients_status_check
  CHECK (status IN ('active', 'onboarding', 'inactive', 'test'));

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
  CHECK (status IN ('active', 'inactive', 'test'));

-- ==========================================================
-- 2. Deactivation stamp ignores test transitions
-- ==========================================================
-- Test is not churn: moving into or out of `test` must neither stamp
-- nor clear deactivated_date. The active<->inactive rules from 086
-- are unchanged. record_listing_status_event (086) is value-agnostic
-- and keeps logging every transition, including active->test.
CREATE OR REPLACE FUNCTION public.stamp_listing_deactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'test' OR OLD.status = 'test' THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'inactive' AND OLD.status = 'active' AND NEW.deactivated_date IS NULL THEN
    NEW.deactivated_date := CURRENT_DATE;
  ELSIF NEW.status = 'active' AND OLD.status = 'inactive'
        AND NEW.deactivated_date IS NOT DISTINCT FROM OLD.deactivated_date THEN
    NEW.deactivated_date := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stamp_listing_deactivation() FROM PUBLIC, anon, authenticated;

-- ==========================================================
-- 3. Data: mark the existing internal test rows
-- ==========================================================
-- The client is matched by email, never by a hardcoded uuid.
UPDATE clients
SET status = 'test'
WHERE lower(email) = 'rm@blackbirdhm.com'
  AND status <> 'test';

-- Fede's four test listings. Three are matched by their PriceLabs
-- listing_id; Wingate 300 has no PriceLabs id, so it is matched by its
-- exact hub name. They had client_id NULL (which migration 091 reads as
-- Blackbird), so they are also attached to the test client.
UPDATE listings
SET status = 'test',
    client_id = COALESCE(
      client_id,
      (SELECT id FROM clients WHERE lower(email) = 'rm@blackbirdhm.com' LIMIT 1)
    )
WHERE status <> 'test'
  AND (
    listing_id IN (
      '98b5addc-05df-41c6-be5f-a23a49330558',
      '859e5c82-8124-4f4e-873a-01f8e5f966c5',
      'a48cad05-e34a-4e5e-b1aa-520531441321'
    )
    OR name = 'Wingate 300 | Fort Worth | Fede'
  );

-- "Runner Rd | Savannah | Josh" is intentionally not touched: it is a
-- real churned listing (Josh Burdick, inactive) and keeps its history.
