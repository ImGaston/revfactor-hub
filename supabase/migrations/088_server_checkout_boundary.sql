-- 088 — RF-AUTO-001 server-created checkout boundary (UNAPPLIED)
--
-- This migration is additive and intentionally fail-closed. It creates the
-- canonical agreement entitlement, checkout-attempt, provider-event and GHL
-- outbox ledgers. It does not create a public endpoint, drain an outbox, apply
-- a Stripe resource, or trigger downstream provisioning.

CREATE TABLE public.agreement_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jti TEXT NOT NULL UNIQUE CHECK (char_length(jti) BETWEEN 16 AND 200),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'revoked')),
  environment TEXT NOT NULL
    CHECK (environment IN ('isolated_fixture', 'test', 'live')),
  stripe_account_id TEXT NOT NULL,
  highlevel_location_id TEXT NOT NULL,
  highlevel_contact_id TEXT NOT NULL,
  agreement_document_id TEXT NOT NULL,
  agreement_template_id TEXT NOT NULL,
  agreement_revision INTEGER NOT NULL CHECK (agreement_revision > 0),
  agreement_content_sha256 TEXT NOT NULL
    CHECK (agreement_content_sha256 ~ '^[a-f0-9]{64}$'),
  signed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  primary_quantity INTEGER NOT NULL CHECK (primary_quantity BETWEEN 1 AND 5),
  child_quantity INTEGER NOT NULL CHECK (child_quantity BETWEEN 0 AND 5),
  onboarding_fee_cents INTEGER NOT NULL CHECK (onboarding_fee_cents = 15000),
  service_start_mode TEXT NOT NULL
    CHECK (service_start_mode IN ('immediate', 'scheduled')),
  service_start_date DATE,
  currency TEXT NOT NULL CHECK (currency = 'usd'),
  price_book_version TEXT NOT NULL,
  tax_policy TEXT NOT NULL DEFAULT 'policy_blocked'
    CHECK (tax_policy IN ('policy_blocked', 'provisional_fixture_only')),
  owned_exception_code TEXT,
  owned_exception_approver UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  onboarding_run_id UUID UNIQUE REFERENCES public.onboarding_runs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agreement_document_id, agreement_revision),
  CHECK (expires_at > signed_at),
  CHECK (
    (service_start_mode = 'immediate' AND service_start_date IS NULL)
    OR (service_start_mode = 'scheduled' AND service_start_date IS NOT NULL)
  ),
  CHECK (tax_policy = 'policy_blocked' OR environment = 'isolated_fixture'),
  CHECK (environment <> 'isolated_fixture' OR stripe_account_id LIKE 'fixture:%'),
  CHECK (
    (owned_exception_code IS NULL AND owned_exception_approver IS NULL)
    OR (owned_exception_code IS NOT NULL AND owned_exception_approver IS NOT NULL)
  )
);

CREATE TABLE public.server_checkout_state_transitions (
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  PRIMARY KEY (from_state, to_state)
);

INSERT INTO public.server_checkout_state_transitions (from_state, to_state) VALUES
  ('policy_blocked', 'eligible'), ('policy_blocked', 'revoked'),
  ('eligible', 'session_creating'), ('eligible', 'policy_blocked'), ('eligible', 'revoked'), ('eligible', 'cancelled'),
  ('session_creating', 'session_open'), ('session_creating', 'provider_conflict'), ('session_creating', 'manual_review'), ('session_creating', 'cancelled'),
  ('session_open', 'checkout_completed_unverified'), ('session_open', 'session_expired'), ('session_open', 'payment_failed'), ('session_open', 'provider_conflict'), ('session_open', 'cancelled'),
  ('session_expired', 'superseded'), ('session_expired', 'cancelled'),
  ('checkout_completed_unverified', 'provider_reconciling'), ('checkout_completed_unverified', 'provider_conflict'), ('checkout_completed_unverified', 'manual_review'),
  ('provider_reconciling', 'payment_verified'), ('provider_reconciling', 'payment_verified_scheduled'), ('provider_reconciling', 'payment_failed'),
  ('provider_reconciling', 'identity_conflict'), ('provider_reconciling', 'provider_conflict'), ('provider_reconciling', 'manual_review'),
  ('payment_verified', 'ghl_sync_pending'), ('payment_verified', 'service_billing_active'), ('payment_verified', 'service_billing_failed'), ('payment_verified', 'manual_review'),
  ('payment_verified_scheduled', 'ghl_sync_pending'), ('payment_verified_scheduled', 'service_billing_active'), ('payment_verified_scheduled', 'service_billing_failed'), ('payment_verified_scheduled', 'manual_review'),
  ('ghl_sync_pending', 'ghl_onboarding_unlocked'), ('ghl_sync_pending', 'manual_review'),
  ('ghl_onboarding_unlocked', 'service_billing_active'), ('ghl_onboarding_unlocked', 'service_billing_failed'), ('ghl_onboarding_unlocked', 'manual_review'),
  ('service_billing_active', 'service_billing_failed'), ('service_billing_active', 'manual_review'),
  ('service_billing_failed', 'service_billing_active'), ('service_billing_failed', 'manual_review'), ('service_billing_failed', 'cancelled'),
  ('payment_failed', 'superseded'), ('payment_failed', 'manual_review'), ('payment_failed', 'cancelled'),
  ('identity_conflict', 'manual_review'), ('identity_conflict', 'revoked'),
  ('provider_conflict', 'manual_review'), ('provider_conflict', 'revoked'),
  ('manual_review', 'eligible'), ('manual_review', 'revoked'), ('manual_review', 'cancelled');

