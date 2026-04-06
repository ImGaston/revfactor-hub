-- ============================================================
-- 008: Sales Pipeline / Funnel
-- Leads pipeline with 10 stages, tags, and team assignments.
-- ============================================================

-- Lead tags (separate namespace from roadmap tags)
CREATE TABLE lead_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leads (main pipeline table)
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name TEXT NOT NULL,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  service_type TEXT,
  lead_source TEXT DEFAULT 'landing_page',
  scheduled_date TIMESTAMPTZ,
  timezone TEXT,
  location TEXT,
  description TEXT,
  start_date DATE,
  end_date DATE,
  contract_sent BOOLEAN DEFAULT FALSE,
  contract_signed BOOLEAN DEFAULT FALSE,
  client_portal_url TEXT,
  stage TEXT NOT NULL DEFAULT 'inquiry'
    CHECK (stage IN (
      'inquiry', 'follow_up', 'audit', 'meeting',
      'proposal_sent', 'proposal_signed', 'retainer_paid',
      'planning', 'completed', 'archived'
    )),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lead ↔ Tag junction
CREATE TABLE lead_tag_assignments (
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES lead_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, tag_id)
);

-- Lead ↔ Team member junction
CREATE TABLE lead_team_assignments (
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (lead_id, profile_id)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_sort_order ON leads(sort_order);
CREATE INDEX idx_leads_created_by ON leads(created_by);
CREATE INDEX idx_lead_tag_assignments_lead ON lead_tag_assignments(lead_id);
CREATE INDEX idx_lead_tag_assignments_tag ON lead_tag_assignments(tag_id);
CREATE INDEX idx_lead_team_assignments_lead ON lead_team_assignments(lead_id);
CREATE INDEX idx_lead_team_assignments_profile ON lead_team_assignments(profile_id);

-- ============================================================
-- RLS — all authenticated users can CRUD
-- ============================================================
ALTER TABLE lead_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_team_assignments ENABLE ROW LEVEL SECURITY;

-- lead_tags
CREATE POLICY "Authenticated users can view lead_tags"
  ON lead_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert lead_tags"
  ON lead_tags FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update lead_tags"
  ON lead_tags FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete lead_tags"
  ON lead_tags FOR DELETE TO authenticated USING (true);

-- leads
CREATE POLICY "Authenticated users can view leads"
  ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert leads"
  ON leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update leads"
  ON leads FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete leads"
  ON leads FOR DELETE TO authenticated USING (true);

-- lead_tag_assignments
CREATE POLICY "Authenticated users can view lead_tag_assignments"
  ON lead_tag_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert lead_tag_assignments"
  ON lead_tag_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete lead_tag_assignments"
  ON lead_tag_assignments FOR DELETE TO authenticated USING (true);

-- lead_team_assignments
CREATE POLICY "Authenticated users can view lead_team_assignments"
  ON lead_team_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert lead_team_assignments"
  ON lead_team_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update lead_team_assignments"
  ON lead_team_assignments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete lead_team_assignments"
  ON lead_team_assignments FOR DELETE TO authenticated USING (true);

-- ============================================================
-- Seed default lead tags
-- ============================================================
INSERT INTO lead_tags (name, color) VALUES
  ('Owner', '#3b82f6'),
  ('Investor', '#8b5cf6'),
  ('Multi-listing', '#f59e0b'),
  ('Referral', '#22c55e'),
  ('High Priority', '#ef4444');
