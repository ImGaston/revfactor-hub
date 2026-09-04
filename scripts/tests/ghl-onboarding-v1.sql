\set ON_ERROR_STOP on

-- Local PostgreSQL integration test for migrations 120000-127000.
-- Every fixture and temporary grant is rolled back.
BEGIN;

CREATE FUNCTION pg_temp.assert_true(condition BOOLEAN, message TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(condition, FALSE) THEN
    RAISE EXCEPTION 'assertion_failed: %', message;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.journey_payload(
  journey_id UUID,
  contact_id TEXT,
  opportunity_id TEXT,
  appointment_id TEXT,
  stage TEXT,
  accounts JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'version', 'rf.onboarding.v1',
    'id', journey_id,
    'contactId', contact_id,
    'opportunityId', opportunity_id,
    'appointmentId', appointment_id,
    'ownerId', 'owner-1',
    'email', contact_id || '@example.com',
    'name', 'Test Owner',
    'stage', stage,
    'accounts', accounts
  );
$$;

INSERT INTO public.profiles (id)
VALUES ('90000000-0000-0000-0000-000000000001');

-- Event idempotency, event-key conflict, revision CAS, and cross-journey
-- commercial identity uniqueness.
INSERT INTO public.ghl_onboarding_journeys (
  id, run_key, contact_id, opportunity_id, appointment_id, owner_id,
  team_profile_id, stage, payload, context_token_hash, context_expires_at
)
VALUES
  (
    '10000000-0000-0000-0000-000000000001', 'test:journey-1',
    'contact-1', 'opportunity-1', 'appointment-1', 'owner-1',
    '90000000-0000-0000-0000-000000000001', 'signup',
    pg_temp.journey_payload(
      '10000000-0000-0000-0000-000000000001',
      'contact-1', 'opportunity-1', 'appointment-1', 'signup'
    ),
    'test-token-hash-1', NOW() + INTERVAL '1 day'
  ),
  (
    '10000000-0000-0000-0000-000000000002', 'test:journey-2',
    'contact-2', 'opportunity-2', 'appointment-2', 'owner-2',
    '90000000-0000-0000-0000-000000000001', 'signup',
    pg_temp.journey_payload(
      '10000000-0000-0000-0000-000000000002',
      'contact-2', 'opportunity-2', 'appointment-2', 'signup'
    ),
    'test-token-hash-2', NOW() + INTERVAL '1 day'
  );

DO $$
DECLARE
  result JSONB;
BEGIN
  result := public.save_ghl_onboarding_v1(
    '10000000-0000-0000-0000-000000000001', 1,
    'event-save-1', 'hash-save-1', 'save',
    pg_temp.journey_payload(
      '10000000-0000-0000-0000-000000000001',
      'contact-1', 'opportunity-1', 'appointment-1', 'awaiting_payment'
    )
  );
  PERFORM pg_temp.assert_true(
    result = '{"revision": 2, "replayed": false}'::JSONB,
    'first event should advance revision exactly once'
  );

  result := public.save_ghl_onboarding_v1(
    '10000000-0000-0000-0000-000000000001', 1,
    'event-save-1', 'hash-save-1', 'save',
    pg_temp.journey_payload(
      '10000000-0000-0000-0000-000000000001',
      'contact-1', 'opportunity-1', 'appointment-1', 'awaiting_payment'
    )
  );
  PERFORM pg_temp.assert_true(
    result = '{"revision": 2, "replayed": true}'::JSONB,
    'same event key and hash should replay despite stale input revision'
  );

  BEGIN
    PERFORM public.save_ghl_onboarding_v1(
      '10000000-0000-0000-0000-000000000001', 2,
      'event-save-1', 'different-hash', 'save',
      pg_temp.journey_payload(
        '10000000-0000-0000-0000-000000000001',
        'contact-1', 'opportunity-1', 'appointment-1', 'awaiting_payment'
      )
    );
    RAISE EXCEPTION 'expected event_payload_conflict';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'event_payload_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.save_ghl_onboarding_v1(
      '10000000-0000-0000-0000-000000000001', 1,
      'event-stale-revision', 'hash-stale', 'save',
      pg_temp.journey_payload(
        '10000000-0000-0000-0000-000000000001',
        'contact-1', 'opportunity-1', 'appointment-1', 'awaiting_payment'
      )
    );
    RAISE EXCEPTION 'expected revision_conflict';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'revision_conflict' THEN RAISE; END IF;
  END;
