\set ON_ERROR_STOP on
\ir airbnb-foundation-production-shape.sql

-- Prove PostgreSQL can roll the exact DDL back without residue.
BEGIN;
\ir ../../supabase/migrations/091_airbnb_seasonal_cancellation_foundation.sql
ROLLBACK;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'listings'
      AND column_name IN ('default_cancellation_policy', 'timezone')
  ) THEN
    RAISE EXCEPTION 'Migration rollback left listing columns behind';
  END IF;
END;
$$;

-- Reapply the unchanged migration and exercise its complete invariant matrix.
\ir ../../supabase/migrations/091_airbnb_seasonal_cancellation_foundation.sql
\ir airbnb-foundation-invariant-tests.sql