CREATE TABLE public.server_checkout_service_billing_transitions (
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  PRIMARY KEY (from_state, to_state)
);

INSERT INTO public.server_checkout_service_billing_transitions (from_state, to_state) VALUES
  ('not_started', 'scheduled'), ('not_started', 'active'),
  ('scheduled', 'active'), ('scheduled', 'failed'), ('scheduled', 'cancelled'),
  ('active', 'past_due'), ('active', 'failed'), ('active', 'cancelled'),
  ('past_due', 'active'), ('past_due', 'failed'), ('past_due', 'cancelled'),
  ('failed', 'active'), ('failed', 'cancelled');

CREATE OR REPLACE FUNCTION public.server_checkout_line_items_valid(
  p_line_items JSONB,
  p_currency TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    jsonb_typeof(p_line_items) = 'array'
    AND jsonb_array_length(p_line_items) BETWEEN 2 AND 3
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_line_items) AS line(item)
      WHERE jsonb_typeof(line.item) <> 'object'
        OR line.item - ARRAY['priceId', 'quantity', 'kind', 'unitAmount', 'currency'] <> '{}'::JSONB
        OR NOT (line.item ?& ARRAY['priceId', 'quantity', 'kind', 'unitAmount', 'currency'])
        OR NULLIF(line.item->>'priceId', '') IS NULL
        OR (line.item->>'quantity')::INTEGER <= 0
        OR line.item->>'kind' NOT IN ('one_time', 'recurring')
        OR (line.item->>'unitAmount')::INTEGER <= 0
        OR line.item->>'currency' <> p_currency
    )
    AND (
      SELECT COUNT(*) FROM jsonb_array_elements(p_line_items) AS line(item)
      WHERE line.item->>'kind' = 'one_time'
    ) = 1
$$;

CREATE TABLE public.server_checkout_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id UUID NOT NULL REFERENCES public.agreement_entitlements(id) ON DELETE RESTRICT,
  generation INTEGER NOT NULL CHECK (generation > 0),
  identity_sha256 TEXT NOT NULL CHECK (identity_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN (
    'policy_blocked', 'eligible', 'session_creating', 'session_open', 'session_expired',
    'checkout_completed_unverified', 'provider_reconciling', 'payment_verified',
    'payment_verified_scheduled', 'ghl_sync_pending', 'ghl_onboarding_unlocked',
    'service_billing_active', 'service_billing_failed', 'payment_failed',
    'identity_conflict', 'provider_conflict', 'manual_review', 'superseded',
    'revoked', 'cancelled'
  )),
  provider_environment TEXT NOT NULL
    CHECK (provider_environment IN ('isolated_fixture', 'test', 'live')),
  stripe_account_id TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  line_items JSONB NOT NULL,
  expected_initial_amount_cents INTEGER NOT NULL CHECK (expected_initial_amount_cents > 0),
  expected_currency TEXT NOT NULL CHECK (expected_currency = 'usd'),
  expected_trial_end BIGINT,
  checkout_session_id TEXT UNIQUE,
  checkout_url TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_initial_invoice_id TEXT UNIQUE,
  initial_invoice_status TEXT,
  initial_invoice_amount_due INTEGER,
  initial_invoice_amount_paid INTEGER,
  initial_invoice_currency TEXT,
  payment_intent_status TEXT,
  payment_intent_amount_received INTEGER,
  subscription_status TEXT,
  subscription_trial_end BIGINT,
  service_billing_state TEXT NOT NULL DEFAULT 'not_started'
    CHECK (service_billing_state IN ('not_started', 'scheduled', 'active', 'past_due', 'failed', 'cancelled')),
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (entitlement_id, generation),
  CHECK (public.server_checkout_line_items_valid(line_items, expected_currency)),
  CHECK (
    (provider_environment = 'live' AND livemode)
    OR (provider_environment <> 'live' AND NOT livemode)
  ),
  CHECK (
    (expected_trial_end IS NULL AND provider_environment IS NOT NULL)
    OR expected_trial_end > 0
  )
);

