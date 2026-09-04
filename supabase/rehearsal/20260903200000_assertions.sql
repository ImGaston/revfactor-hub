\set ON_ERROR_STOP on

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'onboarding_commercial_groups', 'onboarding_billing_accounts',
    'onboarding_billing_account_transitions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS missing for %', table_name;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.onboarding_billing_accounts', 'INSERT')
     OR has_function_privilege('authenticated', 'public.onboarding_group_commercially_complete(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Multi-business write authority escaped the service role';
  END IF;
END;
$$;

DO $$
DECLARE
  v_client UUID;
  v_run UUID;
  v_group UUID;
  v_account UUID;
  v_entitlement UUID;
  v_attempt UUID;
  v_sequence INTEGER;
  v_customer TEXT;
  v_subscription TEXT;
  v_lines JSONB;
BEGIN
  INSERT INTO public.clients (ghl_contact_id)
  VALUES ('contact_multi_rehearsal') RETURNING id INTO v_client;
  INSERT INTO public.onboarding_runs (
    client_id, external_key, status, source_system, submitted_at
  ) VALUES (
    v_client, 'multi-business-rehearsal', 'submitted', 'ghl', now()
  ) RETURNING id INTO v_run;
  INSERT INTO public.onboarding_commercial_groups (
    external_key, highlevel_location_id, highlevel_contact_id,
    billing_mode, total_listing_count, billing_account_count,
    pricing_program, onboarding_fee_total_cents, currency, tax_policy,
    client_id, onboarding_run_id
  ) VALUES (
    'rfg_' || repeat('c', 32), 'loc_multi', 'contact_multi_rehearsal',
    'separate_per_listing', 2, 2, 'Regular', 15000, 'usd', 'configured',
    v_client, v_run
  ) RETURNING id INTO v_group;
  UPDATE public.onboarding_runs SET commercial_group_id = v_group WHERE id = v_run;

  FOR v_sequence IN 1..2 LOOP
    v_customer := 'cus_multi_' || v_sequence;
    v_subscription := 'sub_multi_' || v_sequence;
    INSERT INTO public.onboarding_billing_accounts (
      group_id, sequence, highlevel_opportunity_id, legal_business_name,
      normalized_legal_business_name, listing_quantity, pricing_program,
      monthly_rate_cents, monthly_amount_cents, onboarding_fee_cents,
      initial_checkout_total_cents
    ) VALUES (
      v_group, v_sequence, 'opp_multi_' || v_sequence,
      'Property ' || v_sequence || ' LLC', 'property ' || v_sequence || ' llc',
      1, 'Regular', 35000, 35000, 7500, 42500
    ) RETURNING id INTO v_account;

    INSERT INTO public.agreement_entitlements (
      jti, status, environment, stripe_account_id,
      highlevel_location_id, highlevel_contact_id, highlevel_opportunity_id,
      onboarding_group_id, billing_account_id, account_sequence, account_count,
      total_listing_count, billing_mode,
      agreement_document_id, agreement_template_id, agreement_revision,
      agreement_content_sha256, signed_at, expires_at,
      primary_quantity, child_quantity, onboarding_fee_cents,
      service_start_mode, service_start_date, currency, price_book_version,
      tax_policy, onboarding_run_id
    ) VALUES (
      'multi-business-entitlement-' || v_sequence, 'active', 'isolated_fixture',
      'fixture:acct_multi', 'loc_multi', 'contact_multi_rehearsal',
      'opp_multi_' || v_sequence, v_group, v_account, v_sequence, 2, 2,
      'separate_per_listing', 'doc_multi_' || v_sequence, 'template_multi', 1,
      repeat(v_sequence::TEXT, 64), now(), now() + INTERVAL '1 day',
      1, 0, 7500, 'immediate', NULL, 'usd', 'rf-standard-usd-v1',
      'provisional_fixture_only', v_run
    ) RETURNING id INTO v_entitlement;

    v_lines := jsonb_build_array(
      jsonb_build_object('priceId', 'price_onboarding_75', 'quantity', 1, 'kind', 'one_time', 'unitAmount', 7500, 'currency', 'usd'),
      jsonb_build_object('priceId', 'price_primary', 'quantity', 1, 'kind', 'recurring', 'unitAmount', 35000, 'currency', 'usd')
    );
    SELECT id INTO v_attempt FROM public.claim_server_checkout_attempt(
      v_entitlement,
      md5('multi-business-account-' || v_sequence) || md5('checkout-' || v_sequence),
      v_lines
    );
    PERFORM public.attach_server_checkout_session(
      v_attempt, 'session_creating', 'cs_multi_' || v_sequence,
      'https://checkout.invalid/multi/' || v_sequence
    );
    PERFORM public.transition_server_checkout_attempt(v_attempt, 'session_open', 'checkout_completed_unverified');
    PERFORM public.transition_server_checkout_attempt(v_attempt, 'checkout_completed_unverified', 'provider_reconciling');
    UPDATE public.server_checkout_attempts
    SET state = 'payment_verified', stripe_customer_id = v_customer,
        stripe_subscription_id = v_subscription,
        stripe_initial_invoice_id = 'in_multi_' || v_sequence,
        stripe_payment_intent_id = 'pi_multi_' || v_sequence,
        service_billing_state = 'active'
    WHERE id = v_attempt;

    UPDATE public.onboarding_billing_accounts
    SET state = 'agreement_signed', agreement_entitlement_id = v_entitlement
    WHERE id = v_account;
    UPDATE public.onboarding_billing_accounts SET state = 'payment_pending' WHERE id = v_account;
    UPDATE public.onboarding_billing_accounts
    SET state = 'payment_verified', stripe_customer_id = v_customer,
        stripe_subscription_id = v_subscription
    WHERE id = v_account;
    UPDATE public.onboarding_billing_accounts SET state = 'complete' WHERE id = v_account;
    INSERT INTO public.client_stripe_customers (client_id, stripe_customer_id)
    VALUES (v_client, v_customer);
    INSERT INTO public.onboarding_run_listings (
      run_id, external_key, listing_kind, sequence, billing_account_id
    ) VALUES (
      v_run, 'primary-' || v_sequence, 'primary', v_sequence, v_account
    );
  END LOOP;

  IF public.onboarding_group_commercially_complete(v_group) IS NOT TRUE THEN
    RAISE EXCEPTION 'Fully verified multi-business group did not unlock';
  END IF;
  INSERT INTO public.onboarding_handoff_outbox (run_id, event_key, payload)
  VALUES (v_run, 'rf.onboarding.v1:' || v_run::TEXT, jsonb_build_object('run_id', v_run));

  BEGIN
    UPDATE public.onboarding_billing_accounts
    SET onboarding_fee_cents = 3000
    WHERE group_id = v_group AND sequence = 1;
    RAISE EXCEPTION 'Commercial account mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE '22023' THEN NULL;
  END;
END;
$$;
