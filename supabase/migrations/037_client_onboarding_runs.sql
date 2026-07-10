-- ============================================================
-- 037 — Client onboarding app: run-based intake and verification
--
-- Keeps the legacy client-level onboarding_progress checklist intact.
-- New tables model one initial or additional-property onboarding run.
-- ============================================================

CREATE TABLE IF NOT EXISTS onboarding_runs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_key               TEXT NOT NULL,
  run_type                   TEXT NOT NULL DEFAULT 'initial'
    CHECK (run_type IN ('initial', 'additional_property')),
  status                     TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'in_review', 'ready_for_launch', 'live', 'archived')),
  current_step               TEXT NOT NULL DEFAULT 'property'
    CHECK (current_step IN ('property', 'software', 'preferences', 'knowledge', 'review')),
  assembly_workspace_id      TEXT,
  assembly_company_id        TEXT,
  assembly_client_id         TEXT,
  stripe_subscription_ids    TEXT[] NOT NULL DEFAULT '{}',
  primary_listing_entitlement INTEGER NOT NULL DEFAULT 0
    CHECK (primary_listing_entitlement BETWEEN 0 AND 5),
  child_listing_entitlement  INTEGER NOT NULL DEFAULT 0
    CHECK (child_listing_entitlement BETWEEN 0 AND 5),
  entitlement_synced_at      TIMESTAMPTZ,
  has_pms                    BOOLEAN,
  pms_name                   TEXT,
  has_pricelabs              BOOLEAN,
  client_note                TEXT,
  draft_payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_payload          JSONB,
  revision                   INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_saved_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at               TIMESTAMPTZ,
  reviewed_at                TIMESTAMPTZ,
  live_at                    TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_runs_client_external_key
  ON onboarding_runs(client_id, external_key);

CREATE INDEX IF NOT EXISTS idx_onboarding_runs_client
  ON onboarding_runs(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_runs_status
  ON onboarding_runs(status, last_saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_runs_assembly_company
  ON onboarding_runs(assembly_company_id)
  WHERE assembly_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_onboarding_runs_stripe_subscriptions
  ON onboarding_runs USING GIN(stripe_subscription_ids);

CREATE TABLE IF NOT EXISTS onboarding_run_listings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL REFERENCES onboarding_runs(id) ON DELETE CASCADE,
  external_key          TEXT NOT NULL CHECK (external_key ~ '^(primary|child)-[0-9]+$'),
  hub_listing_id        UUID REFERENCES listings(id) ON DELETE SET NULL,
  parent_run_listing_id UUID,
  listing_kind          TEXT NOT NULL CHECK (listing_kind IN ('primary', 'child')),
  sequence              INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  name                  TEXT NOT NULL DEFAULT '',
  listing_url           TEXT,
  is_live               BOOLEAN NOT NULL DEFAULT FALSE,
  launch_month          SMALLINT CHECK (launch_month BETWEEN 1 AND 12),
  launch_year           SMALLINT CHECK (launch_year BETWEEN 2000 AND 2100),
  target_launch_month   SMALLINT CHECK (target_launch_month BETWEEN 1 AND 12),
  target_launch_year    SMALLINT CHECK (target_launch_year BETWEEN 2000 AND 2100),
  child_unit_type       TEXT CHECK (child_unit_type IN ('separate_unit', 'smaller_unit', 'not_sure')),
  annual_revenue_target NUMERIC(12,2) CHECK (annual_revenue_target >= 0),
  minimum_nightly_price NUMERIC(10,2) CHECK (minimum_nightly_price >= 0),
  cleaning_cost         NUMERIC(10,2) CHECK (cleaning_cost >= 0),
  min_stay_midweek      SMALLINT CHECK (min_stay_midweek BETWEEN 1 AND 7),
  min_stay_weekend      SMALLINT CHECK (min_stay_weekend BETWEEN 1 AND 7),
  currency              TEXT NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, run_id),
  UNIQUE(run_id, external_key),
  UNIQUE(run_id, listing_kind, sequence),
  FOREIGN KEY (parent_run_listing_id, run_id)
    REFERENCES onboarding_run_listings(id, run_id) ON DELETE CASCADE,
  CHECK (
    (listing_kind = 'primary' AND parent_run_listing_id IS NULL AND child_unit_type IS NULL)
    OR listing_kind = 'child'
  )
);

