-- Clients table
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  assembly_link TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'onboarding', 'inactive')),
  onboarding_date DATE,
  contract_term INTEGER,
  ending_date DATE,
  billing_amount NUMERIC(10,2),
  autopayment_set_up BOOLEAN DEFAULT FALSE,
  stripe_dashboard TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Listings table
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT UNIQUE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  listing_id TEXT,
  pricelabs_link TEXT,
  airbnb_link TEXT,
  city TEXT,
  state TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_listings_client_id ON listings(client_id);
CREATE INDEX idx_clients_status ON clients(status);

-- RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all clients and listings
CREATE POLICY "Authenticated users can view clients"
  ON clients FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view listings"
  ON listings FOR SELECT
  TO authenticated
  USING (true);

-- Only super_admin can insert/update/delete
CREATE POLICY "Super admins can insert clients"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update clients"
  ON clients FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete clients"
  ON clients FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can insert listings"
  ON listings FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update listings"
  ON listings FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete listings"
  ON listings FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');
