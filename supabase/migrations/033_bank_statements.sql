-- Bank statement import & reconciliation.
-- Ingests Relay statement CSV exports for the payout-receiving (income) and
-- OPEX accounts. Relay's "Transaction Type" column is the deterministic
-- classifier: Receive = external income, Spend = real expense,
-- *-transfer = internal movement (Profit First / inter-account) that must be
-- excluded from income and expense. Stripe remains the source of truth for
-- subscriptions and payouts; bank data confirms settled cash.

-- Known internal bank accounts. Used to recognize internal counterparties so
-- Profit First and inter-account transfers are not double-counted.
CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('income', 'opex', 'tax', 'partner', 'other')),
  is_internal BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the known Relay accounts and their Profit First roles.
INSERT INTO bank_accounts (account_number, label, role) VALUES
  ('6878', 'Income Account', 'income'),
  ('8039', 'Opex Account', 'opex'),
  ('8047', 'Taxes', 'tax'),
  ('8049', 'Partner — Gastón', 'partner'),
  ('8050', 'Partner — Federico', 'partner');

-- One row per uploaded statement file (audit trail).
CREATE TABLE bank_statement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  imported_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bank_statement_imports_account
  ON bank_statement_imports(account_id, created_at DESC);

-- Normalized bank transactions.
CREATE TABLE bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  import_id UUID REFERENCES bank_statement_imports(id) ON DELETE SET NULL,
  txn_date DATE NOT NULL,
  payee TEXT,
  counterparty_account TEXT,
  txn_type TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  description TEXT,
  reference TEXT,
  status TEXT,
  amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  balance_cents BIGINT,
  flow_class TEXT NOT NULL CHECK (
    flow_class IN (
      'external_income',
      'external_expense',
      'internal_transfer',
      'profit_first',
      'unknown'
    )
  ),
  matched_payout_id TEXT REFERENCES stripe_payouts(id) ON DELETE SET NULL,
  matched_transfer_id UUID REFERENCES bank_transactions(id) ON DELETE SET NULL,
  expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  dedupe_hash TEXT NOT NULL UNIQUE,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bank_transactions_account_date
  ON bank_transactions(account_id, txn_date DESC);
CREATE INDEX idx_bank_transactions_flow_class
  ON bank_transactions(flow_class);
CREATE INDEX idx_bank_transactions_matched_payout
  ON bank_transactions(matched_payout_id)
  WHERE matched_payout_id IS NOT NULL;

-- Link auto-created expenses back to their originating bank transaction so
-- re-imports never duplicate an expense.
ALTER TABLE expenses
  ADD COLUMN bank_transaction_id UUID
    REFERENCES bank_transactions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_expenses_bank_transaction
  ON expenses(bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;

-- RLS: view to all authenticated (page is super_admin-gated), writes super_admin.
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view bank_accounts"
  ON bank_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins can write bank_accounts"
  ON bank_accounts FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Authenticated can view bank_statement_imports"
  ON bank_statement_imports FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins can write bank_statement_imports"
  ON bank_statement_imports FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Authenticated can view bank_transactions"
  ON bank_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins can write bank_transactions"
  ON bank_transactions FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

COMMENT ON TABLE bank_accounts IS
  'Known internal bank accounts and Profit First roles for transfer detection.';
COMMENT ON TABLE bank_transactions IS
  'Normalized bank statement rows. flow_class drives income/expense inclusion; *-transfer rows are excluded.';
COMMENT ON COLUMN bank_transactions.dedupe_hash IS
  'Stable hash of account_number|date|amount|balance|payee|type for idempotent re-import.';