CREATE INDEX IF NOT EXISTS idx_onboarding_run_listings_run
  ON onboarding_run_listings(run_id, listing_kind, sequence);
CREATE INDEX IF NOT EXISTS idx_onboarding_run_listings_hub_listing
  ON onboarding_run_listings(hub_listing_id)
  WHERE hub_listing_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS onboarding_run_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES onboarding_runs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  month       SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year        SMALLINT CHECK (year BETWEEN 2000 AND 2100),
  recurrence  TEXT NOT NULL CHECK (recurrence IN ('one_off', 'recurrent')),
  demand      TEXT NOT NULL CHECK (demand IN ('meaningful', 'significant', 'huge', 'blackout')),
  sequence    INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, run_id),
  CHECK ((recurrence = 'one_off' AND year IS NOT NULL) OR (recurrence = 'recurrent' AND year IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_onboarding_run_events_run
  ON onboarding_run_events(run_id, sequence);

CREATE TABLE IF NOT EXISTS onboarding_run_event_listings (
  run_id         UUID NOT NULL REFERENCES onboarding_runs(id) ON DELETE CASCADE,
  event_id       UUID NOT NULL,
  run_listing_id UUID NOT NULL,
  PRIMARY KEY (event_id, run_listing_id),
  FOREIGN KEY (event_id, run_id)
    REFERENCES onboarding_run_events(id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (run_listing_id, run_id)
    REFERENCES onboarding_run_listings(id, run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onboarding_run_comps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES onboarding_runs(id) ON DELETE CASCADE,
  listing_url TEXT NOT NULL,
  sequence    INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_run_comps_run
  ON onboarding_run_comps(run_id, sequence);

CREATE TABLE IF NOT EXISTS onboarding_run_comp_listings (
  run_id         UUID NOT NULL REFERENCES onboarding_runs(id) ON DELETE CASCADE,
  comp_id        UUID NOT NULL,
  run_listing_id UUID NOT NULL,
  PRIMARY KEY (comp_id, run_listing_id),
  FOREIGN KEY (comp_id, run_id)
    REFERENCES onboarding_run_comps(id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (run_listing_id, run_id)
    REFERENCES onboarding_run_listings(id, run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onboarding_run_answers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL REFERENCES onboarding_runs(id) ON DELETE CASCADE,
  section      TEXT NOT NULL CHECK (section IN ('readiness', 'knowledge')),
  question_key TEXT NOT NULL,
  answer_key   TEXT NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, section, question_key)
);

CREATE TABLE IF NOT EXISTS onboarding_run_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL REFERENCES onboarding_runs(id) ON DELETE CASCADE,
  task_key         TEXT NOT NULL,
  client_status    TEXT NOT NULL DEFAULT 'not_started'
    CHECK (client_status IN ('not_started', 'in_progress', 'submitted')),
  team_status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (team_status IN ('pending', 'reviewing', 'verified', 'blocked')),
  owner_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  client_note      TEXT,
  team_note        TEXT,
  client_submitted_at TIMESTAMPTZ,
  team_verified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_run_tasks_queue
  ON onboarding_run_tasks(team_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS onboarding_run_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL REFERENCES onboarding_runs(id) ON DELETE CASCADE,
  run_listing_id   UUID,
  assembly_file_id TEXT NOT NULL,
  file_name        TEXT NOT NULL,
  content_type     TEXT,
  byte_size        BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  uploaded_by_type TEXT NOT NULL CHECK (uploaded_by_type IN ('client', 'internal')),
  uploaded_by_id   TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, assembly_file_id),
  FOREIGN KEY (run_listing_id, run_id)
    REFERENCES onboarding_run_listings(id, run_id) ON DELETE CASCADE
);

ALTER TABLE onboarding_comments
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES onboarding_runs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_onboarding_comments_run
  ON onboarding_comments(run_id)
  WHERE run_id IS NOT NULL;

ALTER TABLE onboarding_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_run_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_run_event_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_run_comps ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_run_comp_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_run_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_run_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_run_attachments ENABLE ROW LEVEL SECURITY;

-- Hub team members use the existing resource/action permission model. The
-- Assembly app writes through a server-only service-role client after validating
-- the encrypted Assembly session; Supabase credentials are never sent to clients.
DO $$
DECLARE
  onboarding_table TEXT;
BEGIN
  FOREACH onboarding_table IN ARRAY ARRAY[
    'onboarding_runs',
    'onboarding_run_listings',
    'onboarding_run_events',
    'onboarding_run_event_listings',
    'onboarding_run_comps',
    'onboarding_run_comp_listings',
    'onboarding_run_answers',
    'onboarding_run_tasks',
    'onboarding_run_attachments'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY "Authorized users can view onboarding data" ON %I FOR SELECT TO authenticated USING (public.has_permission(''onboarding'', ''view''))',
      onboarding_table
    );
    EXECUTE format(
      'CREATE POLICY "Authorized users can create onboarding data" ON %I FOR INSERT TO authenticated WITH CHECK (public.has_permission(''onboarding'', ''create''))',
      onboarding_table
    );
    EXECUTE format(
      'CREATE POLICY "Authorized users can edit onboarding data" ON %I FOR UPDATE TO authenticated USING (public.has_permission(''onboarding'', ''edit'')) WITH CHECK (public.has_permission(''onboarding'', ''edit''))',
      onboarding_table
    );
    EXECUTE format(
      'CREATE POLICY "Authorized users can delete onboarding data" ON %I FOR DELETE TO authenticated USING (public.has_permission(''onboarding'', ''delete''))',
      onboarding_table
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.onboarding_month_number(p_value TEXT)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE LOWER(BTRIM(p_value))
    WHEN 'january' THEN 1
    WHEN 'february' THEN 2
    WHEN 'march' THEN 3
    WHEN 'april' THEN 4
    WHEN 'may' THEN 5
    WHEN 'june' THEN 6
    WHEN 'july' THEN 7
    WHEN 'august' THEN 8
    WHEN 'september' THEN 9
    WHEN 'october' THEN 10
    WHEN 'november' THEN 11
    WHEN 'december' THEN 12
    ELSE NULL
  END::SMALLINT;
$$;

CREATE OR REPLACE FUNCTION public.onboarding_money_number(p_value TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(REGEXP_REPLACE(COALESCE(p_value, ''), '[^0-9.]', '', 'g'), '')::NUMERIC;
$$;

CREATE OR REPLACE FUNCTION public.normalize_client_onboarding_submission(
  p_run_id UUID,
  p_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  listing_item JSONB;
  preference JSONB;
  event_item JSONB;
  comp_item JSONB;
  listing_key TEXT;
  parent_key TEXT;
  parent_id UUID;
  event_id UUID;
  comp_id UUID;
  sequence_number INTEGER;
  question_key TEXT;
  answer_value TEXT;
BEGIN
  DELETE FROM onboarding_run_events WHERE run_id = p_run_id;
  DELETE FROM onboarding_run_comps WHERE run_id = p_run_id;
  DELETE FROM onboarding_run_answers WHERE run_id = p_run_id;
  DELETE FROM onboarding_run_listings WHERE run_id = p_run_id;

  sequence_number := 0;
  FOR listing_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'listings', '[]'::jsonb))
  LOOP
    listing_key := 'primary-' || (listing_item->>'id');
    preference := COALESCE(p_payload->'pricingPreferences'->listing_key, '{}'::jsonb);
    INSERT INTO onboarding_run_listings (
      run_id,
      external_key,
      listing_kind,
      sequence,
      name,
      listing_url,
      is_live,
      launch_month,
      launch_year,
      target_launch_month,
      target_launch_year,
      annual_revenue_target,
      minimum_nightly_price,
      cleaning_cost,
      min_stay_midweek,
      min_stay_weekend
    ) VALUES (
      p_run_id,
      listing_key,
      'primary',
      sequence_number,
      COALESCE(listing_item->>'name', ''),
      NULLIF(BTRIM(listing_item->>'url'), ''),
      listing_item->>'isLive' = 'yes',
      CASE WHEN listing_item->>'isLive' = 'yes'
        THEN public.onboarding_month_number(listing_item->>'launchMonth') END,
      CASE WHEN listing_item->>'isLive' = 'yes'
        THEN NULLIF(listing_item->>'launchYear', '')::SMALLINT END,
      CASE WHEN listing_item->>'isLive' = 'no'
        THEN public.onboarding_month_number(listing_item->>'targetLaunchMonth') END,
      CASE WHEN listing_item->>'isLive' = 'no'
        THEN NULLIF(listing_item->>'targetLaunchYear', '')::SMALLINT END,
      public.onboarding_money_number(preference->>'revenueTarget'),
      public.onboarding_money_number(preference->>'minimumNightlyPrice'),
      public.onboarding_money_number(preference->>'cleaningCost'),
      NULLIF(preference->>'minStayMidweek', '')::SMALLINT,
      NULLIF(preference->>'minStayWeekend', '')::SMALLINT
    );
    sequence_number := sequence_number + 1;
  END LOOP;

  sequence_number := 0;
  FOR listing_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'childListings', '[]'::jsonb))
  LOOP
    listing_key := 'child-' || (listing_item->>'id');
    preference := COALESCE(p_payload->'pricingPreferences'->listing_key, '{}'::jsonb);
    parent_key := CASE WHEN jsonb_typeof(listing_item->'parentId') = 'number'
      THEN 'primary-' || (listing_item->>'parentId')
      ELSE NULL
    END;
    SELECT id INTO parent_id
    FROM onboarding_run_listings
    WHERE run_id = p_run_id AND external_key = parent_key;

    INSERT INTO onboarding_run_listings (
      run_id,
      external_key,
      parent_run_listing_id,
      listing_kind,
      sequence,
      name,
      listing_url,
      is_live,
      launch_month,
      launch_year,
      target_launch_month,
      target_launch_year,
      child_unit_type,
      annual_revenue_target,
      minimum_nightly_price,
      cleaning_cost,
      min_stay_midweek,
      min_stay_weekend
    ) VALUES (
      p_run_id,
      listing_key,
      parent_id,
      'child',
      sequence_number,
      COALESCE(listing_item->>'name', ''),
      NULLIF(BTRIM(listing_item->>'url'), ''),
      listing_item->>'isLive' = 'yes',
      CASE WHEN listing_item->>'isLive' = 'yes'
        THEN public.onboarding_month_number(listing_item->>'launchMonth') END,
      CASE WHEN listing_item->>'isLive' = 'yes'
        THEN NULLIF(listing_item->>'launchYear', '')::SMALLINT END,
      CASE WHEN listing_item->>'isLive' = 'no'
        THEN public.onboarding_month_number(listing_item->>'targetLaunchMonth') END,
      CASE WHEN listing_item->>'isLive' = 'no'
        THEN NULLIF(listing_item->>'targetLaunchYear', '')::SMALLINT END,
      REPLACE(listing_item->>'unitType', '-', '_'),
      public.onboarding_money_number(preference->>'revenueTarget'),
      public.onboarding_money_number(preference->>'minimumNightlyPrice'),
      public.onboarding_money_number(preference->>'cleaningCost'),
      NULLIF(preference->>'minStayMidweek', '')::SMALLINT,
      NULLIF(preference->>'minStayWeekend', '')::SMALLINT
    );
    sequence_number := sequence_number + 1;
  END LOOP;

  sequence_number := 0;
  FOR event_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'pricingEvents', '[]'::jsonb))
  LOOP
    INSERT INTO onboarding_run_events (
      run_id, name, month, year, recurrence, demand, sequence
    ) VALUES (
      p_run_id,
      event_item->>'name',
      public.onboarding_month_number(event_item->>'month'),
      CASE WHEN event_item->>'recurrence' = 'one-off'
        THEN NULLIF(event_item->>'year', '')::SMALLINT END,
      REPLACE(event_item->>'recurrence', '-', '_'),
      event_item->>'demand',
      sequence_number
    ) RETURNING id INTO event_id;

    INSERT INTO onboarding_run_event_listings (run_id, event_id, run_listing_id)
    SELECT p_run_id, event_id, listings.id
    FROM jsonb_array_elements_text(COALESCE(event_item->'appliesTo', '[]'::jsonb)) AS scope(external_key)
    JOIN onboarding_run_listings listings
      ON listings.run_id = p_run_id AND listings.external_key = scope.external_key;
    sequence_number := sequence_number + 1;
  END LOOP;

  sequence_number := 0;
  FOR comp_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'pricingComps', '[]'::jsonb))
  LOOP
    INSERT INTO onboarding_run_comps (run_id, listing_url, sequence)
    VALUES (p_run_id, comp_item->>'url', sequence_number)
    RETURNING id INTO comp_id;

    INSERT INTO onboarding_run_comp_listings (run_id, comp_id, run_listing_id)
    SELECT p_run_id, comp_id, listings.id
    FROM jsonb_array_elements_text(COALESCE(comp_item->'appliesTo', '[]'::jsonb)) AS scope(external_key)
    JOIN onboarding_run_listings listings
      ON listings.run_id = p_run_id AND listings.external_key = scope.external_key;
    sequence_number := sequence_number + 1;
  END LOOP;

  FOR question_key, answer_value IN
    SELECT key, value FROM jsonb_each_text(COALESCE(p_payload->'readinessChecks', '{}'::jsonb))
  LOOP
    INSERT INTO onboarding_run_answers (run_id, section, question_key, answer_key)
    VALUES (p_run_id, 'readiness', question_key, CASE WHEN answer_value::BOOLEAN THEN 'complete' ELSE 'incomplete' END);
  END LOOP;

  FOR question_key, answer_value IN
    SELECT key, value FROM jsonb_each_text(COALESCE(p_payload->'knowledgeAnswers', '{}'::jsonb))
  LOOP
    INSERT INTO onboarding_run_answers (run_id, section, question_key, answer_key, note)
    VALUES (
      p_run_id,
      'knowledge',
      question_key,
      answer_value,
      NULLIF(BTRIM(p_payload->'knowledgeNotes'->>question_key), '')
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.onboarding_month_number(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.onboarding_money_number(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_client_onboarding_submission(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;

-- Autosave preserves the exact, potentially incomplete form payload. Submitted
-- data is snapshotted separately so internal review has a stable handoff even if
-- the draft model evolves later. Provisioning and Stripe entitlement sync create
-- the run before a client can save it; client payloads never set entitlements.
CREATE OR REPLACE FUNCTION public.save_client_onboarding_draft(
  p_assembly_company_id TEXT,
  p_assembly_client_id TEXT,
  p_external_key TEXT,
  p_expected_revision INTEGER,
  p_current_step TEXT,
  p_payload JSONB,
  p_submit BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved_client_id UUID;
  current_run onboarding_runs%ROWTYPE;
  saved_run onboarding_runs%ROWTYPE;
BEGIN
  IF NULLIF(p_assembly_company_id, '') IS NULL
     AND NULLIF(p_assembly_client_id, '') IS NULL THEN
    RAISE EXCEPTION 'Assembly company or client identity is required'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_payload) <> 'object'
     OR p_payload->>'runId' IS DISTINCT FROM p_external_key THEN
    RAISE EXCEPTION 'Onboarding payload does not match the requested run'
      USING ERRCODE = '22023';
  END IF;

  SELECT clients.id
  INTO resolved_client_id
  FROM clients
  WHERE (
    NULLIF(p_assembly_company_id, '') IS NOT NULL
    AND clients.assembly_company_id = p_assembly_company_id
  ) OR (
    NULLIF(p_assembly_client_id, '') IS NOT NULL
    AND clients.assembly_client_id = p_assembly_client_id
  )
  ORDER BY CASE
    WHEN clients.assembly_company_id = p_assembly_company_id THEN 0
    ELSE 1
  END
  LIMIT 1;

  IF resolved_client_id IS NULL THEN
    RAISE EXCEPTION 'No Hub client is mapped to this Assembly identity'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO current_run
  FROM onboarding_runs
  WHERE client_id = resolved_client_id
    AND external_key = p_external_key
  FOR UPDATE;

  IF current_run.id IS NULL THEN
    RAISE EXCEPTION 'This onboarding run has not been provisioned'
      USING ERRCODE = 'P0002';
  END IF;

  IF current_run.status <> 'draft' THEN
    RAISE EXCEPTION 'This onboarding run is locked for client editing'
      USING ERRCODE = '55000';
  END IF;

  IF current_run.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'This onboarding run was updated in another session'
      USING ERRCODE = '40001';
  END IF;

  IF COALESCE((p_payload->>'listingCount')::INTEGER, -1)
       <> current_run.primary_listing_entitlement
     OR COALESCE((p_payload->>'childListingCount')::INTEGER, -1)
       <> current_run.child_listing_entitlement
     OR jsonb_array_length(COALESCE(p_payload->'listings', '[]'::jsonb))
       <> current_run.primary_listing_entitlement
     OR jsonb_array_length(COALESCE(p_payload->'childListings', '[]'::jsonb))
       <> current_run.child_listing_entitlement THEN
    RAISE EXCEPTION 'Listing counts no longer match the Stripe entitlement'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO onboarding_run_tasks (
    run_id,
    task_key,
    client_status,
    client_submitted_at,
    updated_at
  )
  SELECT
    current_run.id,
    task_item.value->>'id',
    CASE task_item.value->>'clientStatus'
      WHEN 'submitted' THEN 'submitted'
      WHEN 'in-progress' THEN 'in_progress'
      ELSE 'not_started'
    END,
    CASE WHEN task_item.value->>'clientStatus' = 'submitted' THEN now() ELSE NULL END,
    now()
  FROM jsonb_array_elements(COALESCE(p_payload->'tasks', '[]'::jsonb)) AS task_item(value)
  WHERE task_item.value->>'id' IN ('airbnb', 'pms', 'pricelabs', 'listing')
  ON CONFLICT (run_id, task_key) DO UPDATE
  SET client_status = EXCLUDED.client_status,
      client_submitted_at = EXCLUDED.client_submitted_at,
      updated_at = now();

  UPDATE onboarding_runs
  SET current_step = p_current_step,
      has_pms = CASE p_payload->>'hasPms'
        WHEN 'yes' THEN TRUE
        WHEN 'no' THEN FALSE
        ELSE NULL
      END,
      pms_name = NULLIF(BTRIM(p_payload->>'pms'), ''),
      has_pricelabs = CASE p_payload->>'hasPricelabs'
        WHEN 'yes' THEN TRUE
        WHEN 'no' THEN FALSE
        ELSE NULL
      END,
      client_note = NULLIF(BTRIM(p_payload->>'notes'), ''),
      draft_payload = p_payload,
      submitted_payload = CASE WHEN p_submit THEN p_payload ELSE submitted_payload END,
      status = CASE WHEN p_submit THEN 'submitted' ELSE status END,
      submitted_at = CASE WHEN p_submit THEN now() ELSE submitted_at END,
      last_saved_at = now(),
      revision = revision + 1,
      updated_at = now()
  WHERE id = current_run.id
  RETURNING * INTO saved_run;

  IF p_submit THEN
    PERFORM public.normalize_client_onboarding_submission(current_run.id, p_payload);
  END IF;

  RETURN jsonb_build_object(
    'run_id', saved_run.id,
    'external_key', saved_run.external_key,
    'revision', saved_run.revision,
    'status', saved_run.status,
    'saved_at', saved_run.last_saved_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_client_onboarding_draft(
  TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_client_onboarding_draft(
  TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB, BOOLEAN
) TO service_role;
