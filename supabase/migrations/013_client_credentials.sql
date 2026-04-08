-- Client credentials table (sensitive data - restricted access)
CREATE TABLE client_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  software TEXT NOT NULL,
  email TEXT,
  password TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_client_credentials_client ON client_credentials(client_id);

-- RLS
ALTER TABLE client_credentials ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can view credentials
CREATE POLICY "Authenticated users can view credentials"
  ON client_credentials FOR SELECT
  TO authenticated
  USING (true);

-- Only super_admin can insert/update/delete credentials
CREATE POLICY "Super admins can insert credentials"
  ON client_credentials FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update credentials"
  ON client_credentials FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete credentials"
  ON client_credentials FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');
