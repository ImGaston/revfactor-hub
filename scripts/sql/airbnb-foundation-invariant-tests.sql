\set ON_ERROR_STOP on

CREATE SCHEMA test;
CREATE OR REPLACE FUNCTION test.expect_error(statement TEXT, expected_state TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected_state THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Expected SQLSTATE %, got %: %', expected_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE %, but statement succeeded: %', expected_state, statement;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    (SELECT * FROM policy_snapshot EXCEPT SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('listings','adjustments'))
    UNION ALL
    (SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('listings','adjustments') EXCEPT SELECT * FROM policy_snapshot)
  ) THEN
    RAISE EXCEPTION 'Existing listings/adjustments RLS policies changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM grant_snapshot s
    WHERE s.allowed IS DISTINCT FROM has_table_privilege(
      s.role_name,
      'public.' || s.table_name,
      s.privilege
    )
  ) THEN
    RAISE EXCEPTION 'Existing listings/adjustments grants changed';
  END IF;
END;
$$;

-- Legacy rows remain valid and NULL foundation fields fail closed.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.listings WHERE default_cancellation_policy IS NULL AND timezone IS NULL) <> 2 THEN
    RAISE EXCEPTION 'Legacy listing compatibility failed';
  END IF;
  IF (SELECT count(*) FROM public.adjustments) <> 2 THEN
    RAISE EXCEPTION 'Legacy adjustment compatibility failed';
  END IF;
END;
$$;

-- Portfolio ownership and row shape.
SELECT test.expect_error(
  $$INSERT INTO public.adjustments (scope, client_id, listing_id)
    VALUES ('portfolio', NULL, NULL)$$,
  '23514'
);
SELECT test.expect_error(
  $$INSERT INTO public.adjustments (scope, client_id, listing_id)
    VALUES ('portfolio', '00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000101')$$,
  '23514'
);

-- Single-listing RevFactor adjustments require the exact listing client.
SELECT test.expect_error(
  $$INSERT INTO public.adjustments (scope, client_id, listing_id)
    VALUES ('single_listing', NULL, NULL)$$,
  '23514'
);
SELECT test.expect_error(
  $$INSERT INTO public.adjustments (scope, client_id, listing_id)
    VALUES ('single_listing', NULL,
      '00000000-0000-0000-0000-000000000101')$$,
  '23514'
);
SELECT test.expect_error(
  $$INSERT INTO public.adjustments (scope, client_id, listing_id)
    VALUES ('single_listing', '00000000-0000-0000-0000-000000000020',
      '00000000-0000-0000-0000-000000000101')$$,
  '23514'
);
INSERT INTO public.adjustments (scope, client_id, listing_id)
VALUES (
  'single_listing',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000101'
);

-- A Blackbird single-listing adjustment is the only valid NULL-client row.
INSERT INTO public.adjustments (scope, client_id, listing_id)
VALUES (
  'single_listing',
  NULL,
  '00000000-0000-0000-0000-000000000102'
);
SELECT test.expect_error(
  $$INSERT INTO public.adjustments (scope, client_id, listing_id)
    VALUES ('single_listing', '00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-000000000102')$$,
  '23514'
);

-- Listing reclassification cannot silently invalidate existing Adjustments.
SELECT test.expect_error(
  $$UPDATE public.listings
    SET client_id = '00000000-0000-0000-0000-000000000020'
    WHERE id = '00000000-0000-0000-0000-000000000101'$$,
  '23514'
);

-- A deliberately deferred, coordinated transaction may move both sides.
BEGIN;
SET CONSTRAINTS adjustments_listing_client_match,
  listings_adjustment_client_match DEFERRED;
UPDATE public.listings
SET client_id = '00000000-0000-0000-0000-000000000020'
WHERE id = '00000000-0000-0000-0000-000000000101';
UPDATE public.adjustments
SET client_id = '00000000-0000-0000-0000-000000000020'
WHERE listing_id = '00000000-0000-0000-0000-000000000101';
COMMIT;

-- Canonical policy vocabulary, IANA timezone validation, and NULL support.
DO $$
DECLARE
  policy_value TEXT;
