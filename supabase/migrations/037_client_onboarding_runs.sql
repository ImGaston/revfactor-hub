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
  stripe_subscription_id     TEXT,
  primary_listing_entitlement INTEGER NOT NULL DEFAULT 0
    CHECK (primary_listing_entitlement >= 0),
  child_listing_entitlement  INTEGER NOT NULL DEFAULT 0
    CHECK (child_listing_entitlement >= 0),
  entitlement_synced_at      TIMESTAMPTZ,
  has_pms                    BOOLEAN,
  pms_name                   TEXT,
  has_pricelabs              BOOLEAN,
  client_note                TEXT,
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
CREATE INDEX IF NOT EXISTS idx_onboarding_runs_stripe_subscription
  ON onboarding_runs(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS onboarding_run_listings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID NOT NULL REFERENCES onboarding_runs(id) ON DELETE CASCADE,
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

CREATE POLICY "Authenticated users can manage onboarding runs"
  ON onboarding_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage onboarding run listings"
  ON onboarding_run_listings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage onboarding run events"
  ON onboarding_run_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage onboarding run event listings"
  ON onboarding_run_event_listings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage onboarding run comps"
  ON onboarding_run_comps FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage onboarding run comp listings"
  ON onboarding_run_comp_listings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage onboarding run answers"
  ON onboarding_run_answers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage onboarding run tasks"
  ON onboarding_run_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage onboarding run attachments"
  ON onboarding_run_attachments FOR ALL TO authenticated USING (true) WITH CHECK (true);