CREATE UNIQUE INDEX server_checkout_attempts_one_active_generation
  ON public.server_checkout_attempts (entitlement_id)
  WHERE state IN (
    'session_creating', 'session_open', 'checkout_completed_unverified',
    'provider_reconciling', 'payment_verified', 'payment_verified_scheduled',
    'ghl_sync_pending', 'ghl_onboarding_unlocked', 'service_billing_active',
    'service_billing_failed', 'manual_review'
  );

CREATE UNIQUE INDEX agreement_entitlements_one_active_contact_revision
  ON public.agreement_entitlements (highlevel_location_id, highlevel_contact_id)
  WHERE status = 'active';

CREATE TABLE public.server_checkout_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_event_type TEXT NOT NULL,
  provider_event_created BIGINT NOT NULL CHECK (provider_event_created > 0),
  checkout_attempt_id UUID REFERENCES public.server_checkout_attempts(id) ON DELETE RESTRICT,
  checkout_session_id TEXT NOT NULL,
  stripe_account_id TEXT NOT NULL,
  provider_environment TEXT NOT NULL
    CHECK (provider_environment IN ('isolated_fixture', 'test', 'live')),
  livemode BOOLEAN NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  result TEXT NOT NULL CHECK (result IN ('reconciled', 'conflict')),
  error_code TEXT,
  observation JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(observation) = 'object' AND octet_length(observation::TEXT) <= 4096),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at TIMESTAMPTZ
);

CREATE TABLE public.ghl_checkout_sync_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  checkout_attempt_id UUID NOT NULL REFERENCES public.server_checkout_attempts(id) ON DELETE RESTRICT,
  highlevel_contact_id TEXT NOT NULL,
  projection JSONB NOT NULL CHECK (
    jsonb_typeof(projection) = 'object'
    AND projection ?& ARRAY[
      'highlevel_contact_id', 'agreement_document_id', 'checkout_session_id',
      'stripe_customer_id', 'stripe_subscription_id', 'stripe_initial_invoice_id',
      'stripe_payment_intent_id', 'payment_state'
    ]
  ),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agreement_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_checkout_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_checkout_service_billing_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_checkout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_checkout_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_checkout_sync_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view agreement entitlements"
  ON public.agreement_entitlements FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');
CREATE POLICY "Super admins can view checkout transitions"
  ON public.server_checkout_state_transitions FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');
CREATE POLICY "Super admins can view service billing transitions"
  ON public.server_checkout_service_billing_transitions FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');
CREATE POLICY "Super admins can view checkout attempts"
  ON public.server_checkout_attempts FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');
CREATE POLICY "Super admins can view checkout provider events"
  ON public.server_checkout_provider_events FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');
CREATE POLICY "Super admins can view GHL checkout outbox"
  ON public.ghl_checkout_sync_outbox FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');

REVOKE ALL ON TABLE public.agreement_entitlements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.server_checkout_state_transitions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.server_checkout_service_billing_transitions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.server_checkout_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.server_checkout_provider_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ghl_checkout_sync_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agreement_entitlements TO authenticated;
GRANT SELECT ON TABLE public.server_checkout_state_transitions TO authenticated;
GRANT SELECT ON TABLE public.server_checkout_service_billing_transitions TO authenticated;
GRANT SELECT ON TABLE public.server_checkout_attempts TO authenticated;
GRANT SELECT ON TABLE public.server_checkout_provider_events TO authenticated;
GRANT SELECT ON TABLE public.ghl_checkout_sync_outbox TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agreement_entitlements TO service_role;
GRANT SELECT ON TABLE public.server_checkout_state_transitions TO service_role;
GRANT SELECT ON TABLE public.server_checkout_service_billing_transitions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.server_checkout_attempts TO service_role;
GRANT SELECT, INSERT ON TABLE public.server_checkout_provider_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ghl_checkout_sync_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_server_checkout_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.state IS DISTINCT FROM NEW.state
     AND NOT EXISTS (
       SELECT 1 FROM public.server_checkout_state_transitions
       WHERE from_state = OLD.state AND to_state = NEW.state
     ) THEN
    RAISE EXCEPTION 'Illegal checkout state transition from % to %', OLD.state, NEW.state
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_server_checkout_transition_trigger
  BEFORE UPDATE OF state ON public.server_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_server_checkout_transition();

CREATE OR REPLACE FUNCTION public.enforce_server_checkout_service_billing_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.service_billing_state IS DISTINCT FROM NEW.service_billing_state
     AND NOT EXISTS (
       SELECT 1 FROM public.server_checkout_service_billing_transitions
       WHERE from_state = OLD.service_billing_state
         AND to_state = NEW.service_billing_state
     ) THEN
    RAISE EXCEPTION 'Illegal service billing transition from % to %',
      OLD.service_billing_state, NEW.service_billing_state
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_server_checkout_service_billing_transition_trigger
  BEFORE UPDATE OF service_billing_state ON public.server_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_server_checkout_service_billing_transition();

