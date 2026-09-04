-- Multi-business onboarding groups and per-property billing accounts (UNAPPLIED).
--
-- This migration extends the inert RF-AUTO-001 checkout ledger. It does not
-- enable a route, worker, Stripe integration, GHL workflow, or Assembly worker.

CREATE TABLE public.onboarding_commercial_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_key TEXT NOT NULL UNIQUE CHECK (external_key ~ '^rfg_[a-f0-9]{32,64}$'),
  highlevel_location_id TEXT NOT NULL,
  highlevel_contact_id TEXT NOT NULL,
  signer_name TEXT NOT NULL CHECK (char_length(btrim(signer_name)) BETWEEN 2 AND 255),
  signer_email TEXT NOT NULL CHECK (signer_email = lower(btrim(signer_email)) AND signer_email LIKE '%_@_%._%'),
  billing_mode TEXT NOT NULL CHECK (billing_mode IN ('single', 'separate_per_listing')),
  total_listing_count INTEGER NOT NULL CHECK (total_listing_count BETWEEN 1 AND 5),
  billing_account_count INTEGER NOT NULL CHECK (billing_account_count BETWEEN 1 AND 5),
  pricing_program TEXT NOT NULL CHECK (pricing_program IN ('Regular', 'Referral')),
  onboarding_fee_total_cents INTEGER NOT NULL CHECK (onboarding_fee_total_cents = 15000),
  currency TEXT NOT NULL CHECK (currency = 'usd'),
  tax_policy TEXT NOT NULL DEFAULT 'policy_blocked'
    CHECK (tax_policy IN ('policy_blocked', 'configured_no_collection')),
  state TEXT NOT NULL DEFAULT 'agreement_pending'
    CHECK (state IN (
      'agreement_pending', 'payment_pending', 'partially_complete',
      'commercial_complete', 'onboarding_unlocked', 'manual_review',
      'superseded', 'cancelled'
    )),
  client_id UUID REFERENCES public.clients(id) ON DELETE RESTRICT,
  onboarding_run_id UUID UNIQUE REFERENCES public.onboarding_runs(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (billing_mode = 'single' AND billing_account_count = 1)
    OR (billing_mode = 'separate_per_listing' AND billing_account_count = total_listing_count)
  )
);

CREATE UNIQUE INDEX onboarding_commercial_groups_one_active_contact
  ON public.onboarding_commercial_groups (highlevel_location_id, highlevel_contact_id)
  WHERE state NOT IN ('superseded', 'cancelled');

CREATE TABLE public.onboarding_billing_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.onboarding_commercial_groups(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 5),
  highlevel_opportunity_id TEXT UNIQUE,
  legal_business_name TEXT NOT NULL CHECK (char_length(btrim(legal_business_name)) BETWEEN 2 AND 255),
  normalized_legal_business_name TEXT NOT NULL CHECK (char_length(normalized_legal_business_name) BETWEEN 2 AND 255),
  listing_quantity INTEGER NOT NULL CHECK (listing_quantity BETWEEN 1 AND 5),
  pricing_program TEXT NOT NULL CHECK (pricing_program IN ('Regular', 'Referral')),
  monthly_rate_cents INTEGER NOT NULL CHECK (monthly_rate_cents IN (32000, 35000)),
  monthly_amount_cents INTEGER NOT NULL CHECK (monthly_amount_cents > 0),
  onboarding_fee_cents INTEGER NOT NULL CHECK (onboarding_fee_cents BETWEEN 3000 AND 15000),
  initial_checkout_total_cents INTEGER NOT NULL CHECK (initial_checkout_total_cents > 0),
  state TEXT NOT NULL DEFAULT 'agreement_pending'
    CHECK (state IN (
      'agreement_pending', 'agreement_signed', 'payment_pending',
      'payment_verified', 'complete', 'manual_review', 'superseded', 'cancelled'
    )),
  agreement_entitlement_id UUID UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (group_id, sequence),
  UNIQUE (group_id, normalized_legal_business_name),
  CHECK (monthly_amount_cents = monthly_rate_cents * listing_quantity),
  CHECK (initial_checkout_total_cents = monthly_amount_cents + onboarding_fee_cents),
  CHECK (
    (pricing_program = 'Regular' AND monthly_rate_cents = 35000)
    OR (pricing_program = 'Referral' AND monthly_rate_cents = 32000)
  )
);

