-- Financial cash planning, Stripe payout mirror, and listing-level allocations.

CREATE TABLE stripe_payouts (
  id TEXT PRIMARY KEY,
  amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  arrival_date TIMESTAMPTZ NOT NULL,
  created TIMESTAMPTZ NOT NULL,
  automatic BOOLEAN NOT NULL DEFAULT TRUE,
  reconciliation_status TEXT,
  failure_code TEXT,
  failure_message TEXT,
  raw_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stripe_payouts_arrival_status
  ON stripe_payouts(arrival_date DESC, status);

CREATE TABLE stripe_payout_transactions (
  id TEXT PRIMARY KEY,
  payout_id TEXT NOT NULL REFERENCES stripe_payouts(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL DEFAULT 0,
  net_cents BIGINT NOT NULL,
  currency TEXT NOT NULL,
  type TEXT NOT NULL,
  source_id TEXT,
  invoice_id TEXT,
  subscription_id TEXT,
  available_on TIMESTAMPTZ,
  created TIMESTAMPTZ NOT NULL,
  raw_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stripe_payout_transactions_payout
  ON stripe_payout_transactions(payout_id);
CREATE INDEX idx_stripe_payout_transactions_subscription
  ON stripe_payout_transactions(subscription_id)
  WHERE subscription_id IS NOT NULL;

CREATE TABLE expense_listing_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (expense_id, listing_id)
);

CREATE INDEX idx_expense_listing_allocations_expense
  ON expense_listing_allocations(expense_id);
CREATE INDEX idx_expense_listing_allocations_listing
  ON expense_listing_allocations(listing_id);

CREATE TABLE financial_cash_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operating_cash_cents BIGINT NOT NULL DEFAULT 0,
  tax_cash_cents BIGINT NOT NULL DEFAULT 0,
  effective_date DATE NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_financial_cash_snapshots_effective
  ON financial_cash_snapshots(effective_date DESC, created_at DESC);

CREATE TABLE financial_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  start_month DATE NOT NULL,
  horizon_months INTEGER NOT NULL DEFAULT 12
    CHECK (horizon_months BETWEEN 1 AND 36),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE financial_scenario_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES financial_scenarios(id) ON DELETE CASCADE,
  source_listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  monthly_revenue_cents BIGINT NOT NULL DEFAULT 0
    CHECK (monthly_revenue_cents >= 0),
  start_month DATE NOT NULL,
  end_month DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_financial_scenario_listings_scenario
  ON financial_scenario_listings(scenario_id);

CREATE TABLE financial_scenario_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES financial_scenarios(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'fixed_expense',
      'variable_expense',
      'growth_investment',
      'capital_contribution'
    )
  ),
  description TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  recurrence TEXT NOT NULL CHECK (recurrence IN ('one_time', 'monthly')),
  start_month DATE NOT NULL,
  end_month DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_financial_scenario_events_scenario
  ON financial_scenario_events(scenario_id);

CREATE TABLE financial_scenario_event_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES financial_scenario_events(id) ON DELETE CASCADE,
  scenario_listing_id UUID NOT NULL
    REFERENCES financial_scenario_listings(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, scenario_listing_id)
);

CREATE INDEX idx_financial_scenario_event_allocations_event
  ON financial_scenario_event_allocations(event_id);

ALTER TABLE stripe_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_payout_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_listing_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_cash_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_scenario_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_scenario_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_scenario_event_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view stripe_payouts"
  ON stripe_payouts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins can write stripe_payouts"
  ON stripe_payouts FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Authenticated can view stripe_payout_transactions"
  ON stripe_payout_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins can write stripe_payout_transactions"
  ON stripe_payout_transactions FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins manage expense listing allocations"
  ON expense_listing_allocations FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins manage financial cash snapshots"
  ON financial_cash_snapshots FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins manage financial scenarios"
  ON financial_scenarios FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins manage financial scenario listings"
  ON financial_scenario_listings FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins manage financial scenario events"
  ON financial_scenario_events FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Super admins manage scenario event allocations"
  ON financial_scenario_event_allocations FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

COMMENT ON TABLE stripe_payouts IS
  'Mirror of Stripe payouts. Cash reporting uses paid payouts grouped by arrival_date.';
COMMENT ON TABLE stripe_payout_transactions IS
  'Balance transactions reconciled to automatic Stripe payouts.';
COMMENT ON TABLE financial_scenarios IS
  'Saved 1-36 month cash and operating planning scenarios.';
