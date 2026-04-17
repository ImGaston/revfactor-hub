-- ============================================================
-- 029 — Onboarding comments (per client)
-- ============================================================

CREATE TABLE IF NOT EXISTS onboarding_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_comments_client ON onboarding_comments(client_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_comments_created ON onboarding_comments(created_at);

ALTER TABLE onboarding_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view onboarding_comments"
  ON onboarding_comments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert onboarding_comments"
  ON onboarding_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Authors can update own onboarding_comments"
  ON onboarding_comments FOR UPDATE TO authenticated
  USING (author_id = auth.uid());

CREATE POLICY "Authors can delete own onboarding_comments"
  ON onboarding_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid());