ALTER TABLE public.agreement_entitlements
  DROP CONSTRAINT IF EXISTS agreement_entitlements_onboarding_fee_cents_check,
  DROP CONSTRAINT IF EXISTS agreement_entitlements_onboarding_run_id_key,
  ADD COLUMN onboarding_group_id UUID REFERENCES public.onboarding_commercial_groups(id) ON DELETE RESTRICT,
  ADD COLUMN billing_account_id UUID REFERENCES public.onboarding_billing_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN highlevel_opportunity_id TEXT,
  ADD COLUMN account_sequence INTEGER CHECK (account_sequence BETWEEN 1 AND 5),
  ADD COLUMN account_count INTEGER CHECK (account_count BETWEEN 1 AND 5),
  ADD COLUMN total_listing_count INTEGER CHECK (total_listing_count BETWEEN 1 AND 5),
  ADD COLUMN billing_mode TEXT CHECK (billing_mode IN ('single', 'separate_per_listing')),
  ADD CONSTRAINT agreement_entitlements_allocated_onboarding_fee_check
    CHECK (onboarding_fee_cents BETWEEN 3000 AND 15000),
  ADD CONSTRAINT agreement_entitlements_group_account_pair_check
    CHECK (
      (onboarding_group_id IS NULL AND billing_account_id IS NULL
        AND highlevel_opportunity_id IS NULL AND account_sequence IS NULL
        AND account_count IS NULL AND total_listing_count IS NULL AND billing_mode IS NULL)
      OR (onboarding_group_id IS NOT NULL AND billing_account_id IS NOT NULL
        AND highlevel_opportunity_id IS NOT NULL AND account_sequence IS NOT NULL
        AND account_count IS NOT NULL AND total_listing_count IS NOT NULL AND billing_mode IS NOT NULL)
    );

