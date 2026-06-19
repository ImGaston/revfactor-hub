-- Dismissed payment issues: lets super admins hide a specific unpaid invoice
-- from the Financials "Cobros pendientes o fallidos" card. Keyed by Stripe
-- invoice id so the dismissal survives daily Stripe re-syncs.
CREATE TABLE IF NOT EXISTS dismissed_payment_issues (
  invoice_id TEXT PRIMARY KEY,
  dismissed_by UUID REFERENCES profiles(id),
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dismissed_payment_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view dismissed_payment_issues"
  ON dismissed_payment_issues FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Super admins can write dismissed_payment_issues"
  ON dismissed_payment_issues FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

COMMENT ON TABLE dismissed_payment_issues IS 'Stripe invoice ids manually dismissed from the Financials payment-issues card.';
