-- Minimal PostgreSQL 17 fixture matching the production relations, grants,
-- policies, and legacy rows touched by migration 091.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.test_uid', TRUE), '')::UUID;
$$;

CREATE FUNCTION public.has_permission(resource TEXT, action TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT current_setting('app.test_permission', TRUE) = 'true';
$$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL
);

CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'onboarding', 'inactive'))
);

CREATE TABLE public.listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  listing_id TEXT,
  pricelabs_link TEXT,
  airbnb_link TEXT,
  airbnb_id TEXT,
  city TEXT,
  state TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('portfolio', 'single_listing')),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES public.listings(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'pricing_flexibility',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_listings_client_id ON public.listings(client_id);
CREATE INDEX idx_listings_status ON public.listings(status);
CREATE INDEX idx_adjustments_client ON public.adjustments(client_id);
CREATE INDEX idx_adjustments_status ON public.adjustments(status);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view clients"
  ON public.clients FOR SELECT TO authenticated
  USING (public.has_permission('clients', 'view'));
CREATE POLICY "Authorized users can view listings"
  ON public.listings FOR SELECT TO authenticated
  USING (
    public.has_permission('listings', 'view')
    OR public.has_permission('adjustments', 'view')
  );
CREATE POLICY "Authorized users can insert listings"
  ON public.listings FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('listings', 'create'));
CREATE POLICY "Authorized users can update listings"
  ON public.listings FOR UPDATE TO authenticated
  USING (public.has_permission('listings', 'edit'));
CREATE POLICY "Authorized users can delete listings"
  ON public.listings FOR DELETE TO authenticated
  USING (public.has_permission('listings', 'delete'));
CREATE POLICY "Authorized users can view adjustments"
  ON public.adjustments FOR SELECT TO authenticated
  USING (public.has_permission('adjustments', 'view'));
CREATE POLICY "Authorized users can insert adjustments"
  ON public.adjustments FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('adjustments', 'create'));
CREATE POLICY "Authorized users can update adjustments"
  ON public.adjustments FOR UPDATE TO authenticated
  USING (public.has_permission('adjustments', 'edit'));
CREATE POLICY "Authorized users can delete adjustments"
  ON public.adjustments FOR DELETE TO authenticated
  USING (public.has_permission('adjustments', 'delete'));

GRANT ALL ON public.clients, public.listings, public.adjustments
  TO anon, authenticated, service_role;

INSERT INTO public.profiles (id, email)
VALUES ('00000000-0000-0000-0000-000000000099', 'operator@example.invalid');

INSERT INTO public.clients (id, name) VALUES
  ('00000000-0000-0000-0000-000000000010', 'RevFactor A'),
  ('00000000-0000-0000-0000-000000000020', 'RevFactor B');

INSERT INTO public.listings (id, client_id, name, airbnb_id, airbnb_link) VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000010',
    'Legacy RevFactor listing',
    '101',
    'https://www.airbnb.com/rooms/101'
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    NULL,
    'Legacy Blackbird listing',
    '102',
    'https://www.airbnb.com/rooms/102'
  );

-- Existing production rows are all client-owned and already consistent.
INSERT INTO public.adjustments (id, scope, client_id, listing_id) VALUES
  (
    '00000000-0000-0000-0000-000000000201',
    'portfolio',
    '00000000-0000-0000-0000-000000000010',
    NULL
  ),
  (
    '00000000-0000-0000-0000-000000000202',
    'single_listing',
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000101'
  );

CREATE TEMP TABLE policy_snapshot AS
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('listings', 'adjustments');

CREATE TEMP TABLE grant_snapshot AS
SELECT role_name, table_name, privilege, allowed
FROM (
  SELECT
    role_name,
    table_name,
    privilege,
    has_table_privilege(role_name, 'public.' || table_name, privilege) AS allowed
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) roles(role_name)
  CROSS JOIN (VALUES ('listings'), ('adjustments')) tables(table_name)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) privileges(privilege)
) grants;