ALTER TABLE public.onboarding_billing_accounts
  ADD CONSTRAINT onboarding_billing_accounts_entitlement_fk
  FOREIGN KEY (agreement_entitlement_id)
  REFERENCES public.agreement_entitlements(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS public.agreement_entitlements_one_active_contact_revision;
CREATE UNIQUE INDEX agreement_entitlements_one_active_billing_account_revision
  ON public.agreement_entitlements (billing_account_id)
  WHERE status = 'active' AND billing_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_agreement_entitlement_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF ROW(
    OLD.jti, OLD.environment, OLD.stripe_account_id,
    OLD.highlevel_location_id, OLD.highlevel_contact_id, OLD.highlevel_opportunity_id,
    OLD.onboarding_group_id, OLD.billing_account_id, OLD.account_sequence,
    OLD.account_count, OLD.total_listing_count, OLD.billing_mode,
    OLD.agreement_document_id, OLD.agreement_template_id,
    OLD.agreement_revision, OLD.agreement_content_sha256, OLD.signed_at,
    OLD.expires_at, OLD.primary_quantity, OLD.child_quantity,
    OLD.onboarding_fee_cents, OLD.service_start_mode, OLD.service_start_date,
    OLD.currency, OLD.price_book_version, OLD.tax_policy
  ) IS DISTINCT FROM ROW(
    NEW.jti, NEW.environment, NEW.stripe_account_id,
    NEW.highlevel_location_id, NEW.highlevel_contact_id, NEW.highlevel_opportunity_id,
    NEW.onboarding_group_id, NEW.billing_account_id, NEW.account_sequence,
    NEW.account_count, NEW.total_listing_count, NEW.billing_mode,
    NEW.agreement_document_id, NEW.agreement_template_id,
    NEW.agreement_revision, NEW.agreement_content_sha256, NEW.signed_at,
    NEW.expires_at, NEW.primary_quantity, NEW.child_quantity,
    NEW.onboarding_fee_cents, NEW.service_start_mode, NEW.service_start_date,
    NEW.currency, NEW.price_book_version, NEW.tax_policy
  ) THEN
    RAISE EXCEPTION 'Issued agreement commercial fields are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NOT (OLD.status = 'active' AND NEW.status IN ('superseded', 'revoked')) THEN
    RAISE EXCEPTION 'Illegal agreement entitlement lifecycle transition'
      USING ERRCODE = '22023';
  END IF;
  IF OLD.onboarding_run_id IS NOT NULL
     AND OLD.onboarding_run_id IS DISTINCT FROM NEW.onboarding_run_id THEN
    RAISE EXCEPTION 'Onboarding run binding is immutable once set'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.onboarding_runs
  ADD COLUMN commercial_group_id UUID UNIQUE
    REFERENCES public.onboarding_commercial_groups(id) ON DELETE RESTRICT;

ALTER TABLE public.onboarding_run_listings
  ADD COLUMN billing_account_id UUID
    REFERENCES public.onboarding_billing_accounts(id) ON DELETE RESTRICT;

ALTER TABLE public.listings
  ADD COLUMN billing_account_id UUID
    REFERENCES public.onboarding_billing_accounts(id) ON DELETE RESTRICT;

ALTER TABLE public.ghl_checkout_sync_outbox
  ADD COLUMN onboarding_group_id UUID
    REFERENCES public.onboarding_commercial_groups(id) ON DELETE RESTRICT,
  ADD COLUMN billing_account_id UUID
    REFERENCES public.onboarding_billing_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN highlevel_opportunity_id TEXT;

CREATE INDEX onboarding_billing_accounts_group_state
  ON public.onboarding_billing_accounts (group_id, state, sequence);
CREATE INDEX onboarding_run_listings_billing_account
  ON public.onboarding_run_listings (billing_account_id)
  WHERE billing_account_id IS NOT NULL;
CREATE INDEX listings_billing_account
  ON public.listings (billing_account_id)
  WHERE billing_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.populate_multi_business_checkout_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  entitlement public.agreement_entitlements%ROWTYPE;
BEGIN
  SELECT entitlement_row.* INTO entitlement
  FROM public.server_checkout_attempts attempt
  JOIN public.agreement_entitlements entitlement_row
    ON entitlement_row.id = attempt.entitlement_id
  WHERE attempt.id = NEW.checkout_attempt_id
  FOR SHARE OF entitlement_row;
  IF entitlement.onboarding_group_id IS NULL
     OR entitlement.billing_account_id IS NULL
     OR entitlement.highlevel_opportunity_id IS NULL THEN
    RAISE EXCEPTION 'Checkout outbox requires a multi-business account binding'
      USING ERRCODE = '55000';
  END IF;
  NEW.onboarding_group_id := entitlement.onboarding_group_id;
  NEW.billing_account_id := entitlement.billing_account_id;
  NEW.highlevel_opportunity_id := entitlement.highlevel_opportunity_id;
  NEW.projection := NEW.projection || jsonb_build_object(
    'onboarding_group_id', entitlement.onboarding_group_id,
    'billing_account_id', entitlement.billing_account_id,
    'highlevel_opportunity_id', entitlement.highlevel_opportunity_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER populate_multi_business_checkout_outbox_trigger
  BEFORE INSERT ON public.ghl_checkout_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.populate_multi_business_checkout_outbox();

CREATE OR REPLACE FUNCTION public.get_server_checkout_expected(
  p_checkout_session_id TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'checkoutSessionId', attempt.checkout_session_id,
    'stripeAccountId', attempt.stripe_account_id,
    'livemode', attempt.livemode,
    'environment', attempt.provider_environment,
    'entitlementId', entitlement.id,
    'onboardingGroupId', entitlement.onboarding_group_id,
    'billingAccountId', entitlement.billing_account_id,
    'agreementDocumentId', entitlement.agreement_document_id,
    'highLevelContactId', entitlement.highlevel_contact_id,
    'highLevelOpportunityId', entitlement.highlevel_opportunity_id,
    'serviceStartMode', entitlement.service_start_mode,
    'serviceStartDate', entitlement.service_start_date,
    'lines', attempt.line_items,
    'expectedInitialAmount', attempt.expected_initial_amount_cents,
    'expectedCurrency', attempt.expected_currency,
    'expectedTrialEnd', attempt.expected_trial_end
  )
  FROM public.server_checkout_attempts attempt
  JOIN public.agreement_entitlements entitlement
    ON entitlement.id = attempt.entitlement_id
  WHERE attempt.checkout_session_id = p_checkout_session_id
    AND entitlement.status = 'active'
    AND entitlement.expires_at > now()
    AND entitlement.owned_exception_code IS NULL
    AND entitlement.owned_exception_approver IS NULL
    AND entitlement.onboarding_group_id IS NOT NULL
    AND entitlement.billing_account_id IS NOT NULL
$$;

CREATE TABLE public.onboarding_billing_account_transitions (
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  PRIMARY KEY (from_state, to_state)
);

INSERT INTO public.onboarding_billing_account_transitions (from_state, to_state) VALUES
  ('agreement_pending', 'agreement_signed'), ('agreement_pending', 'manual_review'), ('agreement_pending', 'cancelled'),
  ('agreement_signed', 'payment_pending'), ('agreement_signed', 'manual_review'), ('agreement_signed', 'cancelled'),
  ('payment_pending', 'payment_verified'), ('payment_pending', 'manual_review'), ('payment_pending', 'cancelled'),
  ('payment_verified', 'complete'), ('payment_verified', 'manual_review'),
  ('complete', 'manual_review'),
  ('manual_review', 'agreement_pending'), ('manual_review', 'payment_pending'), ('manual_review', 'cancelled'),
  ('cancelled', 'superseded');

CREATE OR REPLACE FUNCTION public.enforce_onboarding_billing_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent public.onboarding_commercial_groups%ROWTYPE;
BEGIN
  SELECT * INTO parent
  FROM public.onboarding_commercial_groups
  WHERE id = NEW.group_id
  FOR SHARE;
  IF parent.id IS NULL THEN
    RAISE EXCEPTION 'Billing account group is missing' USING ERRCODE = '23503';
  END IF;
  IF NEW.sequence > parent.billing_account_count
     OR NEW.pricing_program <> parent.pricing_program THEN
    RAISE EXCEPTION 'Billing account conflicts with frozen group authority' USING ERRCODE = '22023';
  END IF;
  IF parent.billing_mode = 'single'
     AND (NEW.sequence <> 1 OR NEW.listing_quantity <> parent.total_listing_count OR NEW.onboarding_fee_cents <> 15000) THEN
    RAISE EXCEPTION 'Single-account allocation conflicts with group authority' USING ERRCODE = '22023';
  END IF;
  IF parent.billing_mode = 'separate_per_listing'
     AND (NEW.listing_quantity <> 1 OR NEW.onboarding_fee_cents * parent.billing_account_count <> 15000) THEN
    RAISE EXCEPTION 'Separate-account allocation conflicts with group authority' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      OLD.group_id, OLD.sequence, OLD.legal_business_name,
      OLD.normalized_legal_business_name, OLD.listing_quantity,
      OLD.pricing_program, OLD.monthly_rate_cents, OLD.monthly_amount_cents,
      OLD.onboarding_fee_cents, OLD.initial_checkout_total_cents
    ) IS DISTINCT FROM ROW(
      NEW.group_id, NEW.sequence, NEW.legal_business_name,
      NEW.normalized_legal_business_name, NEW.listing_quantity,
      NEW.pricing_program, NEW.monthly_rate_cents, NEW.monthly_amount_cents,
      NEW.onboarding_fee_cents, NEW.initial_checkout_total_cents
    ) THEN
      RAISE EXCEPTION 'Billing-account commercial authority is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.state IS DISTINCT FROM NEW.state
       AND NOT EXISTS (
         SELECT 1 FROM public.onboarding_billing_account_transitions
         WHERE from_state = OLD.state AND to_state = NEW.state
       ) THEN
      RAISE EXCEPTION 'Illegal billing-account transition from % to %', OLD.state, NEW.state
        USING ERRCODE = '22023';
    END IF;
    IF OLD.highlevel_opportunity_id IS NOT NULL
       AND OLD.highlevel_opportunity_id IS DISTINCT FROM NEW.highlevel_opportunity_id THEN
      RAISE EXCEPTION 'GHL opportunity binding is immutable once set' USING ERRCODE = '55000';
    END IF;
    IF OLD.agreement_entitlement_id IS NOT NULL
       AND OLD.agreement_entitlement_id IS DISTINCT FROM NEW.agreement_entitlement_id THEN
      RAISE EXCEPTION 'Agreement entitlement binding is immutable once set' USING ERRCODE = '55000';
    END IF;
    IF OLD.stripe_customer_id IS NOT NULL
       AND OLD.stripe_customer_id IS DISTINCT FROM NEW.stripe_customer_id THEN
      RAISE EXCEPTION 'Stripe customer binding is immutable once set' USING ERRCODE = '55000';
    END IF;
    IF OLD.stripe_subscription_id IS NOT NULL
       AND OLD.stripe_subscription_id IS DISTINCT FROM NEW.stripe_subscription_id THEN
      RAISE EXCEPTION 'Stripe subscription binding is immutable once set' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_onboarding_billing_account_trigger
  BEFORE INSERT OR UPDATE ON public.onboarding_billing_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_onboarding_billing_account();

CREATE OR REPLACE FUNCTION public.onboarding_group_commercially_complete(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.onboarding_commercial_groups group_row
    WHERE group_row.id = p_group_id
      AND group_row.tax_policy = 'configured_no_collection'
      AND group_row.client_id IS NOT NULL
      AND group_row.onboarding_run_id IS NOT NULL
      AND (
        SELECT COUNT(*)
        FROM public.onboarding_billing_accounts account
        WHERE account.group_id = group_row.id
      ) = group_row.billing_account_count
      AND (
        SELECT COALESCE(SUM(account.listing_quantity), 0)
        FROM public.onboarding_billing_accounts account
        WHERE account.group_id = group_row.id
      ) = group_row.total_listing_count
      AND (
        SELECT COALESCE(SUM(account.onboarding_fee_cents), 0)
        FROM public.onboarding_billing_accounts account
        WHERE account.group_id = group_row.id
      ) = group_row.onboarding_fee_total_cents
      AND NOT EXISTS (
        SELECT 1
        FROM public.onboarding_billing_accounts account
        LEFT JOIN public.agreement_entitlements entitlement
          ON entitlement.id = account.agreement_entitlement_id
         AND entitlement.billing_account_id = account.id
         AND entitlement.onboarding_group_id = group_row.id
         AND entitlement.status = 'active'
         AND entitlement.owned_exception_code IS NULL
        LEFT JOIN LATERAL (
          SELECT attempt.*
          FROM public.server_checkout_attempts attempt
          WHERE attempt.entitlement_id = entitlement.id
          ORDER BY attempt.generation DESC
          LIMIT 1
        ) latest ON TRUE
        WHERE account.group_id = group_row.id
          AND (
            account.state <> 'complete'
            OR entitlement.id IS NULL
            OR latest.id IS NULL
            OR latest.state NOT IN ('payment_verified', 'ghl_sync_pending', 'ghl_onboarding_unlocked', 'service_billing_active')
            OR latest.failure_code IS NOT NULL
            OR account.stripe_customer_id IS DISTINCT FROM latest.stripe_customer_id
            OR account.stripe_subscription_id IS DISTINCT FROM latest.stripe_subscription_id
            OR NOT EXISTS (
              SELECT 1
              FROM public.client_stripe_customers customer_link
              WHERE customer_link.client_id = group_row.client_id
                AND customer_link.stripe_customer_id = account.stripe_customer_id
            )
          )
      )
      AND (
        SELECT COUNT(*)
        FROM public.onboarding_run_listings run_listing
        WHERE run_listing.run_id = group_row.onboarding_run_id
          AND run_listing.billing_account_id IS NOT NULL
      ) = group_row.total_listing_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.onboarding_billing_accounts account
        WHERE account.group_id = group_row.id
          AND (
            SELECT COUNT(*)
            FROM public.onboarding_run_listings run_listing
            WHERE run_listing.run_id = group_row.onboarding_run_id
              AND run_listing.billing_account_id = account.id
          ) <> account.listing_quantity
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.enforce_final_assembly_handoff_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  current_run public.onboarding_runs%ROWTYPE;
  current_group public.onboarding_commercial_groups%ROWTYPE;
  run_ghl_contact_id TEXT;
BEGIN
  SELECT * INTO current_run
  FROM public.onboarding_runs
  WHERE id = NEW.run_id
  FOR SHARE;
  IF current_run.id IS NULL
     OR current_run.status <> 'submitted'
     OR current_run.submitted_at IS NULL
     OR current_run.source_system <> 'ghl'
     OR current_run.commercial_group_id IS NULL THEN
    RAISE EXCEPTION 'Final consolidated GHL onboarding submission is required for Assembly handoff'
      USING ERRCODE = '55000';
  END IF;
  SELECT * INTO current_group
  FROM public.onboarding_commercial_groups
  WHERE id = current_run.commercial_group_id
    AND onboarding_run_id = current_run.id
  FOR SHARE;
  SELECT ghl_contact_id INTO run_ghl_contact_id
  FROM public.clients
  WHERE id = current_run.client_id;
  IF current_group.id IS NULL
     OR current_group.client_id IS DISTINCT FROM current_run.client_id
     OR current_group.highlevel_contact_id IS DISTINCT FROM run_ghl_contact_id
     OR NOT public.onboarding_group_commercially_complete(current_group.id) THEN
    RAISE EXCEPTION 'Every billing account must be signed and payment-verified before Assembly handoff'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.event_key <> ('rf.onboarding.v1:' || NEW.run_id::TEXT) THEN
    RAISE EXCEPTION 'Assembly handoff identity must be stable for the onboarding run'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_onboarding_account_entitlement(
  p_group_fingerprint TEXT,
  p_highlevel_location_id TEXT,
  p_highlevel_contact_id TEXT,
  p_signer_name TEXT,
  p_signer_email TEXT,
  p_billing_mode TEXT,
  p_total_listing_count INTEGER,
  p_pricing_program TEXT,
  p_account_sequence INTEGER,
  p_legal_business_name TEXT,
  p_highlevel_opportunity_id TEXT,
  p_listing_quantity INTEGER,
  p_monthly_rate_cents INTEGER,
  p_monthly_amount_cents INTEGER,
  p_onboarding_fee_cents INTEGER,
  p_initial_checkout_total_cents INTEGER,
  p_agreement_document_id TEXT,
  p_agreement_template_id TEXT,
  p_agreement_revision INTEGER,
  p_agreement_content_sha256 TEXT,
  p_signed_at TIMESTAMPTZ,
  p_entitlement_jti TEXT,
  p_environment TEXT,
  p_stripe_account_id TEXT,
  p_price_book_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  group_row public.onboarding_commercial_groups%ROWTYPE;
  account_row public.onboarding_billing_accounts%ROWTYPE;
  entitlement_row public.agreement_entitlements%ROWTYPE;
  expected_account_count INTEGER;
BEGIN
  IF p_group_fingerprint !~ '^[a-f0-9]{64}$'
     OR p_billing_mode NOT IN ('single', 'separate_per_listing')
     OR p_total_listing_count NOT BETWEEN 1 AND 5
     OR p_pricing_program NOT IN ('Regular', 'Referral')
     OR p_account_sequence NOT BETWEEN 1 AND 5
     OR p_agreement_revision <= 0
     OR p_agreement_content_sha256 !~ '^[a-f0-9]{64}$'
     OR p_environment NOT IN ('test', 'live')
     OR p_signed_at > now() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'Invalid onboarding account entitlement input' USING ERRCODE = '22023';
  END IF;
  expected_account_count := CASE
    WHEN p_billing_mode = 'single' THEN 1
    ELSE p_total_listing_count
  END;
  IF p_account_sequence > expected_account_count
     OR (p_billing_mode = 'single' AND (
       p_listing_quantity <> p_total_listing_count
       OR p_onboarding_fee_cents <> 15000
     ))
     OR (p_billing_mode = 'separate_per_listing' AND (
       p_listing_quantity <> 1
       OR p_onboarding_fee_cents * expected_account_count <> 15000
     ))
     OR p_monthly_amount_cents <> p_monthly_rate_cents * p_listing_quantity
     OR p_initial_checkout_total_cents <> p_monthly_amount_cents + p_onboarding_fee_cents
     OR (p_pricing_program = 'Regular' AND p_monthly_rate_cents <> 35000)
     OR (p_pricing_program = 'Referral' AND p_monthly_rate_cents <> 32000) THEN
    RAISE EXCEPTION 'Commercial values conflict with the approved price book' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_group_fingerprint, 0));
  INSERT INTO public.onboarding_commercial_groups (
    external_key, highlevel_location_id, highlevel_contact_id,
    signer_name, signer_email, billing_mode, total_listing_count,
    billing_account_count, pricing_program, onboarding_fee_total_cents,
    currency, tax_policy, state
  ) VALUES (
    'rfg_' || p_group_fingerprint, p_highlevel_location_id,
    p_highlevel_contact_id, btrim(p_signer_name), lower(btrim(p_signer_email)),
    p_billing_mode, p_total_listing_count, expected_account_count,
    p_pricing_program, 15000, 'usd', 'configured_no_collection',
    'payment_pending'
  ) ON CONFLICT (external_key) DO NOTHING;

  SELECT * INTO group_row
  FROM public.onboarding_commercial_groups
  WHERE external_key = 'rfg_' || p_group_fingerprint
  FOR UPDATE;
  IF group_row.highlevel_location_id IS DISTINCT FROM p_highlevel_location_id
     OR group_row.highlevel_contact_id IS DISTINCT FROM p_highlevel_contact_id
     OR group_row.signer_name IS DISTINCT FROM btrim(p_signer_name)
     OR group_row.signer_email IS DISTINCT FROM lower(btrim(p_signer_email))
     OR group_row.billing_mode IS DISTINCT FROM p_billing_mode
     OR group_row.total_listing_count IS DISTINCT FROM p_total_listing_count
     OR group_row.billing_account_count IS DISTINCT FROM expected_account_count
     OR group_row.pricing_program IS DISTINCT FROM p_pricing_program
     OR group_row.onboarding_fee_total_cents <> 15000
     OR group_row.currency <> 'usd'
     OR group_row.tax_policy <> 'configured_no_collection' THEN
    RAISE EXCEPTION 'Onboarding group conflicts with frozen authority' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.onboarding_billing_accounts (
    group_id, sequence, highlevel_opportunity_id, legal_business_name,
    normalized_legal_business_name, listing_quantity, pricing_program,
    monthly_rate_cents, monthly_amount_cents, onboarding_fee_cents,
    initial_checkout_total_cents, state
  ) VALUES (
    group_row.id, p_account_sequence, p_highlevel_opportunity_id,
    btrim(p_legal_business_name), lower(regexp_replace(btrim(p_legal_business_name), '\s+', ' ', 'g')),
    p_listing_quantity, p_pricing_program, p_monthly_rate_cents,
    p_monthly_amount_cents, p_onboarding_fee_cents,
    p_initial_checkout_total_cents, 'agreement_signed'
  ) ON CONFLICT (group_id, sequence) DO NOTHING;

  SELECT * INTO account_row
  FROM public.onboarding_billing_accounts
  WHERE group_id = group_row.id AND sequence = p_account_sequence
  FOR UPDATE;
  IF account_row.highlevel_opportunity_id IS DISTINCT FROM p_highlevel_opportunity_id
     OR account_row.legal_business_name IS DISTINCT FROM btrim(p_legal_business_name)
     OR account_row.listing_quantity IS DISTINCT FROM p_listing_quantity
     OR account_row.pricing_program IS DISTINCT FROM p_pricing_program
     OR account_row.monthly_rate_cents IS DISTINCT FROM p_monthly_rate_cents
     OR account_row.monthly_amount_cents IS DISTINCT FROM p_monthly_amount_cents
     OR account_row.onboarding_fee_cents IS DISTINCT FROM p_onboarding_fee_cents
     OR account_row.initial_checkout_total_cents IS DISTINCT FROM p_initial_checkout_total_cents THEN
    RAISE EXCEPTION 'Billing account conflicts with frozen authority' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.agreement_entitlements (
    jti, status, environment, stripe_account_id, highlevel_location_id,
    highlevel_contact_id, highlevel_opportunity_id, onboarding_group_id,
    billing_account_id, account_sequence, account_count, total_listing_count,
    billing_mode, agreement_document_id, agreement_template_id,
    agreement_revision, agreement_content_sha256, signed_at, expires_at,
    primary_quantity, child_quantity, onboarding_fee_cents,
    service_start_mode, service_start_date, currency, price_book_version,
    tax_policy
  ) VALUES (
    p_entitlement_jti, 'active', p_environment, p_stripe_account_id,
    p_highlevel_location_id, p_highlevel_contact_id,
    p_highlevel_opportunity_id, group_row.id, account_row.id,
    p_account_sequence, expected_account_count, p_total_listing_count,
    p_billing_mode, p_agreement_document_id, p_agreement_template_id,
    p_agreement_revision, p_agreement_content_sha256, p_signed_at,
    p_signed_at + INTERVAL '7 days', p_listing_quantity, 0,
    p_onboarding_fee_cents, 'immediate', NULL, 'usd',
    p_price_book_version, 'configured_no_collection'
  ) ON CONFLICT (jti) DO NOTHING;

  SELECT * INTO entitlement_row
  FROM public.agreement_entitlements
  WHERE jti = p_entitlement_jti
  FOR UPDATE;
  IF entitlement_row.billing_account_id IS DISTINCT FROM account_row.id
     OR entitlement_row.onboarding_group_id IS DISTINCT FROM group_row.id
     OR entitlement_row.agreement_document_id IS DISTINCT FROM p_agreement_document_id
     OR entitlement_row.agreement_revision IS DISTINCT FROM p_agreement_revision
     OR entitlement_row.agreement_content_sha256 IS DISTINCT FROM p_agreement_content_sha256
     OR entitlement_row.status <> 'active' THEN
    RAISE EXCEPTION 'Agreement entitlement conflicts with frozen authority' USING ERRCODE = '23505';
  END IF;
  IF account_row.agreement_entitlement_id IS NULL THEN
    UPDATE public.onboarding_billing_accounts
    SET agreement_entitlement_id = entitlement_row.id, updated_at = now()
    WHERE id = account_row.id;
  ELSIF account_row.agreement_entitlement_id IS DISTINCT FROM entitlement_row.id THEN
    RAISE EXCEPTION 'Billing account has a different entitlement' USING ERRCODE = '23505';
  END IF;

  RETURN jsonb_build_object(
    'groupId', group_row.id,
    'billingAccountId', account_row.id,
    'entitlementId', entitlement_row.id,
    'jti', entitlement_row.jti,
    'expiresAt', entitlement_row.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_onboarding_account_payment_pending(
  p_billing_account_id UUID,
  p_checkout_session_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  account_row public.onboarding_billing_accounts%ROWTYPE;
  attempt_row public.server_checkout_attempts%ROWTYPE;
BEGIN
  SELECT * INTO account_row FROM public.onboarding_billing_accounts
  WHERE id = p_billing_account_id FOR UPDATE;
  SELECT attempt.* INTO attempt_row
  FROM public.server_checkout_attempts attempt
  JOIN public.agreement_entitlements entitlement
    ON entitlement.id = attempt.entitlement_id
  WHERE entitlement.billing_account_id = p_billing_account_id
    AND attempt.checkout_session_id = p_checkout_session_id
    AND attempt.state = 'session_open'
  FOR SHARE OF attempt;
  IF account_row.id IS NULL OR attempt_row.id IS NULL THEN
    RAISE EXCEPTION 'Checkout is not bound to this billing account' USING ERRCODE = '55000';
  END IF;
  IF account_row.state = 'agreement_signed' THEN
    UPDATE public.onboarding_billing_accounts SET state = 'payment_pending', updated_at = now()
    WHERE id = account_row.id RETURNING * INTO account_row;
  ELSIF account_row.state NOT IN ('payment_pending', 'payment_verified', 'complete') THEN
    RAISE EXCEPTION 'Billing account cannot enter payment pending' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('billingAccountId', account_row.id, 'state', account_row.state);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_onboarding_account_checkout(
  p_group_external_key TEXT,
  p_account_sequence INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  account_row public.onboarding_billing_accounts%ROWTYPE;
  attempt_row public.server_checkout_attempts%ROWTYPE;
BEGIN
  SELECT account.* INTO account_row
  FROM public.onboarding_billing_accounts account
  JOIN public.onboarding_commercial_groups group_row ON group_row.id = account.group_id
  WHERE group_row.external_key = p_group_external_key
    AND account.sequence = p_account_sequence
  FOR UPDATE OF account;
  IF account_row.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT attempt.* INTO attempt_row
  FROM public.server_checkout_attempts attempt
  JOIN public.agreement_entitlements entitlement ON entitlement.id = attempt.entitlement_id
  WHERE entitlement.billing_account_id = account_row.id
    AND entitlement.status = 'active'
  ORDER BY attempt.generation DESC LIMIT 1
  FOR SHARE OF attempt;
  IF attempt_row.id IS NOT NULL
     AND attempt_row.state IN ('payment_verified', 'ghl_sync_pending', 'ghl_onboarding_unlocked', 'service_billing_active')
     AND attempt_row.failure_code IS NULL
     AND attempt_row.stripe_customer_id IS NOT NULL
     AND attempt_row.stripe_subscription_id IS NOT NULL THEN
    IF account_row.state = 'payment_pending' THEN
      UPDATE public.onboarding_billing_accounts
      SET state = 'payment_verified', stripe_customer_id = attempt_row.stripe_customer_id,
          stripe_subscription_id = attempt_row.stripe_subscription_id, updated_at = now()
      WHERE id = account_row.id RETURNING * INTO account_row;
    END IF;
    IF account_row.state = 'payment_verified' THEN
      UPDATE public.onboarding_billing_accounts
      SET state = 'complete', completed_at = COALESCE(completed_at, now()), updated_at = now()
      WHERE id = account_row.id RETURNING * INTO account_row;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'billingAccountId', account_row.id,
    'state', account_row.state,
    'checkoutSessionId', attempt_row.checkout_session_id,
    'checkoutUrl', attempt_row.checkout_url,
    'stripeCustomerId', account_row.stripe_customer_id,
    'stripeSubscriptionId', account_row.stripe_subscription_id,
    'failureCode', attempt_row.failure_code
  );
END;
$$;

ALTER TABLE public.onboarding_commercial_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_billing_account_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view onboarding commercial groups"
  ON public.onboarding_commercial_groups FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');
CREATE POLICY "Super admins can view onboarding billing accounts"
  ON public.onboarding_billing_accounts FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');
CREATE POLICY "Super admins can view billing-account transitions"
  ON public.onboarding_billing_account_transitions FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');

REVOKE ALL ON TABLE public.onboarding_commercial_groups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.onboarding_billing_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.onboarding_billing_account_transitions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_onboarding_billing_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_group_commercially_complete(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.populate_multi_business_checkout_outbox() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_server_checkout_expected(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_onboarding_account_entitlement(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_onboarding_account_payment_pending(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_onboarding_account_checkout(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.onboarding_commercial_groups TO authenticated;
GRANT SELECT ON TABLE public.onboarding_billing_accounts TO authenticated;
GRANT SELECT ON TABLE public.onboarding_billing_account_transitions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.onboarding_commercial_groups TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.onboarding_billing_accounts TO service_role;
GRANT SELECT ON TABLE public.onboarding_billing_account_transitions TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_onboarding_billing_account() TO service_role;
GRANT EXECUTE ON FUNCTION public.onboarding_group_commercially_complete(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.populate_multi_business_checkout_outbox() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_server_checkout_expected(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_onboarding_account_entitlement(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_account_payment_pending(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_onboarding_account_checkout(TEXT, INTEGER) TO service_role;

COMMENT ON TABLE public.onboarding_commercial_groups IS
  'One signer/session and one consolidated Hub/Assembly onboarding run; commercial effects remain disabled until application wiring is explicitly enabled.';
COMMENT ON TABLE public.onboarding_billing_accounts IS
  'One agreement, GHL opportunity, Stripe customer, and subscription per independently billed legal business.';