END;
$$;

SELECT public.save_ghl_onboarding_v1(
  '10000000-0000-0000-0000-000000000001', 2,
  'event-bind-1', 'hash-bind-1', 'bind',
  pg_temp.journey_payload(
    '10000000-0000-0000-0000-000000000001',
    'contact-1', 'opportunity-1', 'appointment-1', 'awaiting_payment',
    jsonb_build_array(jsonb_build_object(
      'id', '20000000-0000-0000-0000-000000000001',
      'documentId', 'document-1',
      'invoiceId', 'invoice-shared',
      'stripePaymentIntentId', 'pi_1'
    ))
  )
);

DO $$
BEGIN
  BEGIN
    PERFORM public.save_ghl_onboarding_v1(
      '10000000-0000-0000-0000-000000000002', 1,
      'event-bind-duplicate', 'hash-bind-duplicate', 'bind',
      pg_temp.journey_payload(
        '10000000-0000-0000-0000-000000000002',
        'contact-2', 'opportunity-2', 'appointment-2', 'awaiting_payment',
        jsonb_build_array(jsonb_build_object(
          'id', '20000000-0000-0000-0000-000000000002',
          'documentId', 'document-2',
          'invoiceId', 'invoice-shared',
          'stripePaymentIntentId', 'pi_2'
        ))
      )
    );
    RAISE EXCEPTION 'expected duplicate invoice rejection';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

SELECT public.save_ghl_onboarding_v1(
  '10000000-0000-0000-0000-000000000001', 3,
  'event-submit-1', 'hash-submit-1', 'submit',
  pg_temp.journey_payload(
    '10000000-0000-0000-0000-000000000001',
    'contact-1', 'opportunity-1', 'appointment-1', 'submitted'
  )
);

DO $$
DECLARE frozen JSONB;
BEGIN
  SELECT submitted_snapshot INTO frozen
  FROM public.ghl_onboarding_journeys
  WHERE id = '10000000-0000-0000-0000-000000000001';

  BEGIN
    PERFORM public.save_ghl_onboarding_v1(
      '10000000-0000-0000-0000-000000000001', 4,
      'event-after-submit', 'hash-after-submit', 'save',
      pg_temp.journey_payload(
        '10000000-0000-0000-0000-000000000001',
        'contact-1', 'opportunity-1', 'appointment-1', 'submitted'
      )
    );
    RAISE EXCEPTION 'expected submitted_journey_locked';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'submitted_journey_locked' THEN RAISE; END IF;
  END;

  PERFORM pg_temp.assert_true(
    frozen = (
      SELECT submitted_snapshot FROM public.ghl_onboarding_journeys
      WHERE id = '10000000-0000-0000-0000-000000000001'
    ),
    'accepted snapshot changed after rejected save'
  );
END;
$$;

-- Worker lease, checkpoint CAS, retry accounting, and durable uncertain state.
DO $$
DECLARE
  job public.ghl_onboarding_jobs%ROWTYPE;
  stale_token UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  phase INTEGER;
  ok BOOLEAN;
