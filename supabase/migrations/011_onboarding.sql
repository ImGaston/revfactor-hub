-- ============================================================
-- 011 — Onboarding tables (templates, progress, resources)
-- ============================================================

-- Step templates managed by super_admin
CREATE TABLE IF NOT EXISTS onboarding_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_name   TEXT NOT NULL,
  description TEXT,
  step_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE onboarding_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view onboarding templates"
  ON onboarding_templates FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Super admins can insert onboarding templates"
  ON onboarding_templates FOR INSERT
  TO authenticated WITH CHECK (get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update onboarding templates"
  ON onboarding_templates FOR UPDATE
  TO authenticated USING (get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete onboarding templates"
  ON onboarding_templates FOR DELETE
  TO authenticated USING (get_my_role() = 'super_admin');

-- Per-client step completion tracking
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  template_id  UUID NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE(client_id, template_id)
);

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view onboarding progress"
  ON onboarding_progress FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert onboarding progress"
  ON onboarding_progress FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update onboarding progress"
  ON onboarding_progress FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete onboarding progress"
  ON onboarding_progress FOR DELETE
  TO authenticated USING (true);

-- Resource cards managed by super_admin
CREATE TABLE IF NOT EXISTS onboarding_resources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  url         TEXT,
  icon        TEXT DEFAULT '📄',
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE onboarding_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view onboarding resources"
  ON onboarding_resources FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Super admins can insert onboarding resources"
  ON onboarding_resources FOR INSERT
  TO authenticated WITH CHECK (get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update onboarding resources"
  ON onboarding_resources FOR UPDATE
  TO authenticated USING (get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete onboarding resources"
  ON onboarding_resources FOR DELETE
  TO authenticated USING (get_my_role() = 'super_admin');
