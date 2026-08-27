\set ON_ERROR_STOP on

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'agreement_entitlements', 'server_checkout_state_transitions',
    'server_checkout_service_billing_transitions', 'server_checkout_attempts',
    'server_checkout_provider_events', 'ghl_checkout_sync_outbox'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS missing for %', table_name;
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.server_checkout_attempts', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has checkout INSERT';
  END IF;
  IF has_table_privilege('anon', 'public.server_checkout_attempts', 'SELECT') THEN
    RAISE EXCEPTION 'anon unexpectedly has checkout SELECT';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.claim_server_checkout_attempt(uuid,text,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated unexpectedly has claim EXECUTE';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    'public.claim_server_checkout_attempt(uuid,text,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role is missing claim EXECUTE';
  END IF;
  IF to_regprocedure('public.attach_server_checkout_session(uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.transition_server_checkout_attempt(uuid,text,text)') IS NULL
     OR to_regprocedure('public.record_server_checkout_event_conflict(text,text,bigint,text,text,text,text,boolean,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Expected migration 088 function signature is missing';
  END IF;
END;
$$;

DO $$
DECLARE
  entitlement_id UUID;
  client_id UUID;
  rehearsal_run_id UUID;
  attempt public.server_checkout_attempts%ROWTYPE;
  lines JSONB := '[
    {"priceId":"price_child","quantity":1,"kind":"recurring","unitAmount":5000,"currency":"usd"},
    {"priceId":"price_onboarding","quantity":1,"kind":"one_time","unitAmount":15000,"currency":"usd"},
    {"priceId":"price_primary","quantity":2,"kind":"recurring","unitAmount":35000,"currency":"usd"}
  ]'::JSONB;
BEGIN
  INSERT INTO public.agreement_entitlements (
    jti, status, environment, stripe_account_id,
    highlevel_location_id, highlevel_contact_id,
    agreement_document_id, agreement_template_id, agreement_revision,
    agreement_content_sha256, signed_at, expires_at,
    primary_quantity, child_quantity, onboarding_fee_cents,
    service_start_mode, service_start_date, currency, price_book_version,
    tax_policy
  ) VALUES (
    'rehearsal-agreement-revision-1', 'active', 'isolated_fixture', 'fixture:acct_checkout',
    'loc_rehearsal', 'contact_rehearsal',
    'doc_rehearsal', 'template_rehearsal', 1,
    repeat('a', 64), now(), now() + INTERVAL '1 day',
    2, 1, 15000, 'scheduled', DATE '2026-09-15', 'usd', 'rf-usd-v1',
    'provisional_fixture_only'
  ) RETURNING id INTO entitlement_id;

  INSERT INTO public.clients (ghl_contact_id)
  VALUES ('contact_rehearsal')
  RETURNING id INTO client_id;
  INSERT INTO public.onboarding_runs (
    client_id, external_key, status, source_system, submitted_at
  ) VALUES (
    client_id, 'run-rehearsal', 'submitted', 'ghl', now()
  ) RETURNING id INTO rehearsal_run_id;
  UPDATE public.agreement_entitlements
  SET onboarding_run_id = rehearsal_run_id
  WHERE id = entitlement_id;

  SELECT * INTO attempt FROM public.claim_server_checkout_attempt(
    entitlement_id, repeat('b', 64), lines
  );
  IF attempt.expected_initial_amount_cents <> 15000
     OR attempt.expected_trial_end <> EXTRACT(EPOCH FROM TIMESTAMPTZ '2026-09-15 12:00:00+00')::BIGINT
     OR attempt.provider_environment <> 'isolated_fixture'
     OR attempt.stripe_account_id <> 'fixture:acct_checkout'
     OR attempt.livemode THEN
    RAISE EXCEPTION 'Claim did not freeze canonical scheduled authority';
  END IF;

  PERFORM public.attach_server_checkout_session(
    attempt.id, 'session_creating', 'cs_rehearsal', 'https://checkout.invalid/rehearsal'
  );

  BEGIN
    INSERT INTO public.onboarding_handoff_outbox (run_id, event_key, payload)
    VALUES (
      rehearsal_run_id, 'rf.onboarding.v1:' || rehearsal_run_id::TEXT,
      jsonb_build_object('run_id', rehearsal_run_id)
    );
    RAISE EXCEPTION 'Assembly handoff unexpectedly bypassed commercial state';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE public.agreement_entitlements
    SET primary_quantity = 5
    WHERE id = entitlement_id;
    RAISE EXCEPTION 'Agreement commercial mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE public.server_checkout_attempts
    SET line_items = '[]'::JSONB
    WHERE id = attempt.id;
    RAISE EXCEPTION 'Attempt authority mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE public.server_checkout_attempts
    SET service_billing_state = 'cancelled'
    WHERE id = attempt.id;
    RAISE EXCEPTION 'Illegal service billing transition unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  PERFORM public.reconcile_server_checkout_event(
    'evt_rehearsal', 'checkout.session.completed', 1787846400, repeat('c', 64),
    'cs_rehearsal', 'fixture:acct_checkout', 'isolated_fixture', FALSE,
    lines, 'cus_rehearsal', 'sub_rehearsal', 'in_rehearsal', 'in_rehearsal', 'pi_rehearsal',
    'paid', 'paid', 15000, 15000, 'usd', 'succeeded', 15000,
    'trialing', EXTRACT(EPOCH FROM TIMESTAMPTZ '2026-09-15 12:00:00+00')::BIGINT,
    'payment_verified_scheduled'
  );

  IF (SELECT COUNT(*) FROM public.server_checkout_provider_events WHERE provider_event_id = 'evt_rehearsal') <> 1
     OR (SELECT COUNT(*) FROM public.ghl_checkout_sync_outbox WHERE checkout_attempt_id = attempt.id) <> 1
     OR (SELECT stripe_initial_invoice_id FROM public.server_checkout_attempts WHERE id = attempt.id) <> 'in_rehearsal' THEN
    RAISE EXCEPTION 'Atomic reconciliation ledger/outbox invariant failed';
  END IF;

  PERFORM public.transition_server_checkout_attempt(
    attempt.id, 'payment_verified_scheduled', 'ghl_sync_pending'
  );
  PERFORM public.transition_server_checkout_attempt(
    attempt.id, 'ghl_sync_pending', 'ghl_onboarding_unlocked'
  );
  INSERT INTO public.onboarding_handoff_outbox (run_id, event_key, payload)
  VALUES (
    rehearsal_run_id, 'rf.onboarding.v1:' || rehearsal_run_id::TEXT,
    jsonb_build_object('run_id', rehearsal_run_id)
  );
  IF (
    SELECT COUNT(*) FROM public.onboarding_handoff_outbox
    WHERE run_id = rehearsal_run_id
  ) <> 1 THEN
    RAISE EXCEPTION 'Final Assembly handoff gate did not create one stable event';
  END IF;

  PERFORM public.reconcile_server_checkout_event(
    'evt_rehearsal', 'checkout.session.completed', 1787846400, repeat('c', 64),
    'cs_rehearsal', 'fixture:acct_checkout', 'isolated_fixture', FALSE,
    lines, 'cus_rehearsal', 'sub_rehearsal', 'in_rehearsal', 'in_rehearsal', 'pi_rehearsal',
    'paid', 'paid', 15000, 15000, 'usd', 'succeeded', 15000,
    'trialing', EXTRACT(EPOCH FROM TIMESTAMPTZ '2026-09-15 12:00:00+00')::BIGINT,
    'payment_verified_scheduled'
  );
  IF (SELECT COUNT(*) FROM public.server_checkout_provider_events WHERE provider_event_id = 'evt_rehearsal') <> 1
     OR (SELECT COUNT(*) FROM public.ghl_checkout_sync_outbox WHERE checkout_attempt_id = attempt.id) <> 1 THEN
    RAISE EXCEPTION 'Replay created duplicate ledger or outbox rows';
  END IF;
END;
$$;

DO $$
DECLARE
  conflict JSONB;
BEGIN
  SELECT public.record_server_checkout_event_conflict(
    'evt_unknown', 'checkout.session.completed', 1787846401, repeat('d', 64),
    'cs_unknown', 'fixture:acct_checkout', 'isolated_fixture', FALSE,
    'unknown_checkout',
    '{"checkoutSessionId":"cs_unknown","stripeAccountId":"fixture:acct_checkout","livemode":false,"environment":"isolated_fixture"}'::JSONB
  ) INTO conflict;
  IF conflict->>'result' <> 'conflict'
     OR (SELECT COUNT(*) FROM public.server_checkout_provider_events WHERE provider_event_id = 'evt_unknown' AND result = 'conflict') <> 1
     OR EXISTS (SELECT 1 FROM public.ghl_checkout_sync_outbox WHERE event_key LIKE '%unknown%') THEN
    RAISE EXCEPTION 'Unknown signed event was not durably and safely recorded';
  END IF;
  PERFORM public.record_server_checkout_event_conflict(
    'evt_unknown', 'checkout.session.completed', 1787846401, repeat('d', 64),
    'cs_unknown', 'fixture:acct_checkout', 'isolated_fixture', FALSE,
    'unknown_checkout',
    '{"checkoutSessionId":"cs_unknown","stripeAccountId":"fixture:acct_checkout","livemode":false,"environment":"isolated_fixture"}'::JSONB
  );
  IF (SELECT COUNT(*) FROM public.server_checkout_provider_events WHERE provider_event_id = 'evt_unknown') <> 1 THEN
    RAISE EXCEPTION 'Conflict replay created a duplicate event';
  END IF;
END;
$$;

DO $$
DECLARE
  entitlement_id UUID;
  attempt public.server_checkout_attempts%ROWTYPE;
  lines JSONB := '[
    {"priceId":"price_child","quantity":1,"kind":"recurring","unitAmount":5000,"currency":"usd"},
    {"priceId":"price_onboarding","quantity":1,"kind":"one_time","unitAmount":15000,"currency":"usd"},
    {"priceId":"price_primary","quantity":2,"kind":"recurring","unitAmount":35000,"currency":"usd"}
  ]'::JSONB;