BEGIN
  SELECT * INTO job FROM public.claim_ghl_onboarding_job('assembly_provision');
  PERFORM pg_temp.assert_true(job.id IS NOT NULL, 'assembly job was not claimable');

  ok := public.cas_ghl_assembly_checkpoint(
    'portal-1', 'rf-owner:contact-1', NULL,
    '{"revision":0,"phase":"claimed"}'::JSONB, job.id, stale_token
  );
  PERFORM pg_temp.assert_true(NOT ok, 'stale token wrote a checkpoint');

  ok := public.finish_ghl_assembly_job(
    job.id, stale_token, 'pending', '{"phase":"stale"}'::JSONB, NULL
  );
  PERFORM pg_temp.assert_true(NOT ok, 'stale token finished a job');

  ok := public.cas_ghl_assembly_checkpoint(
    'portal-1', 'rf-owner:contact-1', NULL,
    '{"revision":0,"phase":"claimed"}'::JSONB, job.id, job.lease_token
  );
  PERFORM pg_temp.assert_true(ok, 'initial checkpoint CAS failed');

  ok := public.cas_ghl_assembly_checkpoint(
    'portal-1', 'rf-owner:contact-1', NULL,
    '{"revision":0,"phase":"duplicate"}'::JSONB, job.id, job.lease_token
  );
  PERFORM pg_temp.assert_true(NOT ok, 'insert-only checkpoint CAS duplicated');

  ok := public.cas_ghl_assembly_checkpoint(
    'portal-1', 'rf-owner:contact-1', 0,
    '{"revision":1,"phase":"provider_uncertain"}'::JSONB,
    job.id, job.lease_token
  );
  PERFORM pg_temp.assert_true(ok, 'checkpoint revision CAS failed');

  ok := public.cas_ghl_assembly_checkpoint(
    'portal-1', 'rf-owner:contact-1', 0,
    '{"revision":1,"phase":"stale_writer"}'::JSONB,
    job.id, job.lease_token
  );
  PERFORM pg_temp.assert_true(NOT ok, 'stale checkpoint revision overwrote state');

  UPDATE public.ghl_onboarding_journeys
  SET payload = jsonb_set(payload, '{manualTakeover}', 'true')
  WHERE id = job.journey_id;
  ok := public.cas_ghl_assembly_checkpoint(
    'portal-1', 'rf-owner:contact-1', 1,
    '{"revision":2,"phase":"paused_writer"}'::JSONB,
    job.id, job.lease_token
  );
  PERFORM pg_temp.assert_true(NOT ok, 'paused journey accepted checkpoint CAS');
  UPDATE public.ghl_onboarding_journeys
  SET payload = payload - 'manualTakeover'
  WHERE id = job.journey_id;

  ok := public.finish_ghl_assembly_job(
    job.id, job.lease_token, 'pending', '{"phase":"provider_uncertain"}'::JSONB, NULL
  );
  PERFORM pg_temp.assert_true(ok, 'pending worker phase did not release lease');

  FOR phase IN 1..5 LOOP
    UPDATE public.ghl_onboarding_jobs SET available_at = NOW()
    WHERE id = job.id;
    SELECT * INTO job FROM public.claim_ghl_onboarding_job('assembly_provision');
    PERFORM pg_temp.assert_true(job.id IS NOT NULL, 'pending phase exhausted retry budget');
    ok := public.finish_ghl_assembly_job(
      job.id, job.lease_token, 'pending',
      jsonb_build_object('successfulPendingPhase', phase), NULL
    );
    PERFORM pg_temp.assert_true(ok, 'pending phase finish failed');
  END LOOP;

  PERFORM pg_temp.assert_true(
    (SELECT attempts >= 6 AND failure_count = 0 AND status = 'pending'
     FROM public.ghl_onboarding_jobs WHERE id = job.id),
    'successful pending phases consumed the failure budget'
  );
  PERFORM pg_temp.assert_true(
    (SELECT payload->>'phase' = 'provider_uncertain'
     FROM public.ghl_assembly_checkpoints
     WHERE portal_id = 'portal-1' AND owner_key = 'rf-owner:contact-1'),
    'uncertain provider checkpoint was not durable'
  );

  FOR phase IN 1..5 LOOP
    UPDATE public.ghl_onboarding_jobs SET available_at = NOW()
    WHERE id = job.id;
    SELECT * INTO job FROM public.claim_ghl_onboarding_job('assembly_provision');
    PERFORM pg_temp.assert_true(job.id IS NOT NULL, 'failed job was not reclaimable');
    ok := public.finish_ghl_assembly_job(
      job.id, job.lease_token, 'failed', '{}', 'provider_timeout'
    );
    PERFORM pg_temp.assert_true(ok, 'failed phase finish failed');
  END LOOP;

  PERFORM pg_temp.assert_true(
    (SELECT failure_count = 5 AND status = 'manual_review'
     FROM public.ghl_onboarding_jobs WHERE id = job.id),
    'fifth failure did not enter manual review'
  );
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 1 FROM public.ghl_onboarding_exceptions
     WHERE job_id = job.id AND code = 'provider_timeout' AND resolved_at IS NULL),
    'terminal failure did not create one open exception'
  );
END;
$$;

-- Human control atomically invalidates a live lease. Link renewal is limited to
-- a non-paused onboarding journey and replaces an expired capability hash.
UPDATE public.ghl_onboarding_jobs SET status = 'completed'
WHERE journey_id = '10000000-0000-0000-0000-000000000001'
  AND kind = 'ghl_progress';

