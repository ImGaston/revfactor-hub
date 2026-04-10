-- Migration: Replace hardcoded super_admin RLS policies with role_permissions-based checks
-- Affected tables: clients, listings, client_credentials, onboarding_templates, onboarding_resources
-- NOT changed: expenses, expense_categories, recurring_expenses, roles, role_permissions (stay super_admin only)

-- Helper function to check role_permissions
CREATE OR REPLACE FUNCTION public.has_permission(p_resource TEXT, p_action TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_permissions
    WHERE role_name = public.get_my_role()
      AND resource = p_resource
      AND action = p_action
      AND allowed = true
  )
  -- super_admin always has all permissions
  OR public.get_my_role() = 'super_admin';
$$;

-- ==========================================
-- CLIENTS
-- ==========================================
DROP POLICY "Super admins can insert clients" ON clients;
DROP POLICY "Super admins can update clients" ON clients;
DROP POLICY "Super admins can delete clients" ON clients;

CREATE POLICY "Authorized users can insert clients"
  ON clients FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('clients', 'create'));

CREATE POLICY "Authorized users can update clients"
  ON clients FOR UPDATE TO authenticated
  USING (public.has_permission('clients', 'edit'));

CREATE POLICY "Authorized users can delete clients"
  ON clients FOR DELETE TO authenticated
  USING (public.has_permission('clients', 'delete'));

-- ==========================================
-- LISTINGS
-- ==========================================
DROP POLICY "Super admins can insert listings" ON listings;
DROP POLICY "Super admins can update listings" ON listings;
DROP POLICY "Super admins can delete listings" ON listings;

CREATE POLICY "Authorized users can insert listings"
  ON listings FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('listings', 'create'));

CREATE POLICY "Authorized users can update listings"
  ON listings FOR UPDATE TO authenticated
  USING (public.has_permission('listings', 'edit'));

CREATE POLICY "Authorized users can delete listings"
  ON listings FOR DELETE TO authenticated
  USING (public.has_permission('listings', 'delete'));

-- ==========================================
-- CLIENT CREDENTIALS
-- ==========================================
DROP POLICY "Super admins can insert credentials" ON client_credentials;
DROP POLICY "Super admins can update credentials" ON client_credentials;
DROP POLICY "Super admins can delete credentials" ON client_credentials;

CREATE POLICY "Authorized users can insert credentials"
  ON client_credentials FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('clients', 'create'));

CREATE POLICY "Authorized users can update credentials"
  ON client_credentials FOR UPDATE TO authenticated
  USING (public.has_permission('clients', 'edit'));

CREATE POLICY "Authorized users can delete credentials"
  ON client_credentials FOR DELETE TO authenticated
  USING (public.has_permission('clients', 'delete'));

-- ==========================================
-- ONBOARDING TEMPLATES
-- ==========================================
DROP POLICY "Super admins can insert onboarding templates" ON onboarding_templates;
DROP POLICY "Super admins can update onboarding templates" ON onboarding_templates;
DROP POLICY "Super admins can delete onboarding templates" ON onboarding_templates;

CREATE POLICY "Authorized users can insert onboarding templates"
  ON onboarding_templates FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('onboarding', 'create'));

CREATE POLICY "Authorized users can update onboarding templates"
  ON onboarding_templates FOR UPDATE TO authenticated
  USING (public.has_permission('onboarding', 'edit'));

CREATE POLICY "Authorized users can delete onboarding templates"
  ON onboarding_templates FOR DELETE TO authenticated
  USING (public.has_permission('onboarding', 'delete'));

-- ==========================================
-- ONBOARDING RESOURCES
-- ==========================================
DROP POLICY "Super admins can insert onboarding resources" ON onboarding_resources;
DROP POLICY "Super admins can update onboarding resources" ON onboarding_resources;
DROP POLICY "Super admins can delete onboarding resources" ON onboarding_resources;

CREATE POLICY "Authorized users can insert onboarding resources"
  ON onboarding_resources FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('onboarding', 'create'));

CREATE POLICY "Authorized users can update onboarding resources"
  ON onboarding_resources FOR UPDATE TO authenticated
  USING (public.has_permission('onboarding', 'edit'));

CREATE POLICY "Authorized users can delete onboarding resources"
  ON onboarding_resources FOR DELETE TO authenticated
  USING (public.has_permission('onboarding', 'delete'));
