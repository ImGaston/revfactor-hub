-- ============================================================
-- 025: client_stripe_customers junction - TODAVIA NO SE CORRIO
-- N:1 from Stripe customers to Hub clients. A single Hub client
-- can own multiple Stripe customer records (common when each
-- property is a separate Stripe customer under the same owner).
-- `clients.stripe_customer_id` is kept as a convenience "primary
-- customer" pointer for UI deep-links; the junction is the source
-- of truth for which Stripe customers belong to a Hub client.
-- ============================================================

CREATE TABLE client_stripe_customers (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, stripe_customer_id),
  UNIQUE (stripe_customer_id)
);

CREATE INDEX idx_client_stripe_customers_client ON client_stripe_customers(client_id);

-- ============================================================
-- Backfill from existing clients.stripe_customer_id values
-- ============================================================
INSERT INTO client_stripe_customers (client_id, stripe_customer_id)
SELECT id, stripe_customer_id
FROM clients
WHERE stripe_customer_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE client_stripe_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view client_stripe_customers"
  ON client_stripe_customers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Super admins can write client_stripe_customers"
  ON client_stripe_customers FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

COMMENT ON TABLE client_stripe_customers IS 'Junction: N Stripe customers → 1 Hub client. Source of truth for the Stripe/client relationship.';
COMMENT ON COLUMN client_stripe_customers.stripe_customer_id IS 'Stripe customer ID (cus_...). Unique — a given Stripe customer can only belong to one Hub client.';