INSERT INTO public.ghl_onboarding_jobs (journey_id, kind)
VALUES (
  '10000000-0000-0000-0000-000000000002', 'assembly_provision'
), (
  '10000000-0000-0000-0000-000000000002', 'ghl_progress'
);

DO $$
DECLARE
  job public.ghl_onboarding_jobs%ROWTYPE;
  progress_job public.ghl_onboarding_jobs%ROWTYPE;
  result JSONB;
  ok BOOLEAN;
BEGIN
  SELECT * INTO job FROM public.claim_ghl_onboarding_job('assembly_provision');
  PERFORM pg_temp.assert_true(
    job.journey_id = '10000000-0000-0000-0000-000000000002',
    'pause fixture job was not claimed'
  );
  SELECT * INTO progress_job FROM public.claim_ghl_onboarding_job('ghl_progress');
  PERFORM pg_temp.assert_true(
    progress_job.journey_id = '10000000-0000-0000-0000-000000000002',
    'pause fixture progress job was not claimed'
  );
  result := public.control_ghl_onboarding_v1(
    '10000000-0000-0000-0000-000000000002', 1,
    'pause', 'human_takeover', NULL
  );
  PERFORM pg_temp.assert_true(
    result->>'revision' = '2',
    'pause did not advance the journey revision'
  );
  PERFORM pg_temp.assert_true(
    (SELECT status = 'manual_review'
       AND lease_token IS NULL
       AND lease_until IS NULL
     FROM public.ghl_onboarding_jobs WHERE id = job.id),
    'pause did not invalidate the active job lease'
  );
  ok := public.finish_ghl_assembly_job(
    job.id, job.lease_token, 'pending', '{}', NULL
  );
  PERFORM pg_temp.assert_true(NOT ok, 'invalidated lease completed work');
  ok := public.finish_ghl_progress_v1(
    progress_job.id, progress_job.lease_token, 1, 'projected', NULL
  );
  PERFORM pg_temp.assert_true(
    NOT ok,
    'stale progress lease completed after pause'
  );
  PERFORM pg_temp.assert_true(
    (SELECT status = 'pending'
       AND failure_count = 0
       AND lease_token IS NULL
       AND lease_until IS NULL
       AND available_at >= NOW() + INTERVAL '29 seconds'
     FROM public.ghl_onboarding_jobs WHERE id = progress_job.id),
    'pause did not queue a fresh delayed progress repair'
  );
END;
$$;

INSERT INTO public.ghl_onboarding_journeys (
  id, run_key, contact_id, opportunity_id, appointment_id, owner_id,
  team_profile_id, stage, payload, context_token_hash, context_expires_at
)
VALUES (
  '10000000-0000-0000-0000-000000000005', 'test:journey-renew',
  'contact-renew', 'opportunity-renew', 'appointment-renew', 'owner-renew',
  '90000000-0000-0000-0000-000000000001', 'onboarding',
  pg_temp.journey_payload(
    '10000000-0000-0000-0000-000000000005',
    'contact-renew', 'opportunity-renew', 'appointment-renew', 'onboarding'
  ),
  'expired-token-hash', NOW() - INTERVAL '1 day'
);

SELECT public.control_ghl_onboarding_v1(
  '10000000-0000-0000-0000-000000000005', 1,
  'renew_link', NULL, REPEAT('a', 64)
);
SELECT pg_temp.assert_true(
  (SELECT revision = 2
     AND context_token_hash = REPEAT('a', 64)
     AND context_expires_at > NOW() + INTERVAL '13 days'
   FROM public.ghl_onboarding_journeys
   WHERE id = '10000000-0000-0000-0000-000000000005'),
  'expired onboarding link was not renewed'
);

-- Projection failures have an independent bounded retry budget and preserve
-- the journey owner on the terminal exception.
INSERT INTO public.ghl_onboarding_journeys (
  id, run_key, contact_id, opportunity_id, appointment_id, owner_id,
  team_profile_id, stage, payload, context_token_hash, context_expires_at
)
VALUES (
  '10000000-0000-0000-0000-000000000006', 'test:journey-progress',
  'contact-progress', 'opportunity-progress', 'appointment-progress',
  'owner-progress', '90000000-0000-0000-0000-000000000001', 'signup',
  pg_temp.journey_payload(
    '10000000-0000-0000-0000-000000000006',
    'contact-progress', 'opportunity-progress', 'appointment-progress', 'signup'
  ),
  'test-token-hash-progress', NOW() + INTERVAL '1 day'
);
INSERT INTO public.ghl_onboarding_jobs (journey_id, kind, available_at)
VALUES (
  '10000000-0000-0000-0000-000000000006',
  'ghl_progress', NOW() - INTERVAL '1 minute'
);

