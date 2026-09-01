-- RF-AUTO-002: data foundation for a future Airbnb seasonal-cancellation skill.
--
-- This migration is additive and deliberately leaves every listing policy and
-- timezone NULL until an operator positively verifies the Airbnb listing. It
-- creates no Adjustment, schedule, notification, reservation read, or Airbnb
-- write path.

-- ==========================================================
-- 1. Listing-level, fail-closed defaults
-- ==========================================================
ALTER TABLE public.listings
  ADD COLUMN default_cancellation_policy TEXT,
  ADD COLUMN timezone TEXT;

ALTER TABLE public.listings
  ADD CONSTRAINT listings_default_cancellation_policy_check
  CHECK (
    default_cancellation_policy IS NULL
    OR default_cancellation_policy IN (
      'flexible',
      'moderate',
      'limited',
      'firm',
      'strict',
      'super_strict_30',
      'super_strict_60'
    )
  ) NOT VALID;

-- PostgreSQL exposes the installed IANA tz database through
-- pg_timezone_names. Keep the column as TEXT so tzdata additions do not
-- require an enum migration, while still rejecting unknown identifiers.
CREATE FUNCTION public.is_valid_iana_timezone(value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names
    WHERE name = value
  );
$$;

REVOKE ALL ON FUNCTION public.is_valid_iana_timezone(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_iana_timezone(TEXT)
  TO authenticated, service_role;

ALTER TABLE public.listings
  ADD CONSTRAINT listings_timezone_iana_check
  CHECK (timezone IS NULL OR public.is_valid_iana_timezone(timezone))
  NOT VALID;

ALTER TABLE public.listings
  VALIDATE CONSTRAINT listings_default_cancellation_policy_check;
ALTER TABLE public.listings
  VALIDATE CONSTRAINT listings_timezone_iana_check;

-- Supports the future onboarding/escalation inventory without indexing every
-- populated policy/timezone value.
CREATE INDEX idx_listings_active_airbnb_foundation_missing
  ON public.listings (id)
  WHERE status = 'active'
    AND (default_cancellation_policy IS NULL OR timezone IS NULL);

-- ==========================================================
-- 2. Adjustment ownership invariant
-- ==========================================================
-- Fail before relaxing the legacy NOT NULL if production contains any row
-- that cannot satisfy the new cross-table rule.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.adjustments a
    LEFT JOIN public.listings l ON l.id = a.listing_id
    WHERE
      (a.scope = 'portfolio' AND (a.client_id IS NULL OR a.listing_id IS NOT NULL))
      OR
      (a.scope = 'single_listing' AND (
        a.listing_id IS NULL
        OR l.id IS NULL
        OR a.client_id IS DISTINCT FROM l.client_id
      ))
  ) THEN
    RAISE EXCEPTION
      'Cannot install RF-AUTO-002: existing adjustment ownership invariant violation'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.adjustments
  ALTER COLUMN client_id DROP NOT NULL;

