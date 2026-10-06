-- Operational churn access is separate from super-admin-only financial data.
ALTER TABLE public.listings
  ADD COLUMN exit_reason TEXT CHECK (exit_reason IN (
    'price', 'results', 'sold_property', 'exited_str', 'self_management',
    'competitor', 'contract_ended', 'service_issue', 'non_payment', 'other'
  )),
  ADD COLUMN exit_note TEXT CHECK (char_length(exit_note) <= 4000),
  ADD COLUMN exit_handled_by TEXT CHECK (char_length(exit_handled_by) <= 120),
  ADD COLUMN stripe_item_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (stripe_item_status IN ('pending', 'adjusted', 'n/a'));

COMMENT ON COLUMN public.listings.stripe_item_status IS 'Manual team assertion only. Never sends a Stripe request.';

INSERT INTO public.role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'churn', a.action, r.name = 'admin' AND a.action IN ('view', 'edit')
FROM public.roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')) a(action)
WHERE r.name <> 'super_admin'
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Only non-financial cancellation metadata crosses the Stripe RLS boundary.
-- Do not broaden the mirror-table policies or return amounts, customer details,
-- raw_json, invoice data, or billing links to operational users.
CREATE FUNCTION public.churn_leaving_subscriptions()
RETURNS TABLE (client_id UUID, subscription_id TEXT, scheduled_end DATE, synced_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.has_permission('churn', 'view') IS NOT TRUE
     OR public.has_permission('clients', 'view') IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH customer_links AS (
    SELECT j.client_id, j.stripe_customer_id FROM public.client_stripe_customers j
    UNION
    SELECT c.id, c.stripe_customer_id FROM public.clients c
    WHERE c.stripe_customer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.client_stripe_customers j WHERE j.stripe_customer_id = c.stripe_customer_id)
  ), subscription_links AS (
    SELECT j.client_id, s.id AS subscription_id
    FROM customer_links j JOIN public.stripe_subscriptions s ON s.customer_id = j.stripe_customer_id
    UNION
    SELECT l.client_id, l.stripe_subscription_id FROM public.listings l
    WHERE l.stripe_subscription_id IS NOT NULL
  )
  SELECT c.id, s.id, (s.current_period_end AT TIME ZONE 'America/New_York')::date, s.synced_at
  FROM subscription_links link
  JOIN public.clients c ON c.id = link.client_id AND c.status = 'active'
  JOIN public.stripe_subscriptions s ON s.id = link.subscription_id
  WHERE s.cancel_at_period_end = TRUE AND s.status NOT IN ('canceled', 'incomplete_expired')
  ORDER BY c.id, s.id;
END;
$$;
REVOKE ALL ON FUNCTION public.churn_leaving_subscriptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.churn_leaving_subscriptions() TO authenticated;

-- An atomic, invoker/RLS-respecting write. Parent account must still be active
-- when the update runs; no client status or listing lifecycle fields are written.
CREATE FUNCTION public.tag_listing_exit(
  p_listing_id UUID, p_reason TEXT, p_note TEXT, p_handled_by TEXT, p_stripe_item_status TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE saved_id UUID;
BEGIN
  IF auth.uid() IS NULL
     OR public.has_permission('churn', 'edit') IS NOT TRUE
     OR public.has_permission('churn', 'view') IS NOT TRUE
     OR public.has_permission('listings', 'edit') IS NOT TRUE
     OR public.has_permission('clients', 'view') IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR p_stripe_item_status IS NULL THEN
    RAISE EXCEPTION 'Reason and Stripe item status are required';
  END IF;
  UPDATE public.listings l
    SET exit_reason = p_reason, exit_note = NULLIF(btrim(p_note), ''),
        exit_handled_by = NULLIF(btrim(p_handled_by), ''), stripe_item_status = p_stripe_item_status
    WHERE l.id = p_listing_id AND l.status = 'inactive'
      AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = l.client_id AND c.status = 'active')
    RETURNING l.id INTO saved_id;
  IF saved_id IS NULL THEN
    RAISE EXCEPTION 'Listing is no longer an inactive listing of an active client';
  END IF;
  RETURN saved_id;
END;
$$;
REVOKE ALL ON FUNCTION public.tag_listing_exit(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tag_listing_exit(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- A later reactivation/re-exit must not inherit the previous exit's reason or
-- manual Stripe assertion. The existing deactivated_date trigger is untouched.
CREATE FUNCTION public.clear_listing_exit_on_reactivation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'inactive' AND NEW.status = 'active' THEN
    NEW.exit_reason := NULL;
    NEW.exit_note := NULL;
    NEW.exit_handled_by := NULL;
    NEW.stripe_item_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_clear_listing_exit_on_reactivation
  BEFORE UPDATE OF status ON public.listings FOR EACH ROW
  EXECUTE FUNCTION public.clear_listing_exit_on_reactivation();
REVOKE ALL ON FUNCTION public.clear_listing_exit_on_reactivation() FROM PUBLIC, anon, authenticated;

CREATE INDEX idx_listings_partial_exit_date ON public.listings(deactivated_date, client_id) WHERE status = 'inactive';
CREATE INDEX idx_clients_churn_date ON public.clients(ending_date) WHERE status = 'inactive';

-- The catalog places Churn tracker after Onboarding at the main level. A
-- folder configuration can instead place Onboarding in a custom group.
INSERT INTO public.nav_item_settings (item_key, group_id, sort_order)
SELECT 'churn', n.group_id, n.sort_order + 1
FROM public.nav_item_settings n WHERE n.item_key = 'onboarding'
ON CONFLICT (item_key) DO NOTHING;