CREATE OR REPLACE FUNCTION public.enforce_agreement_entitlement_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF ROW(
    OLD.jti, OLD.environment, OLD.stripe_account_id,
    OLD.highlevel_location_id, OLD.highlevel_contact_id,
    OLD.agreement_document_id, OLD.agreement_template_id,
    OLD.agreement_revision, OLD.agreement_content_sha256, OLD.signed_at,
    OLD.expires_at, OLD.primary_quantity, OLD.child_quantity,
    OLD.onboarding_fee_cents, OLD.service_start_mode, OLD.service_start_date,
    OLD.currency, OLD.price_book_version, OLD.tax_policy
  ) IS DISTINCT FROM ROW(
    NEW.jti, NEW.environment, NEW.stripe_account_id,
    NEW.highlevel_location_id, NEW.highlevel_contact_id,
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

CREATE TRIGGER enforce_agreement_entitlement_immutability_trigger
  BEFORE UPDATE ON public.agreement_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_agreement_entitlement_immutability();

CREATE OR REPLACE FUNCTION public.enforce_server_checkout_attempt_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF ROW(
    OLD.entitlement_id, OLD.generation, OLD.identity_sha256,
    OLD.idempotency_key, OLD.provider_environment, OLD.stripe_account_id,
    OLD.livemode, OLD.line_items, OLD.expected_initial_amount_cents,
    OLD.expected_currency, OLD.expected_trial_end
  ) IS DISTINCT FROM ROW(
    NEW.entitlement_id, NEW.generation, NEW.identity_sha256,
    NEW.idempotency_key, NEW.provider_environment, NEW.stripe_account_id,
    NEW.livemode, NEW.line_items, NEW.expected_initial_amount_cents,
    NEW.expected_currency, NEW.expected_trial_end
  ) THEN
    RAISE EXCEPTION 'Checkout authority fields are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_server_checkout_attempt_immutability_trigger
  BEFORE UPDATE ON public.server_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_server_checkout_attempt_immutability();

CREATE OR REPLACE FUNCTION public.enforce_final_assembly_handoff_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  current_run public.onboarding_runs%ROWTYPE;
  entitlement public.agreement_entitlements%ROWTYPE;
  attempt public.server_checkout_attempts%ROWTYPE;
  run_ghl_contact_id TEXT;
BEGIN
  SELECT * INTO current_run
  FROM public.onboarding_runs
  WHERE id = NEW.run_id
  FOR SHARE;
  IF current_run.id IS NULL
     OR current_run.status <> 'submitted'
     OR current_run.submitted_at IS NULL
     OR current_run.source_system <> 'ghl' THEN
    RAISE EXCEPTION 'Final GHL onboarding submission is required for Assembly handoff'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO entitlement
  FROM public.agreement_entitlements
  WHERE onboarding_run_id = NEW.run_id
    AND status = 'active'
    AND owned_exception_code IS NULL
    AND owned_exception_approver IS NULL
  FOR SHARE;
  IF entitlement.id IS NULL THEN
    RAISE EXCEPTION 'Current active agreement entitlement is required for Assembly handoff'
      USING ERRCODE = '55000';
  END IF;
  SELECT ghl_contact_id INTO run_ghl_contact_id
  FROM public.clients
  WHERE id = current_run.client_id;
  IF run_ghl_contact_id IS DISTINCT FROM entitlement.highlevel_contact_id THEN
    RAISE EXCEPTION 'Onboarding run identity does not match the agreement contact'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO attempt
  FROM public.server_checkout_attempts
  WHERE entitlement_id = entitlement.id
  ORDER BY generation DESC
  LIMIT 1
  FOR SHARE;
  IF attempt.id IS NULL
     OR attempt.state NOT IN ('ghl_onboarding_unlocked', 'service_billing_active')
     OR attempt.failure_code IS NOT NULL THEN
    RAISE EXCEPTION 'Approved commercial state is required for Assembly handoff'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.event_key <> ('rf.onboarding.v1:' || NEW.run_id::TEXT) THEN
    RAISE EXCEPTION 'Assembly handoff identity must be stable for the onboarding run'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_final_assembly_handoff_gate_trigger
  BEFORE INSERT ON public.onboarding_handoff_outbox
  FOR EACH ROW EXECUTE FUNCTION public.enforce_final_assembly_handoff_gate();

CREATE OR REPLACE FUNCTION public.claim_server_checkout_attempt(
  p_entitlement_id UUID,
  p_identity_sha256 TEXT,
  p_line_items JSONB
)
RETURNS public.server_checkout_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entitlement public.agreement_entitlements%ROWTYPE;
  latest public.server_checkout_attempts%ROWTYPE;
  created public.server_checkout_attempts%ROWTYPE;
  next_generation INTEGER;
  initial_amount INTEGER;
  normalized_trial_end BIGINT;
BEGIN
  IF p_identity_sha256 !~ '^[a-f0-9]{64}$'
     OR public.server_checkout_line_items_valid(p_line_items, 'usd') IS NOT TRUE THEN
    RAISE EXCEPTION 'Invalid checkout identity or canonical line items' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO entitlement
  FROM public.agreement_entitlements
  WHERE id = p_entitlement_id
  FOR UPDATE;

  IF entitlement.id IS NULL THEN
    RAISE EXCEPTION 'Agreement entitlement not found' USING ERRCODE = 'P0002';
  END IF;
  IF entitlement.status <> 'active' OR entitlement.expires_at <= now() THEN
    RAISE EXCEPTION 'Agreement entitlement is inactive' USING ERRCODE = '55000';
  END IF;
  -- PROVISIONAL — NOT BUSINESS APPROVAL. Only isolated fixtures may pass until
  -- an approved tax policy replaces this constraint in a later migration.
  IF entitlement.tax_policy <> 'provisional_fixture_only'
     OR entitlement.environment <> 'isolated_fixture' THEN
    RAISE EXCEPTION 'Checkout policy is blocked' USING ERRCODE = '55000';
  END IF;
  IF entitlement.owned_exception_code IS NOT NULL THEN
    RAISE EXCEPTION 'Owned exceptions require manual review' USING ERRCODE = '55000';
  END IF;

  SELECT SUM(
    (line.item->>'quantity')::INTEGER * (line.item->>'unitAmount')::INTEGER
  )::INTEGER
  INTO initial_amount
  FROM jsonb_array_elements(p_line_items) AS line(item)
  WHERE entitlement.service_start_mode = 'immediate'
     OR line.item->>'kind' = 'one_time';

  normalized_trial_end := CASE
    WHEN entitlement.service_start_mode = 'scheduled' THEN
      EXTRACT(EPOCH FROM (
        (entitlement.service_start_date::TIMESTAMP + INTERVAL '12 hours')
        AT TIME ZONE 'UTC'
      ))::BIGINT
    ELSE NULL
  END;

  SELECT * INTO latest
  FROM public.server_checkout_attempts
  WHERE entitlement_id = p_entitlement_id
  ORDER BY generation DESC
  LIMIT 1
  FOR UPDATE;

  IF latest.id IS NOT NULL
     AND latest.state IN (
       'session_creating', 'session_open', 'checkout_completed_unverified',
       'provider_reconciling', 'payment_verified', 'payment_verified_scheduled',
       'ghl_sync_pending', 'ghl_onboarding_unlocked', 'service_billing_active',
       'service_billing_failed', 'manual_review'
     ) THEN
    IF latest.identity_sha256 <> p_identity_sha256 OR latest.line_items <> p_line_items THEN
      RAISE EXCEPTION 'Existing checkout generation conflicts with canonical input' USING ERRCODE = '23505';
    END IF;
    RETURN latest;
  END IF;

  IF latest.id IS NOT NULL
     AND latest.state NOT IN ('session_expired', 'payment_failed', 'cancelled', 'superseded') THEN
    RAISE EXCEPTION 'Checkout generation cannot be replaced from state %', latest.state USING ERRCODE = '55000';
  END IF;
  IF latest.stripe_subscription_id IS NOT NULL OR latest.stripe_payment_intent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout with canonical payment IDs cannot be replaced' USING ERRCODE = '55000';
  END IF;

  next_generation := COALESCE(latest.generation, 0) + 1;
  INSERT INTO public.server_checkout_attempts (
    entitlement_id, generation, identity_sha256, idempotency_key, state,
    provider_environment, stripe_account_id, livemode, line_items,
    expected_initial_amount_cents, expected_currency, expected_trial_end
  ) VALUES (
    p_entitlement_id,
    next_generation,
    p_identity_sha256,
    format('rf-checkout-%s-g%s', left(p_identity_sha256, 48), next_generation),
    'session_creating',
    entitlement.environment,
    entitlement.stripe_account_id,
    entitlement.environment = 'live',
    p_line_items,
    initial_amount,
    entitlement.currency,
    normalized_trial_end
  ) RETURNING * INTO created;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_server_checkout_session(
  p_attempt_id UUID,
  p_expected_state TEXT,
  p_checkout_session_id TEXT,
  p_checkout_url TEXT
)
RETURNS public.server_checkout_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE saved public.server_checkout_attempts%ROWTYPE;
BEGIN
  UPDATE public.server_checkout_attempts
  SET checkout_session_id = p_checkout_session_id,
      checkout_url = p_checkout_url,
      state = 'session_open',
      updated_at = now()
  WHERE id = p_attempt_id
    AND state = p_expected_state
    AND p_expected_state = 'session_creating'
    AND checkout_session_id IS NULL
  RETURNING * INTO saved;
  IF saved.id IS NULL THEN
    RAISE EXCEPTION 'Checkout attempt is not attachable' USING ERRCODE = '40001';
  END IF;
  RETURN saved;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_server_checkout_attempt(
  p_attempt_id UUID,
  p_expected_state TEXT,
  p_next_state TEXT
)
RETURNS public.server_checkout_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE saved public.server_checkout_attempts%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.server_checkout_state_transitions
    WHERE from_state = p_expected_state AND to_state = p_next_state
  ) THEN
    RAISE EXCEPTION 'Illegal checkout state transition from % to %', p_expected_state, p_next_state
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.server_checkout_attempts
  SET state = p_next_state, updated_at = now()
  WHERE id = p_attempt_id AND state = p_expected_state
  RETURNING * INTO saved;
  IF saved.id IS NULL THEN
    RAISE EXCEPTION 'Checkout state changed concurrently' USING ERRCODE = '40001';
  END IF;
  RETURN saved;