DO $$
DECLARE
  job public.ghl_onboarding_jobs%ROWTYPE;
  attempt INTEGER;
  ok BOOLEAN;
BEGIN
  FOR attempt IN 1..5 LOOP
    UPDATE public.ghl_onboarding_jobs
    SET available_at = NOW() - INTERVAL '1 second'
    WHERE journey_id = '10000000-0000-0000-0000-000000000006'
      AND kind = 'ghl_progress';
    SELECT * INTO job FROM public.claim_ghl_onboarding_job('ghl_progress');
    PERFORM pg_temp.assert_true(
      job.journey_id = '10000000-0000-0000-0000-000000000006',
      'progress retry fixture was not claimed'
    );
    ok := public.finish_ghl_progress_v1(
      job.id, job.lease_token, 1, 'failed', 'progress_timeout'
    );
    PERFORM pg_temp.assert_true(ok, 'progress failure was not persisted');
  END LOOP;
  PERFORM pg_temp.assert_true(
    (SELECT status = 'manual_review' AND failure_count = 5
     FROM public.ghl_onboarding_jobs WHERE id = job.id),
    'progress fifth failure did not stop retries'
  );
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 1 FROM public.ghl_onboarding_exceptions
     WHERE job_id = job.id
       AND owner_id = 'owner-progress'
       AND code = 'progress_timeout'
       AND resolved_at IS NULL),
    'progress terminal exception was not assigned to the journey owner'
  );
END;
$$;

-- Full runtime handoff through finish_ghl_assembly_job ->
-- link_ghl_onboarding_operations, followed by idempotent relinking and
-- activation queue dedupe.
INSERT INTO public.ghl_onboarding_journeys (
  id, run_key, contact_id, opportunity_id, appointment_id, owner_id,
  team_profile_id, stage, payload, submitted_snapshot, context_token_hash,
  context_expires_at
)
SELECT
  '10000000-0000-0000-0000-000000000003', 'test:journey-link',
  'contact-link', 'opportunity-link', 'appointment-link', 'owner-link',
  '90000000-0000-0000-0000-000000000001', 'submitted',
  snapshot,
  snapshot,
  'test-token-hash-link', NOW() + INTERVAL '1 day'
FROM (
  SELECT jsonb_build_object(
    'version', 'rf.onboarding.v1',
    'id', '10000000-0000-0000-0000-000000000003',
    'contactId', 'contact-link',
    'opportunityId', 'opportunity-link',
    'appointmentId', 'appointment-link',
    'ownerId', 'owner-link',
    'email', 'link-fixture@example.com',
    'name', 'Link Fixture',
    'stage', 'submitted',
    'properties', jsonb_build_array(jsonb_build_object(
      'id', '30000000-0000-0000-0000-000000000001',
      'billingAccountId', '20000000-0000-0000-0000-000000000003',
      'ghlRecordId', 'ghl-property-private',
      'name', 'Fixture Property',
      'listingUrl', 'https://www.airbnb.com/rooms/123',
      'status', 'live',
      'targetLaunchDate', NULL,
      'address', jsonb_build_object(
        'street', '1 Main St', 'city', 'Austin', 'region', 'TX',
        'postalCode', '78701', 'country', 'US'
      ),
      'preferences', jsonb_build_object(
        'goal', 'guidance',
        'minimumNightly', jsonb_build_object('mode', 'specified', 'value', 225),
        'cleaningFee', jsonb_build_object('mode', 'guidance'),
        'minimumStay', jsonb_build_object('mode', 'specified', 'nights', 3)
      )
    )),
    'software', jsonb_build_object(
      'pms', 'done', 'pmsName', 'Hospitable',
      'airbnb', 'done', 'pricelabs', 'need_help'
    ),
    'expectationsAcknowledged', TRUE,
    'submittedAt', '2026-09-04T15:00:00Z'
  ) AS snapshot
) fixture;

