-- Adjustments module: atomic, traceable change requests per client/listing.
-- Also widens the role_permissions action CHECK: 'publish' exists in lib/permissions.ts
-- since the knowledge module but was never added to the DB constraint, and the new
-- 'control' action gates the resolved -> controlled step.

ALTER TABLE role_permissions DROP CONSTRAINT role_permissions_action_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_action_check
  CHECK (action IN ('view', 'create', 'edit', 'delete', 'publish', 'control'));

-- Seed the new resource for existing roles
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT 'super_admin', 'adjustments', a.action, TRUE
FROM (VALUES ('view'), ('create'), ('edit'), ('delete'), ('control')) AS a(action)
ON CONFLICT (role_name, resource, action) DO NOTHING;

INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('admin', 'adjustments', 'view', TRUE),
  ('admin', 'adjustments', 'create', TRUE),
  ('admin', 'adjustments', 'edit', TRUE),
  ('admin', 'adjustments', 'delete', TRUE),
  ('admin', 'adjustments', 'control', TRUE)
ON CONFLICT (role_name, resource, action) DO NOTHING;

-- Main table
CREATE TABLE adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('portfolio', 'single_listing')),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  tag TEXT NOT NULL CHECK (tag IN ('min_stay', 'price', 'min_price', 'max_price', 'discount', 'availability', 'other')),
  target_value TEXT,
  date_from DATE,
  date_to DATE,
  booking_window TEXT CHECK (booking_window IN ('last_minute', 'far_out')),
  urgency TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low', 'medium', 'high')),
  requested_by TEXT,
  origin_message TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'controlled', 'issue', 'rejected')),
  resolver_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  controlled_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_adjustments_status ON adjustments(status);
CREATE INDEX idx_adjustments_client ON adjustments(client_id);
CREATE INDEX idx_adjustments_triage ON adjustments(urgency, created_at);

ALTER TABLE adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view adjustments"
  ON adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authorized users can insert adjustments"
  ON adjustments FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('adjustments', 'create'));
CREATE POLICY "Authorized users can update adjustments"
  ON adjustments FOR UPDATE TO authenticated
  USING (public.has_permission('adjustments', 'edit'));
CREATE POLICY "Authorized users can delete adjustments"
  ON adjustments FOR DELETE TO authenticated
  USING (public.has_permission('adjustments', 'delete'));

-- Comments (same shape as task_comments)
CREATE TABLE adjustment_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id UUID NOT NULL REFERENCES adjustments(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_adjustment_comments_adjustment ON adjustment_comments(adjustment_id);

ALTER TABLE adjustment_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view adjustment_comments"
  ON adjustment_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert adjustment_comments"
  ON adjustment_comments FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "Authors can update own adjustment_comments"
  ON adjustment_comments FOR UPDATE TO authenticated USING (author_id = auth.uid());
CREATE POLICY "Authors can delete own adjustment_comments"
  ON adjustment_comments FOR DELETE TO authenticated USING (author_id = auth.uid());
