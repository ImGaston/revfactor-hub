-- Recurring expense templates
-- These define expenses that repeat every month on a specific day.
-- Use "Generate month" to create actual expense entries from active templates.
CREATE TABLE recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('fixed', 'variable')),
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  is_active BOOLEAN DEFAULT TRUE,
  start_date DATE,           -- optional: don't generate before this date
  end_date DATE,             -- optional: don't generate after this date
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track which recurring expense generated which expense instance
-- This prevents duplicate generation for the same month
ALTER TABLE expenses ADD COLUMN recurring_expense_id UUID REFERENCES recurring_expenses(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN recurring_month TEXT; -- format: 'YYYY-MM'

-- Prevent generating the same recurring expense twice for the same month
CREATE UNIQUE INDEX idx_expenses_recurring_month
  ON expenses(recurring_expense_id, recurring_month)
  WHERE recurring_expense_id IS NOT NULL;

-- Indexes
CREATE INDEX idx_recurring_expenses_is_active ON recurring_expenses(is_active);

-- RLS
ALTER TABLE recurring_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view recurring expenses"
  ON recurring_expenses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Super admins can insert recurring expenses"
  ON recurring_expenses FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can update recurring expenses"
  ON recurring_expenses FOR UPDATE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins can delete recurring expenses"
  ON recurring_expenses FOR DELETE
  TO authenticated
  USING (public.get_my_role() = 'super_admin');