BEGIN
  INSERT INTO public.agreement_entitlements (
    jti, status, environment, stripe_account_id,
    highlevel_location_id, highlevel_contact_id,
    agreement_document_id, agreement_template_id, agreement_revision,
    agreement_content_sha256, signed_at, expires_at,
    primary_quantity, child_quantity, onboarding_fee_cents,
    service_start_mode, service_start_date, currency, price_book_version,
    tax_policy
  ) VALUES (
    'rehearsal-immediate-revision-1', 'active', 'isolated_fixture', 'fixture:acct_checkout',
    'loc_rehearsal', 'contact_immediate',
    'doc_immediate', 'template_rehearsal', 1,
    repeat('e', 64), now(), now() + INTERVAL '1 day',
    2, 1, 15000, 'immediate', NULL, 'usd', 'rf-usd-v1',
    'provisional_fixture_only'
  ) RETURNING id INTO entitlement_id;
  SELECT * INTO attempt FROM public.claim_server_checkout_attempt(
    entitlement_id, repeat('f', 64), lines
  );
  IF attempt.expected_initial_amount_cents <> 90000
     OR attempt.expected_trial_end IS NOT NULL
     OR attempt.line_items <> lines THEN
    RAISE EXCEPTION 'Immediate claim authority or canonical line shape is wrong';
  END IF;
  PERFORM public.attach_server_checkout_session(
    attempt.id, 'session_creating', 'cs_out_of_order', 'https://checkout.invalid/out-of-order'
  );
  PERFORM public.record_server_checkout_event_conflict(
    'evt_out_of_order_conflict', 'checkout.session.completed', 1787846402, repeat('1', 64),
    'cs_out_of_order', 'fixture:acct_checkout', 'isolated_fixture', FALSE,
    'initial_invoice_conflict',
    '{"checkoutSessionId":"cs_out_of_order","stripeAccountId":"fixture:acct_checkout","livemode":false,"environment":"isolated_fixture","invoiceAmountPaid":14999}'::JSONB
  );
  BEGIN
    PERFORM public.reconcile_server_checkout_event(
      'evt_out_of_order_valid_later', 'checkout.session.completed', 1787846403, repeat('2', 64),
      'cs_out_of_order', 'fixture:acct_checkout', 'isolated_fixture', FALSE,
      lines, 'cus_immediate', 'sub_immediate', 'in_immediate', 'in_immediate', 'pi_immediate',
      'paid', 'paid', 90000, 90000, 'usd', 'succeeded', 90000,
      'active', NULL, 'payment_verified'
    );
    RAISE EXCEPTION 'Valid later event unexpectedly bypassed prior provider conflict';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF (SELECT state FROM public.server_checkout_attempts WHERE id = attempt.id) <> 'provider_conflict'
     OR (SELECT COUNT(*) FROM public.server_checkout_provider_events WHERE checkout_attempt_id = attempt.id) <> 1
     OR EXISTS (SELECT 1 FROM public.ghl_checkout_sync_outbox WHERE checkout_attempt_id = attempt.id) THEN
    RAISE EXCEPTION 'Out-of-order conflict did not fail closed';
  END IF;
END;
$$;

SET ROLE authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.server_checkout_attempts) THEN
    RAISE EXCEPTION 'Authenticated non-super-admin bypassed RLS';
  END IF;
END;
$$;
RESET ROLE;