END;
$$;

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
    'agreementDocumentId', entitlement.agreement_document_id,
    'highLevelContactId', entitlement.highlevel_contact_id,
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
$$;

CREATE OR REPLACE FUNCTION public.reconcile_server_checkout_event(
  p_provider_event_id TEXT,
  p_provider_event_type TEXT,
  p_provider_event_created BIGINT,
  p_payload_sha256 TEXT,
  p_checkout_session_id TEXT,
  p_stripe_account_id TEXT,
  p_provider_environment TEXT,
  p_livemode BOOLEAN,
  p_provider_line_items JSONB,
  p_stripe_customer_id TEXT,
  p_stripe_subscription_id TEXT,
  p_stripe_initial_invoice_id TEXT,
  p_checkout_session_invoice_id TEXT,
  p_stripe_payment_intent_id TEXT,
  p_payment_status TEXT,
  p_initial_invoice_status TEXT,
  p_initial_invoice_amount_due INTEGER,
  p_initial_invoice_amount_paid INTEGER,
  p_initial_invoice_currency TEXT,
  p_payment_intent_status TEXT,
  p_payment_intent_amount_received INTEGER,
  p_subscription_status TEXT,
  p_subscription_trial_end BIGINT,
  p_next_state TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attempt public.server_checkout_attempts%ROWTYPE;
  entitlement public.agreement_entitlements%ROWTYPE;
  duplicate_attempt_id UUID;
  duplicate_result TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_event_id, 0));
  IF p_provider_event_type <> 'checkout.session.completed'
     OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
     OR p_next_state NOT IN ('payment_verified', 'payment_verified_scheduled') THEN
    RAISE EXCEPTION 'Provider event is not allowlisted' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.server_checkout_provider_events
    WHERE provider_event_id = p_provider_event_id
  ) THEN
    SELECT checkout_attempt_id, result INTO duplicate_attempt_id, duplicate_result
    FROM public.server_checkout_provider_events
    WHERE provider_event_id = p_provider_event_id;
    RETURN jsonb_build_object('result', duplicate_result, 'duplicate', TRUE, 'attempt_id', duplicate_attempt_id);
  END IF;

  SELECT * INTO attempt
  FROM public.server_checkout_attempts
  WHERE checkout_session_id = p_checkout_session_id
  FOR UPDATE;
  IF attempt.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session is not in the canonical ledger' USING ERRCODE = 'P0002';
  END IF;
  -- Re-check after the attempt lock. A concurrent delivery may have committed
  -- the same event while this transaction was waiting.
  IF EXISTS (
    SELECT 1 FROM public.server_checkout_provider_events
    WHERE provider_event_id = p_provider_event_id
  ) THEN
    SELECT result INTO duplicate_result
    FROM public.server_checkout_provider_events
    WHERE provider_event_id = p_provider_event_id;
    RETURN jsonb_build_object('result', duplicate_result, 'duplicate', TRUE, 'attempt_id', attempt.id);
  END IF;
  IF attempt.line_items <> p_provider_line_items THEN
    RAISE EXCEPTION 'Provider prices or quantities conflict with canonical checkout' USING ERRCODE = '22023';
  END IF;
  IF attempt.stripe_account_id <> p_stripe_account_id
     OR attempt.provider_environment <> p_provider_environment
     OR attempt.livemode <> p_livemode THEN
    RAISE EXCEPTION 'Provider environment or account conflicts with canonical checkout' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p_stripe_customer_id, '') IS NULL OR NULLIF(p_stripe_subscription_id, '') IS NULL THEN
    RAISE EXCEPTION 'Canonical provider IDs are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO entitlement
  FROM public.agreement_entitlements
  WHERE id = attempt.entitlement_id
  FOR SHARE;
  IF (entitlement.service_start_mode = 'scheduled') <> (p_next_state = 'payment_verified_scheduled') THEN
    RAISE EXCEPTION 'Verified state conflicts with agreement service-start mode' USING ERRCODE = '22023';
  END IF;
  IF p_payment_status <> 'paid'
     OR p_initial_invoice_status <> 'paid'
     OR NULLIF(p_stripe_initial_invoice_id, '') IS NULL
     OR p_checkout_session_invoice_id IS DISTINCT FROM p_stripe_initial_invoice_id
     OR NULLIF(p_stripe_payment_intent_id, '') IS NULL
     OR p_initial_invoice_amount_due <> attempt.expected_initial_amount_cents
     OR p_initial_invoice_amount_paid <> attempt.expected_initial_amount_cents
     OR p_initial_invoice_currency <> attempt.expected_currency
     OR p_payment_intent_status <> 'succeeded'
     OR p_payment_intent_amount_received <> attempt.expected_initial_amount_cents THEN
    RAISE EXCEPTION 'Initial invoice or PaymentIntent does not prove the canonical amount' USING ERRCODE = '22023';
  END IF;
  IF entitlement.service_start_mode = 'immediate'
     AND (p_subscription_status <> 'active' OR p_subscription_trial_end IS NOT NULL) THEN
    RAISE EXCEPTION 'Immediate service requires an active non-trialing subscription' USING ERRCODE = '22023';
  END IF;
  IF entitlement.service_start_mode = 'scheduled'
     AND (
       p_subscription_status <> 'trialing'
       OR p_subscription_trial_end IS DISTINCT FROM attempt.expected_trial_end
     ) THEN
    RAISE EXCEPTION 'Scheduled service requires the exact signed trial end' USING ERRCODE = '22023';
  END IF;
  IF attempt.state = 'session_open' THEN
    PERFORM public.transition_server_checkout_attempt(attempt.id, 'session_open', 'checkout_completed_unverified');
    attempt.state := 'checkout_completed_unverified';
  END IF;
  IF attempt.state = 'checkout_completed_unverified' THEN
    PERFORM public.transition_server_checkout_attempt(attempt.id, 'checkout_completed_unverified', 'provider_reconciling');
    attempt.state := 'provider_reconciling';
  END IF;
  IF attempt.state <> 'provider_reconciling' THEN
    RAISE EXCEPTION 'Checkout cannot be reconciled from state %', attempt.state USING ERRCODE = '55000';
  END IF;

  UPDATE public.server_checkout_attempts
  SET state = p_next_state,
      stripe_customer_id = p_stripe_customer_id,
      stripe_subscription_id = p_stripe_subscription_id,
      stripe_initial_invoice_id = p_stripe_initial_invoice_id,
      stripe_payment_intent_id = p_stripe_payment_intent_id,
      initial_invoice_status = p_initial_invoice_status,
      initial_invoice_amount_due = p_initial_invoice_amount_due,
      initial_invoice_amount_paid = p_initial_invoice_amount_paid,
      initial_invoice_currency = p_initial_invoice_currency,
      payment_intent_status = p_payment_intent_status,
      payment_intent_amount_received = p_payment_intent_amount_received,
      subscription_status = p_subscription_status,
      subscription_trial_end = p_subscription_trial_end,
      service_billing_state = CASE WHEN p_next_state = 'payment_verified_scheduled' THEN 'scheduled' ELSE 'active' END,
      completed_at = now(),
      updated_at = now()
  WHERE id = attempt.id;

  INSERT INTO public.server_checkout_provider_events (
    provider_event_id, provider_event_type, provider_event_created,
    checkout_attempt_id, checkout_session_id, stripe_account_id,
    provider_environment, livemode, payload_sha256, result, reconciled_at
  ) VALUES (
    p_provider_event_id, p_provider_event_type, p_provider_event_created,
    attempt.id, p_checkout_session_id, p_stripe_account_id,
    p_provider_environment, p_livemode, p_payload_sha256, 'reconciled', now()
  );

  -- The outbox row is written in this same transaction. No webhook handler can
  -- call GHL before the canonical IDs and provider event have committed.
  INSERT INTO public.ghl_checkout_sync_outbox (
    event_key, checkout_attempt_id, highlevel_contact_id, projection
  ) VALUES (
    format('rf.ghl.checkout-verified.v1:%s', attempt.id),
    attempt.id,
    entitlement.highlevel_contact_id,
    jsonb_build_object(
      'highlevel_contact_id', entitlement.highlevel_contact_id,
      'agreement_document_id', entitlement.agreement_document_id,
      'checkout_session_id', p_checkout_session_id,
      'stripe_customer_id', p_stripe_customer_id,
      'stripe_subscription_id', p_stripe_subscription_id,
      'stripe_initial_invoice_id', p_stripe_initial_invoice_id,
      'stripe_payment_intent_id', p_stripe_payment_intent_id,
      'payment_state', p_next_state
    )
  ) ON CONFLICT (event_key) DO NOTHING;

  RETURN jsonb_build_object('result', 'reconciled', 'duplicate', FALSE, 'attempt_id', attempt.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_server_checkout_event_conflict(
  p_provider_event_id TEXT,
  p_provider_event_type TEXT,
  p_provider_event_created BIGINT,
  p_payload_sha256 TEXT,
  p_checkout_session_id TEXT,
  p_stripe_account_id TEXT,
  p_provider_environment TEXT,
  p_livemode BOOLEAN,
  p_error_code TEXT,
  p_observation JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attempt public.server_checkout_attempts%ROWTYPE;
  existing_event public.server_checkout_provider_events%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider_event_id, 0));
  SELECT * INTO existing_event
  FROM public.server_checkout_provider_events
  WHERE provider_event_id = p_provider_event_id;
  IF existing_event.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'result', existing_event.result,
      'duplicate', TRUE,
      'attempt_id', existing_event.checkout_attempt_id
    );
  END IF;
  IF p_payload_sha256 !~ '^[a-f0-9]{64}$'
     OR p_provider_environment NOT IN ('isolated_fixture', 'test', 'live')
     OR p_error_code NOT IN (
       'unsupported_event', 'unknown_checkout', 'provider_identity_conflict',
       'provider_line_item_conflict', 'initial_payment_unverified',
       'initial_invoice_conflict', 'subscription_state_conflict',
       'scheduled_trial_conflict'
     )
     OR jsonb_typeof(p_observation) <> 'object'
     OR octet_length(p_observation::TEXT) > 4096
     OR p_observation - ARRAY[
       'checkoutSessionId', 'stripeAccountId', 'livemode', 'environment',
       'paymentStatus', 'invoiceStatus', 'invoiceAmountDue', 'invoiceAmountPaid',
       'invoiceCurrency', 'paymentIntentStatus', 'paymentIntentAmountReceived',
       'subscriptionStatus', 'subscriptionTrialEnd'
     ] <> '{}'::JSONB THEN
    RAISE EXCEPTION 'Conflict observation is invalid or unbounded' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO attempt
  FROM public.server_checkout_attempts
  WHERE checkout_session_id = p_checkout_session_id
  FOR UPDATE;

  SELECT * INTO existing_event
  FROM public.server_checkout_provider_events
  WHERE provider_event_id = p_provider_event_id;
  IF existing_event.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'result', existing_event.result,
      'duplicate', TRUE,
      'attempt_id', existing_event.checkout_attempt_id
    );
  END IF;

  IF attempt.id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.server_checkout_state_transitions
       WHERE from_state = attempt.state AND to_state = 'provider_conflict'
     ) THEN
    UPDATE public.server_checkout_attempts
    SET state = 'provider_conflict',
        failure_code = p_error_code,
        updated_at = now()
    WHERE id = attempt.id;
  END IF;

  INSERT INTO public.server_checkout_provider_events (
    provider_event_id, provider_event_type, provider_event_created,
    checkout_attempt_id, checkout_session_id, stripe_account_id,
    provider_environment, livemode, payload_sha256, result,
    error_code, observation, reconciled_at
  ) VALUES (
    p_provider_event_id, p_provider_event_type, p_provider_event_created,
    attempt.id, p_checkout_session_id, p_stripe_account_id,
    p_provider_environment, p_livemode, p_payload_sha256, 'conflict',
    p_error_code, p_observation, NULL
  );

  RETURN jsonb_build_object(
    'result', 'conflict',
    'duplicate', FALSE,
    'attempt_id', attempt.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_server_checkout_attempt(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_server_checkout_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_server_checkout_service_billing_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_agreement_entitlement_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_server_checkout_attempt_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_final_assembly_handoff_gate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.server_checkout_line_items_valid(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_server_checkout_session(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_server_checkout_attempt(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_server_checkout_expected(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_server_checkout_event(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_server_checkout_event_conflict(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_server_checkout_attempt(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_server_checkout_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_server_checkout_service_billing_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_agreement_entitlement_immutability() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_server_checkout_attempt_immutability() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_final_assembly_handoff_gate() TO service_role;
GRANT EXECUTE ON FUNCTION public.server_checkout_line_items_valid(JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_server_checkout_session(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_server_checkout_attempt(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_server_checkout_expected(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_server_checkout_event(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, BIGINT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_server_checkout_event_conflict(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB)
  TO service_role;

COMMENT ON TABLE public.ghl_checkout_sync_outbox IS
  'Draft/Test ledger only. No worker is enabled by migration 088.';