INSERT INTO public.ghl_onboarding_jobs (journey_id, kind)
VALUES (
  '10000000-0000-0000-0000-000000000003', 'assembly_provision'
);

CREATE TEMP TABLE frozen_link_snapshot AS
SELECT submitted_snapshot
FROM public.ghl_onboarding_journeys
WHERE id = '10000000-0000-0000-0000-000000000003';

DO $$
DECLARE
  job public.ghl_onboarding_jobs%ROWTYPE;
  ok BOOLEAN;
  linked_run_id UUID;
  linked_client_id UUID;
BEGIN
  SELECT * INTO job FROM public.claim_ghl_onboarding_job('assembly_provision');
  PERFORM pg_temp.assert_true(
    job.journey_id = '10000000-0000-0000-0000-000000000003',
    'link fixture job was not claimed'
  );

  ok := public.finish_ghl_assembly_job(
    job.id, job.lease_token, 'portal_invited',
    '{"clientId":"assembly-client-link","companyId":"assembly-company-link"}',
    NULL
  );
  PERFORM pg_temp.assert_true(ok, 'portal invite completion failed');

  SELECT onboarding_run_id, hub_client_id
  INTO linked_run_id, linked_client_id
  FROM public.ghl_onboarding_journeys
  WHERE id = '10000000-0000-0000-0000-000000000003';
  PERFORM pg_temp.assert_true(
    linked_run_id IS NOT NULL,
    'operational run was not linked'
  );
  PERFORM pg_temp.assert_true(
    linked_client_id IS NOT NULL,
    'Hub client was not linked'
  );
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 1 FROM public.onboarding_runs WHERE id = linked_run_id),
    'runtime link created the wrong run count'
  );
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 1 FROM public.onboarding_run_listings
     WHERE run_id = linked_run_id),
    'runtime link did not create one property'
  );
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 4 FROM public.onboarding_run_tasks
     WHERE run_id = linked_run_id),
    'runtime link did not create property plus three software tasks'
  );
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 4 FROM public.onboarding_run_tasks
     WHERE run_id = linked_run_id
       AND owner_profile_id = '90000000-0000-0000-0000-000000000001'),
    'runtime tasks were not assigned to the configured team profile'
  );
  PERFORM pg_temp.assert_true(
    (SELECT NOT submitted_payload ? 'accounts'
       AND NOT (submitted_payload->'properties'->0) ? 'billingAccountId'
       AND NOT (submitted_payload->'properties'->0) ? 'ghlRecordId'
     FROM public.onboarding_runs WHERE id = linked_run_id),
    'operational snapshot retained commercial linkage fields'
  );
  PERFORM pg_temp.assert_true(
    (SELECT journey.submitted_snapshot = frozen.submitted_snapshot
     FROM public.ghl_onboarding_journeys AS journey,
       frozen_link_snapshot AS frozen
     WHERE journey.id = '10000000-0000-0000-0000-000000000003'),
    'accepted snapshot changed during runtime link'
  );
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 1 FROM public.ghl_onboarding_jobs
     WHERE journey_id = '10000000-0000-0000-0000-000000000003'
       AND kind = 'activation_check'),
    'invite did not queue exactly one activation check'
  );

  PERFORM public.link_ghl_onboarding_operations(
    '10000000-0000-0000-0000-000000000003'
  );
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 1 FROM public.onboarding_runs
     WHERE external_key = 'ghl-v1:10000000-0000-0000-0000-000000000003'),
    'relink created a duplicate operational run'
  );

  UPDATE public.ghl_onboarding_jobs SET available_at = NOW()
  WHERE journey_id = '10000000-0000-0000-0000-000000000003'
    AND kind = 'activation_check';
  SELECT * INTO job FROM public.claim_ghl_onboarding_job('activation_check');
  ok := public.finish_ghl_assembly_job(
    job.id, job.lease_token, 'portal_invited',
    '{"clientId":"assembly-client-link","companyId":"assembly-company-link"}',
    NULL
  );
  PERFORM pg_temp.assert_true(ok, 'activation pending finish failed');
  PERFORM pg_temp.assert_true(
    (SELECT COUNT(*) = 1 FROM public.ghl_onboarding_jobs
     WHERE journey_id = '10000000-0000-0000-0000-000000000003'
       AND kind = 'activation_check'),
    'activation retry duplicated the activation queue'
  );
END;
$$;

