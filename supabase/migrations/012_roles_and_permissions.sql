-- Roles table
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed system roles
INSERT INTO roles (name, description, is_system) VALUES
  ('super_admin', 'Full access to all features and settings', TRUE),
  ('admin', 'Standard team member with limited access', TRUE);

-- Resources and actions for the permission system
-- Resources: clients, listings, tasks, pipeline, roadmap, calendar, notes, onboarding, users, settings, financials
-- Actions: view, create, edit, delete

CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE ON UPDATE CASCADE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view', 'create', 'edit', 'delete')),
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role_name, resource, action)
);

-- Seed super_admin with ALL permissions
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT 'super_admin', r.resource, a.action, TRUE
FROM (VALUES
  ('clients'), ('listings'), ('tasks'), ('pipeline'),
  ('roadmap'), ('calendar'), ('notes'), ('onboarding'),
  ('users'), ('settings'), ('financials')
) AS r(resource)
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete')) AS a(action);

-- Seed admin with default permissions (view most things, edit some, no user/settings/financial management)
INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  -- Clients: view only
  ('admin', 'clients', 'view', TRUE),
  ('admin', 'clients', 'create', FALSE),
  ('admin', 'clients', 'edit', FALSE),
  ('admin', 'clients', 'delete', FALSE),
  -- Listings: view only
  ('admin', 'listings', 'view', TRUE),
  ('admin', 'listings', 'create', FALSE),
  ('admin', 'listings', 'edit', FALSE),
  ('admin', 'listings', 'delete', FALSE),
  -- Tasks: full access
  ('admin', 'tasks', 'view', TRUE),
  ('admin', 'tasks', 'create', TRUE),
  ('admin', 'tasks', 'edit', TRUE),
  ('admin', 'tasks', 'delete', TRUE),
  -- Pipeline: full access
  ('admin', 'pipeline', 'view', TRUE),
  ('admin', 'pipeline', 'create', TRUE),
  ('admin', 'pipeline', 'edit', TRUE),
  ('admin', 'pipeline', 'delete', TRUE),
  -- Roadmap: full access
  ('admin', 'roadmap', 'view', TRUE),
  ('admin', 'roadmap', 'create', TRUE),
  ('admin', 'roadmap', 'edit', TRUE),
  ('admin', 'roadmap', 'delete', TRUE),
  -- Calendar: full access
  ('admin', 'calendar', 'view', TRUE),
  ('admin', 'calendar', 'create', TRUE),
  ('admin', 'calendar', 'edit', TRUE),
  ('admin', 'calendar', 'delete', TRUE),
  -- Notes: full access
  ('admin', 'notes', 'view', TRUE),
  ('admin', 'notes', 'create', TRUE),
  ('admin', 'notes', 'edit', TRUE),
  ('admin', 'notes', 'delete', TRUE),
  -- Onboarding: view + edit
  ('admin', 'onboarding', 'view', TRUE),
  ('admin', 'onboarding', 'create', FALSE),
  ('admin', 'onboarding', 'edit', TRUE),
  ('admin', 'onboarding', 'delete', FALSE),
  -- Users: no access
  ('admin', 'users', 'view', FALSE),
  ('admin', 'users', 'create', FALSE),
  ('admin', 'users', 'edit', FALSE),
  ('admin', 'users', 'delete', FALSE),
  -- Settings: no access
  ('admin', 'settings', 'view', FALSE),
  ('admin', 'settings', 'create', FALSE),
  ('admin', 'settings', 'edit', FALSE),
  ('admin', 'settings', 'delete', FALSE),
  -- Financials: no access
  ('admin', 'financials', 'view', FALSE),
  ('admin', 'financials', 'create', FALSE),
  ('admin', 'financials', 'edit', FALSE),
  ('admin', 'financials', 'delete', FALSE);

-- Indexes
CREATE INDEX idx_role_permissions_role ON role_permissions(role_name);
CREATE INDEX idx_role_permissions_resource ON role_permissions(role_name, resource);

-- RLS
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read roles and permissions (needed for UI gating)
CREATE POLICY "Authenticated users can view roles"
  ON roles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view role_permissions"
  ON role_permissions FOR SELECT
  TO authenticated
  USING (true);

-- Only super_admin can manage roles
CREATE POLICY "Super admins can insert roles"
  ON roles FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update roles"
  ON roles FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete roles"
  ON roles FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

-- Only super_admin can manage permissions
CREATE POLICY "Super admins can insert role_permissions"
  ON role_permissions FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update role_permissions"
  ON role_permissions FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete role_permissions"
  ON role_permissions FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

-- Remove the CHECK constraint on profiles.role so custom roles work
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Add a FK to roles.name (profiles.role → roles.name) with cascade on update
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_fk FOREIGN KEY (role) REFERENCES roles(name) ON UPDATE CASCADE;
