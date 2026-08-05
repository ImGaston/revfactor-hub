-- Migration 070: Shared team app credentials (Knowledge > Credentials tab)
--
-- Shared logins for tools the team uses (PriceLabs, Airbnb host accounts,
-- OTA extranets, ...). Password storage is plaintext, matching the accepted
-- client_credentials precedent (migrations 013/038). Access is gated by the
-- new `team_credentials` permission resource so external roles never see rows.

CREATE TABLE team_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  software TEXT NOT NULL,
  email TEXT,
  password TEXT,
  notes TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_team_credentials_set_updated_at
  BEFORE UPDATE ON team_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE team_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view team_credentials"
  ON team_credentials FOR SELECT TO authenticated
  USING (public.has_permission('team_credentials', 'view'));

CREATE POLICY "Authorized users can insert team_credentials"
  ON team_credentials FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('team_credentials', 'create'));

CREATE POLICY "Authorized users can update team_credentials"
  ON team_credentials FOR UPDATE TO authenticated
  USING (public.has_permission('team_credentials', 'edit'))
  WITH CHECK (public.has_permission('team_credentials', 'edit'));

CREATE POLICY "Authorized users can delete team_credentials"
  ON team_credentials FOR DELETE TO authenticated
  USING (public.has_permission('team_credentials', 'delete'));

-- Seed role_permissions deterministically (Settings > Roles pre-seeds combos
-- as FALSE, so use DO UPDATE to guarantee the intended grants).
-- super_admin needs no rows: has_permission short-circuits.

-- Team role: admin gets view/create/edit; delete stays off by default
-- (tunable later in Settings > Roles).
INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('admin', 'team_credentials', 'view',   TRUE),
  ('admin', 'team_credentials', 'create', TRUE),
  ('admin', 'team_credentials', 'edit',   TRUE),
  ('admin', 'team_credentials', 'delete', FALSE)
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- External roles: explicit deny — shared logins must never leak outside the team.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'team_credentials', a.action, FALSE
FROM roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete')) AS a(action)
WHERE r.name IN ('contractor', 'marketing', 'hostpricing')
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;
