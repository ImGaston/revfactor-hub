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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agreement_document_id, agreement_revision),
  CHECK (expires_at > signed_at),
  CHECK (
    (service_start_mode = 'immediate' AND service_start_date IS NULL)
    OR (service_start_mode = 'scheduled' AND service_start_date IS NOT NULL)
  ),
  CHECK (tax_policy = 'policy_blocked' OR environment = 'isolated_fixture'),
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
  ('session_open', 'checkout_completed_unverified'), ('session_open', 'session_expired'), ('session_open', 'payment_failed'), ('session_open', 'cancelled'),
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
  line_items JSONB NOT NULL CHECK (
    jsonb_typeof(line_items) = 'array'
    AND jsonb_array_length(line_items) BETWEEN 2 AND 3
  ),
  checkout_session_id TEXT UNIQUE,
  checkout_url TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  service_billing_state TEXT NOT NULL DEFAULT 'not_started'
    CHECK (service_billing_state IN ('not_started', 'scheduled', 'active', 'past_due', 'failed', 'cancelled')),
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (entitlement_id, generation)
);

CREATE UNIQUE INDEX server_checkout_attempts_one_active_generation
  ON public.server_checkout_attempts (entitlement_id)
  WHERE state IN (
    'session_creating', 'session_open', 'checkout_completed_unverified',
    'provider_reconciling', 'payment_verified', 'payment_verified_scheduled',
    'ghl_sync_pending', 'ghl_onboarding_unlocked', 'service_billing_active',
    'service_billing_failed', 'manual_review'
  );

CREATE TABLE public.server_checkout_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_event_type TEXT NOT NULL,
  provider_event_created BIGINT NOT NULL CHECK (provider_event_created > 0),
  checkout_attempt_id UUID NOT NULL REFERENCES public.server_checkout_attempts(id) ON DELETE RESTRICT,
  checkout_session_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
      'stripe_customer_id', 'stripe_subscription_id', 'payment_state'
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
ALTER TABLE public.server_checkout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_checkout_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghl_checkout_sync_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view agreement entitlements"
  ON public.agreement_entitlements FOR SELECT TO authenticated
  USING (public.get_my_role() = 'super_admin');
CREATE POLICY "Super admins can view checkout transitions"
  ON public.server_checkout_state_transitions FOR SELECT TO authenticated
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
REVOKE ALL ON TABLE public.server_checkout_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.server_checkout_provider_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ghl_checkout_sync_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agreement_entitlements TO authenticated;
GRANT SELECT ON TABLE public.server_checkout_state_transitions TO authenticated;
GRANT SELECT ON TABLE public.server_checkout_attempts TO authenticated;
GRANT SELECT ON TABLE public.server_checkout_provider_events TO authenticated;
GRANT SELECT ON TABLE public.ghl_checkout_sync_outbox TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agreement_entitlements TO service_role;
GRANT SELECT ON TABLE public.server_checkout_state_transitions TO service_role;
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
BEGIN
  IF p_identity_sha256 !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_line_items) <> 'array'
     OR jsonb_array_length(p_line_items) NOT BETWEEN 2 AND 3 THEN
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
    entitlement_id, generation, identity_sha256, idempotency_key, state, line_items
  ) VALUES (
    p_entitlement_id,
    next_generation,
    p_identity_sha256,
    format('rf-checkout-%s-g%s', left(p_identity_sha256, 48), next_generation),
    'session_creating',
    p_line_items
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

CREATE OR REPLACE FUNCTION public.reconcile_server_checkout_event(
  p_provider_event_id TEXT,
  p_provider_event_type TEXT,
  p_provider_event_created BIGINT,
  p_payload_sha256 TEXT,
  p_checkout_session_id TEXT,
  p_provider_line_items JSONB,
  p_stripe_customer_id TEXT,
  p_stripe_subscription_id TEXT,
  p_stripe_payment_intent_id TEXT,
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
BEGIN
  IF p_provider_event_type <> 'checkout.session.completed'
     OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
     OR p_next_state NOT IN ('payment_verified', 'payment_verified_scheduled') THEN
    RAISE EXCEPTION 'Provider event is not allowlisted' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.server_checkout_provider_events
    WHERE provider_event_id = p_provider_event_id
  ) THEN
    SELECT checkout_attempt_id INTO duplicate_attempt_id
    FROM public.server_checkout_provider_events
    WHERE provider_event_id = p_provider_event_id;
    RETURN jsonb_build_object('duplicate', TRUE, 'attempt_id', duplicate_attempt_id);
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
    RETURN jsonb_build_object('duplicate', TRUE, 'attempt_id', attempt.id);
  END IF;
  IF attempt.line_items <> p_provider_line_items THEN
    RAISE EXCEPTION 'Provider prices or quantities conflict with canonical checkout' USING ERRCODE = '22023';
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
      stripe_payment_intent_id = NULLIF(p_stripe_payment_intent_id, ''),
      service_billing_state = CASE WHEN p_next_state = 'payment_verified_scheduled' THEN 'scheduled' ELSE 'active' END,
      completed_at = now(),
      updated_at = now()
  WHERE id = attempt.id;

  INSERT INTO public.server_checkout_provider_events (
    provider_event_id, provider_event_type, provider_event_created,
    checkout_attempt_id, checkout_session_id, payload_sha256
  ) VALUES (
    p_provider_event_id, p_provider_event_type, p_provider_event_created,
    attempt.id, p_checkout_session_id, p_payload_sha256
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
      'payment_state', p_next_state
    )
  ) ON CONFLICT (event_key) DO NOTHING;

  RETURN jsonb_build_object('duplicate', FALSE, 'attempt_id', attempt.id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_server_checkout_attempt(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_server_checkout_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_server_checkout_session(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_server_checkout_attempt(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_server_checkout_event(TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_server_checkout_attempt(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_server_checkout_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_server_checkout_session(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_server_checkout_attempt(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_server_checkout_event(TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON TABLE public.ghl_checkout_sync_outbox IS
  'Draft/Test ledger only. No worker is enabled by migration 088.';
