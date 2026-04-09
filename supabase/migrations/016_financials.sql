-- Add Stripe customer ID to clients
ALTER TABLE clients ADD COLUMN stripe_customer_id TEXT;
CREATE UNIQUE INDEX idx_clients_stripe_customer_id ON clients(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Expense categories
CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('fixed', 'variable')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default categories
INSERT INTO expense_categories (name, type) VALUES
  ('Rent', 'fixed'),
  ('Software & Tools', 'fixed'),
  ('Salaries', 'fixed'),
  ('Insurance', 'fixed'),
  ('Marketing', 'variable'),
  ('Travel', 'variable'),
  ('Contractors', 'variable'),
  ('Office Supplies', 'variable'),
  ('Professional Services', 'variable'),
  ('Other', 'variable');

-- Expenses table
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('fixed', 'variable')),
  date DATE NOT NULL,
  is_paid BOOLEAN DEFAULT FALSE,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_expenses_type ON expenses(type);
CREATE INDEX idx_expenses_is_paid ON expenses(is_paid);
CREATE INDEX idx_expenses_category_id ON expenses(category_id);

-- RLS for expense_categories
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view expense categories"
  ON expense_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Super admins can insert expense categories"
  ON expense_categories FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update expense categories"
  ON expense_categories FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete expense categories"
  ON expense_categories FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

-- RLS for expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view expenses"
  ON expenses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Super admins can insert expenses"
  ON expenses FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update expenses"
  ON expenses FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete expenses"
  ON expenses FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');
