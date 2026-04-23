-- ============================================================
-- 024: Stripe mirror tables - TODAVIA NO SE CORRIO
-- Local mirror of Stripe subscriptions + invoices.
-- Populated by the daily cron at /api/cron/sync-stripe.
-- Read by /financials overview for fast SSR; detail page still
-- reads live from the Stripe API.
-- ============================================================

CREATE TABLE stripe_subscriptions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_email TEXT,
  customer_name TEXT,
  plan_name TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  interval TEXT,
  item_count INT NOT NULL DEFAULT 1,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created TIMESTAMPTZ NOT NULL,
  raw_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stripe_subscriptions_customer ON stripe_subscriptions(customer_id);
CREATE INDEX idx_stripe_subscriptions_status ON stripe_subscriptions(status);
CREATE INDEX idx_stripe_subscriptions_period_end ON stripe_subscriptions(current_period_end);

CREATE TABLE stripe_invoices (
  id TEXT PRIMARY KEY,
  subscription_id TEXT REFERENCES stripe_subscriptions(id) ON DELETE SET NULL,
  customer_id TEXT,
  customer_email TEXT,
  customer_name TEXT,
  amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT,
  description TEXT,
  created TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  raw_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stripe_invoices_subscription ON stripe_invoices(subscription_id);
CREATE INDEX idx_stripe_invoices_customer ON stripe_invoices(customer_id);
CREATE INDEX idx_stripe_invoices_status_created ON stripe_invoices(status, created DESC);
CREATE INDEX idx_stripe_invoices_created ON stripe_invoices(created DESC);

-- ============================================================
-- RLS — authenticated users can view, super_admin writes
-- (writes in practice come via service role from the cron)
-- ============================================================
ALTER TABLE stripe_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view stripe_subscriptions"
  ON stripe_subscriptions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Super admins can write stripe_subscriptions"
  ON stripe_subscriptions FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE POLICY "Authenticated can view stripe_invoices"
  ON stripe_invoices FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Super admins can write stripe_invoices"
  ON stripe_invoices FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

COMMENT ON TABLE stripe_subscriptions IS 'Mirror of Stripe subscriptions, refreshed daily by /api/cron/sync-stripe.';
COMMENT ON TABLE stripe_invoices IS 'Mirror of Stripe invoices. Retention policy is enforced by the sync code, not the schema.';
COMMENT ON COLUMN stripe_subscriptions.amount IS 'Total recurring amount summed across all items × quantity, in the currency unit (not cents).';
COMMENT ON COLUMN stripe_invoices.amount_due IS 'Amount due in the currency unit (not cents).';
COMMENT ON COLUMN stripe_invoices.amount_paid IS 'Amount paid in the currency unit (not cents).';