-- A downstream operations-link failure must roll back stage/provider identity
-- while leaving the lease available for the caller to record a retry outcome.
INSERT INTO public.clients (name, email, status)
VALUES ('Collision Fixture', 'collision@example.com', 'onboarding');

INSERT INTO public.ghl_onboarding_journeys (
  id, run_key, contact_id, opportunity_id, appointment_id, owner_id,
  team_profile_id, stage, payload, submitted_snapshot, context_token_hash,
  context_expires_at
)
SELECT
  '10000000-0000-0000-0000-000000000004', 'test:journey-link-failure',
  'contact-link-failure', 'opportunity-link-failure',
  'appointment-link-failure', 'owner-link-failure',
  '90000000-0000-0000-0000-000000000001', 'submitted',
  snapshot,
  snapshot,
  'test-token-hash-link-failure', NOW() + INTERVAL '1 day'
FROM (
  SELECT jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(source.submitted_snapshot, '{id}',
              to_jsonb('10000000-0000-0000-0000-000000000004'::TEXT)),
            '{contactId}', to_jsonb('contact-link-failure'::TEXT)
          ),
          '{opportunityId}', to_jsonb('opportunity-link-failure'::TEXT)
        ),
        '{appointmentId}', to_jsonb('appointment-link-failure'::TEXT)
      ),
      '{email}', to_jsonb('collision@example.com'::TEXT)
    ),
    '{name}', to_jsonb('Collision Fixture'::TEXT)
  ) AS snapshot
  FROM public.ghl_onboarding_journeys AS source
  WHERE source.id = '10000000-0000-0000-0000-000000000003'
) fixture;

INSERT INTO public.ghl_onboarding_jobs (journey_id, kind)
VALUES (
  '10000000-0000-0000-0000-000000000004', 'assembly_provision'
);

DO $$
DECLARE
  job public.ghl_onboarding_jobs%ROWTYPE;
  frozen JSONB;
  ok BOOLEAN;
BEGIN
  SELECT submitted_snapshot INTO frozen
  FROM public.ghl_onboarding_journeys
  WHERE id = '10000000-0000-0000-0000-000000000004';
  SELECT * INTO job FROM public.claim_ghl_onboarding_job('assembly_provision');
  PERFORM pg_temp.assert_true(
    job.journey_id = '10000000-0000-0000-0000-000000000004',
    'operations failure fixture job was not claimed'
  );

  BEGIN
    PERFORM public.finish_ghl_assembly_job(
      job.id, job.lease_token, 'portal_invited',
      '{"clientId":"assembly-client-failure","companyId":"assembly-company-failure"}',
      NULL
    );
    RAISE EXCEPTION 'expected unlinked_hub_client_requires_review';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'unlinked_hub_client_requires_review' THEN RAISE; END IF;
  END;

  PERFORM pg_temp.assert_true(
    (SELECT stage = 'submitted'
       AND assembly_client_id IS NULL
       AND assembly_company_id IS NULL
       AND hub_client_id IS NULL
       AND onboarding_run_id IS NULL
       AND submitted_snapshot = frozen
     FROM public.ghl_onboarding_journeys WHERE id = job.journey_id),
    'operations failure did not roll back journey mutation'
  );
  PERFORM pg_temp.assert_true(
    (SELECT status = 'running'
       AND lease_token = job.lease_token
     FROM public.ghl_onboarding_jobs WHERE id = job.id),
    'operations failure did not preserve the lease for retry accounting'
  );
  ok := public.finish_ghl_assembly_job(
    job.id, job.lease_token, 'failed', '{}', 'operations_handoff_failed'
  );
  PERFORM pg_temp.assert_true(ok, 'caller could not persist operations failure');
END;
$$;

-- Granola eligibility operators, checkpoint shape, global note-version
-- uniqueness, summary constraints, and RLS isolation.
INSERT INTO public.granola_sales_appointment_map (
  appointment_id, calendar_event_id, rep_email, scheduled_start_at,
  attendee_emails, eligible_for_granola_import, eligibility_source,
  source_updated_at
)
VALUES
  (
    'granola-appointment-eligible', 'calendar-event-1', 'rep@example.com',
    '2026-09-04T16:00:00Z', ARRAY['lead@example.com'], TRUE,
    'local-fixture', NOW()
  ),
  (
    'granola-appointment-disabled', 'calendar-event-2', 'rep@example.com',
    '2026-09-04T16:00:00Z', ARRAY['other@example.com'], FALSE,
    'local-fixture', NOW()
  );

SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 1 FROM public.granola_sales_appointment_map
   WHERE eligible_for_granola_import
     AND calendar_event_id = 'calendar-event-1'),
  'eligible exact calendar-event operator failed'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 1 FROM public.granola_sales_appointment_map
   WHERE eligible_for_granola_import
     AND rep_email = 'rep@example.com'
     AND scheduled_start_at = '2026-09-04T16:00:00Z'
     AND attendee_emails && ARRAY['LEAD@example.com', 'lead@example.com']),
  'eligible rep/time/attendee operators failed'
);

INSERT INTO public.granola_import_checkpoints (
  source_id, updated_after, cursor, pending_high_watermark
)
VALUES (
  'rep-one', '2026-09-04T15:00:00Z', 'cursor-1', '2026-09-04T16:00:00Z'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.granola_import_checkpoints (
      source_id, updated_after, cursor, pending_high_watermark
    ) VALUES (
      'invalid-checkpoint', '2026-09-04T15:00:00Z', 'cursor-without-watermark', NULL
    );
    RAISE EXCEPTION 'expected checkpoint shape rejection';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

INSERT INTO public.granola_processed_notes (
  note_id, note_updated_at, source_id, outcome
)
VALUES ('note-global', '2026-09-04T16:30:00Z', 'rep-one', 'imported');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.granola_processed_notes (
      note_id, note_updated_at, source_id, outcome
    ) VALUES (
      'note-global', '2026-09-04T16:30:00Z', 'workspace-one', 'imported'
    );
    RAISE EXCEPTION 'expected global note-version dedupe';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

INSERT INTO public.granola_appointment_summaries (
  note_id, note_updated_at, appointment_id, source_id, source_url,
  summary_text, summary_markdown
)
VALUES (
  'note-global', '2026-09-04T16:30:00Z', 'granola-appointment-eligible',
  'rep-one', 'https://notes.granola.ai/d/fixture', 'Internal summary', NULL
);

GRANT SELECT ON public.ghl_onboarding_journeys TO anon;
GRANT SELECT ON public.ghl_onboarding_commercial_bindings TO anon;
GRANT SELECT ON public.ghl_onboarding_events TO anon;
GRANT SELECT ON public.ghl_onboarding_jobs TO anon;
GRANT SELECT ON public.ghl_assembly_checkpoints TO anon;
GRANT SELECT ON public.ghl_onboarding_exceptions TO anon;
GRANT SELECT ON public.granola_sales_appointment_map TO anon;
GRANT SELECT ON public.granola_import_checkpoints TO anon;
GRANT SELECT ON public.granola_processed_notes TO anon;
GRANT SELECT ON public.granola_appointment_summaries TO anon;

SET LOCAL ROLE anon;
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.ghl_onboarding_journeys),
  'anon read onboarding journeys through RLS'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.ghl_onboarding_commercial_bindings),
  'anon read commercial bindings through RLS'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.ghl_onboarding_events),
  'anon read onboarding events through RLS'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.ghl_onboarding_jobs),
  'anon read onboarding jobs through RLS'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.ghl_assembly_checkpoints),
  'anon read Assembly checkpoints through RLS'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.ghl_onboarding_exceptions),
  'anon read worker exceptions through RLS'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.granola_sales_appointment_map),
  'anon read Granola eligibility through RLS'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.granola_import_checkpoints),
  'anon read Granola checkpoints through RLS'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.granola_processed_notes),
  'anon read Granola processed-note state through RLS'
);
SELECT pg_temp.assert_true(
  (SELECT COUNT(*) = 0 FROM public.granola_appointment_summaries),
  'anon read Granola summaries through RLS'
);
RESET ROLE;

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'anon',
    'public.save_ghl_onboarding_v1(uuid,integer,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'anon can execute onboarding save RPC'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'anon',
    'public.finish_ghl_assembly_job(uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'anon can execute worker finish RPC'
);
SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'anon',
    'public.control_ghl_onboarding_v1(uuid,integer,text,text,text)',
    'EXECUTE'
  ),
  'anon can execute onboarding control RPC'
);

\echo 'ghl-onboarding-v1 SQL integration assertions passed'
ROLLBACK;