-- Declarative row-shape constraint: portfolio rows always belong to a client
-- and never point at one listing; single-listing rows always reference one.
ALTER TABLE public.adjustments
  ADD CONSTRAINT adjustments_scope_ownership_shape_check
  CHECK (
    (scope = 'portfolio' AND client_id IS NOT NULL AND listing_id IS NULL)
    OR
    (scope = 'single_listing' AND listing_id IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public.adjustments
  VALIDATE CONSTRAINT adjustments_scope_ownership_shape_check;

CREATE FUNCTION public.enforce_adjustment_listing_client_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  referenced_client_id UUID;
BEGIN
  IF NEW.scope <> 'single_listing' THEN
    RETURN NEW;
  END IF;

  SELECT l.client_id
  INTO referenced_client_id
  FROM public.listings l
  WHERE l.id = NEW.listing_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Single-listing adjustment references a missing listing'
      USING ERRCODE = '23503',
            CONSTRAINT = 'adjustments_listing_id_fkey';
  END IF;

  IF NEW.client_id IS DISTINCT FROM referenced_client_id THEN
    RAISE EXCEPTION
      'Adjustment client must exactly match the referenced listing client'
      USING ERRCODE = '23514',
            CONSTRAINT = 'adjustments_listing_client_match';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_adjustment_listing_client_match()
  FROM PUBLIC;

CREATE CONSTRAINT TRIGGER adjustments_listing_client_match
  AFTER INSERT OR UPDATE OF scope, client_id, listing_id
  ON public.adjustments
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_adjustment_listing_client_match();

-- Preserve the invariant when a listing moves between RevFactor and
-- Blackbird classification. Deferrability permits a controlled transaction to
-- update the listing and its open Adjustment rows together when necessary.
CREATE FUNCTION public.enforce_listing_adjustment_client_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.adjustments a
    WHERE a.listing_id = NEW.id
      AND a.scope = 'single_listing'
      AND a.client_id IS DISTINCT FROM NEW.client_id
  ) THEN
    RAISE EXCEPTION
      'Listing client change would invalidate a referenced Adjustment'
      USING ERRCODE = '23514',
            CONSTRAINT = 'listings_adjustment_client_match';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_listing_adjustment_client_match()
  FROM PUBLIC;

CREATE CONSTRAINT TRIGGER listings_adjustment_client_match
  AFTER UPDATE OF client_id
  ON public.listings
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_listing_adjustment_client_match();

CREATE INDEX idx_adjustments_listing_id
  ON public.adjustments (listing_id)
  WHERE listing_id IS NOT NULL;

-- ==========================================================
-- 3. Immutable field-change audit
-- ==========================================================
CREATE TABLE public.listing_airbnb_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL,
  listing_name TEXT NOT NULL,
  client_id UUID,
  old_default_cancellation_policy TEXT,
  new_default_cancellation_policy TEXT,
  old_timezone TEXT,
  new_timezone TEXT,
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  change_source TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT listing_airbnb_settings_audit_changed_check CHECK (
    old_default_cancellation_policy IS DISTINCT FROM new_default_cancellation_policy
    OR old_timezone IS DISTINCT FROM new_timezone
  ),
  CONSTRAINT listing_airbnb_settings_audit_source_check CHECK (
    length(change_source) BETWEEN 1 AND 120
  )
);

CREATE INDEX idx_listing_airbnb_settings_audit_listing
  ON public.listing_airbnb_settings_audit (listing_id, changed_at DESC);

ALTER TABLE public.listing_airbnb_settings_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view listing Airbnb settings audit"
  ON public.listing_airbnb_settings_audit
  FOR SELECT TO authenticated
  USING (public.has_permission('listings', 'view'));

-- The trigger is the only writer. Retain the UUID/name/client snapshot even if
-- the listing or client is later removed; the ledger is evidence, not a join.
REVOKE ALL ON public.listing_airbnb_settings_audit FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.listing_airbnb_settings_audit
  FROM authenticated, service_role;
GRANT SELECT ON public.listing_airbnb_settings_audit
  TO authenticated, service_role;

CREATE FUNCTION public.audit_listing_airbnb_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  source_name TEXT;
  previous_policy TEXT;
  previous_timezone TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_policy := OLD.default_cancellation_policy;
    previous_timezone := OLD.timezone;
    IF NEW.default_cancellation_policy IS NOT DISTINCT FROM previous_policy
       AND NEW.timezone IS NOT DISTINCT FROM previous_timezone THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.default_cancellation_policy IS NULL AND NEW.timezone IS NULL THEN
    RETURN NEW;
  END IF;

  source_name := NULLIF(
    current_setting('app.listing_policy_change_source', TRUE),
    ''
  );
  source_name := COALESCE(
    source_name,
    CASE WHEN auth.uid() IS NULL THEN 'database' ELSE 'hub-settings' END
  );

  INSERT INTO public.listing_airbnb_settings_audit (
    listing_id,
    listing_name,
    client_id,
    old_default_cancellation_policy,
    new_default_cancellation_policy,
    old_timezone,
    new_timezone,
    changed_by,
    change_source
  ) VALUES (
    NEW.id,
    NEW.name,
    NEW.client_id,
    previous_policy,
    NEW.default_cancellation_policy,
    previous_timezone,
    NEW.timezone,
    auth.uid(),
    left(source_name, 120)
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_listing_airbnb_settings() FROM PUBLIC;

CREATE TRIGGER trg_audit_listing_airbnb_settings
  AFTER INSERT OR UPDATE OF default_cancellation_policy, timezone
  ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_listing_airbnb_settings();