BEGIN
  FOREACH policy_value IN ARRAY ARRAY[
    'flexible', 'moderate', 'limited', 'firm', 'strict',
    'super_strict_30', 'super_strict_60'
  ] LOOP
    UPDATE public.listings
    SET default_cancellation_policy = policy_value
    WHERE id = '00000000-0000-0000-0000-000000000101';
  END LOOP;
END;
$$;

UPDATE public.listings
SET default_cancellation_policy = 'flexible', timezone = 'America/New_York'
WHERE id = '00000000-0000-0000-0000-000000000101';
UPDATE public.listings
SET default_cancellation_policy = 'super_strict_60', timezone = 'UTC'
WHERE id = '00000000-0000-0000-0000-000000000102';
SELECT test.expect_error(
  $$UPDATE public.listings SET default_cancellation_policy = 'unknown'
    WHERE id = '00000000-0000-0000-0000-000000000101'$$,
  '23514'
);
SELECT test.expect_error(
  $$UPDATE public.listings SET timezone = 'Eastern-ish'
    WHERE id = '00000000-0000-0000-0000-000000000101'$$,
  '23514'
);
UPDATE public.listings
SET default_cancellation_policy = NULL, timezone = NULL
WHERE id = '00000000-0000-0000-0000-000000000102';

-- New rows with populated fields are audited; fail-closed NULL inserts are not.
INSERT INTO public.listings (
  id, client_id, name, airbnb_id, default_cancellation_policy, timezone
) VALUES (
  '00000000-0000-0000-0000-000000000103',
  NULL,
  'New inventoried Blackbird listing',
  '103',
  'firm',
  'America/Los_Angeles'
);
INSERT INTO public.listings (id, client_id, name, airbnb_id) VALUES (
  '00000000-0000-0000-0000-000000000104',
  NULL,
  'New unverified Blackbird listing',
  '104'
);

-- The audit is append-only for API roles and records only relevant changes.
DO $$
DECLARE
  before_count BIGINT;
BEGIN
  SELECT count(*) INTO before_count FROM public.listing_airbnb_settings_audit;
  UPDATE public.listings SET name = name || ' renamed'
  WHERE id = '00000000-0000-0000-0000-000000000101';
  IF (SELECT count(*) FROM public.listing_airbnb_settings_audit) <> before_count THEN
    RAISE EXCEPTION 'Unrelated listing update wrote an Airbnb settings audit row';
  END IF;

  IF before_count <> 11 THEN
    RAISE EXCEPTION 'Expected 11 field-change audit rows, found %', before_count;
  END IF;
END;
$$;

SET app.test_permission = 'false';
SET ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.listing_airbnb_settings_audit) <> 0 THEN
    RAISE EXCEPTION 'Audit RLS exposed rows without listings:view';
  END IF;
END;
$$;
RESET ROLE;

SET app.test_permission = 'true';
SET ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.listing_airbnb_settings_audit) <> 11 THEN
    RAISE EXCEPTION 'Audit RLS hid rows from listings:view';
  END IF;

  BEGIN
    INSERT INTO public.listing_airbnb_settings_audit (
      listing_id, listing_name, change_source
    ) VALUES (
      '00000000-0000-0000-0000-000000000999', 'forbidden', 'test'
    );
    RAISE EXCEPTION 'Authenticated insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.listing_airbnb_settings_audit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.listing_airbnb_settings_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.listing_airbnb_settings_audit', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.listing_airbnb_settings_audit', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.listing_airbnb_settings_audit', 'SELECT')
     OR has_table_privilege('service_role', 'public.listing_airbnb_settings_audit', 'INSERT')
     OR has_table_privilege('anon', 'public.listing_airbnb_settings_audit', 'SELECT') THEN
    RAISE EXCEPTION 'Audit grants are not append-only as designed';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.listing_airbnb_settings_audit'::regclass) THEN
    RAISE EXCEPTION 'Audit RLS is not enabled';
  END IF;
END;
$$;

SELECT 'all_airbnb_foundation_invariants_passed' AS result;
