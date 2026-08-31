-- Secure prospect listing-review intake. This migration creates only Hub data
-- and a private Storage bucket; it does not send email/SMS or call GHL.

CREATE TABLE IF NOT EXISTS listing_review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  ghl_contact_id TEXT,
  ghl_appointment_id TEXT,
  prospect_name TEXT NOT NULL,
  prospect_email TEXT NOT NULL,
  appointment_owner_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  appointment_owner_name TEXT NOT NULL,
  appointment_owner_email TEXT NOT NULL,
  federico_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  federico_name TEXT NOT NULL,
  federico_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'in_review', 'completed', 'cancelled')),
  property_count SMALLINT NOT NULL DEFAULT 1 CHECK (property_count BETWEEN 1 AND 3),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  draft_payload JSONB NOT NULL DEFAULT '{"propertyCount":1,"properties":[]}'::jsonb,
  submitted_payload JSONB,
  requested_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_saved_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CHECK (submitted_at IS NULL OR submitted_payload IS NOT NULL),
  CHECK (status <> 'submitted' OR submitted_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_listing_review_requests_status
  ON listing_review_requests(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_review_requests_lead
  ON listing_review_requests(lead_id) WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS listing_review_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES listing_review_requests(id) ON DELETE CASCADE,
  property_number SMALLINT NOT NULL CHECK (property_number BETWEEN 1 AND 3),
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'application/pdf',
    'text/csv',
    'text/plain',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_review_files_request
  ON listing_review_files(request_id, property_number, uploaded_at);

CREATE TABLE IF NOT EXISTS listing_review_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES listing_review_requests(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('submitted')),
  recipient_email TEXT NOT NULL,
  recipient_email_normalized TEXT GENERATED ALWAYS AS (lower(recipient_email)) STORED,
  recipient_name TEXT NOT NULL,
  recipient_roles TEXT[] NOT NULL DEFAULT '{}'::text[],
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_review_delivery_recipient
  ON listing_review_notification_deliveries(request_id, event_type, recipient_email_normalized);
CREATE INDEX IF NOT EXISTS idx_listing_review_delivery_queue
  ON listing_review_notification_deliveries(status, updated_at)
  WHERE status <> 'sent';

CREATE TABLE IF NOT EXISTS listing_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES listing_review_requests(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'draft_saved', 'file_uploaded', 'file_deleted', 'submitted',
    'review_started', 'completed', 'cancelled'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('prospect', 'internal', 'system')),
  actor_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_review_events_request
  ON listing_review_events(request_id, created_at);

ALTER TABLE listing_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_review_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_review_notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_review_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "GHL users can view listing review requests"
  ON listing_review_requests FOR SELECT TO authenticated
  USING (public.has_permission('ghl', 'view'));
CREATE POLICY "GHL users can create listing review requests"
  ON listing_review_requests FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('ghl', 'create'));
CREATE POLICY "GHL users can edit listing review requests"
  ON listing_review_requests FOR UPDATE TO authenticated
  USING (public.has_permission('ghl', 'edit'))
  WITH CHECK (public.has_permission('ghl', 'edit'));
CREATE POLICY "GHL users can view listing review files"
  ON listing_review_files FOR SELECT TO authenticated
  USING (public.has_permission('ghl', 'view'));
CREATE POLICY "GHL users can create listing review files"
  ON listing_review_files FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('ghl', 'edit'));
CREATE POLICY "GHL users can view listing review deliveries"
  ON listing_review_notification_deliveries FOR SELECT TO authenticated
  USING (public.has_permission('ghl', 'view'));
CREATE POLICY "GHL users can create listing review deliveries"
  ON listing_review_notification_deliveries FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('ghl', 'edit'));
CREATE POLICY "GHL users can edit listing review deliveries"
  ON listing_review_notification_deliveries FOR UPDATE TO authenticated
  USING (public.has_permission('ghl', 'edit'))
  WITH CHECK (public.has_permission('ghl', 'edit'));

CREATE POLICY "GHL users can view listing review events"
  ON listing_review_events FOR SELECT TO authenticated
  USING (public.has_permission('ghl', 'view'));
CREATE POLICY "GHL users can create listing review events"
  ON listing_review_events FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('ghl', 'create')
    OR public.has_permission('ghl', 'edit')
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listing-review-financials',
  'listing-review-financials',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'text/csv',
    'text/plain',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Only the server-side service role accesses this private bucket. The public
-- form receives short-lived, single-path signed upload tokens after its
-- capability token is validated. Internal downloads are also signed briefly.
-- No anon/authenticated storage.objects policy is intentionally created.

CREATE OR REPLACE FUNCTION public.submit_listing_review(
  p_request_id UUID,
  p_expected_revision INTEGER,
  p_payload JSONB
)
RETURNS TABLE (new_revision INTEGER, submitted_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request listing_review_requests%ROWTYPE;
  v_submitted_at TIMESTAMPTZ := now();
  v_property_number INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT * INTO v_request
  FROM listing_review_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'draft' THEN
    RAISE EXCEPTION 'listing review is unavailable';
  END IF;
  IF v_request.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'listing review revision conflict';
  END IF;
  IF jsonb_typeof(p_payload) <> 'object'
     OR (p_payload->>'propertyCount')::INTEGER <> v_request.property_count THEN
    RAISE EXCEPTION 'invalid listing review payload';
  END IF;

  FOR v_property_number IN 1..v_request.property_count LOOP
    IF NOT EXISTS (
      SELECT 1 FROM listing_review_files
      WHERE request_id = p_request_id AND property_number = v_property_number
    ) THEN
      RAISE EXCEPTION 'financial file required for property %', v_property_number;
    END IF;
  END LOOP;

  UPDATE listing_review_requests
  SET status = 'submitted',
      draft_payload = p_payload,
      submitted_payload = p_payload,
      revision = revision + 1,
      last_saved_at = v_submitted_at,
      submitted_at = v_submitted_at,
      updated_at = v_submitted_at
  WHERE id = p_request_id;

  INSERT INTO listing_review_notification_deliveries (
    request_id, event_type, recipient_email, recipient_name, recipient_roles
  ) VALUES (
    p_request_id, 'submitted', v_request.appointment_owner_email,
    v_request.appointment_owner_name, ARRAY['appointment_owner']
  )
  ON CONFLICT (request_id, event_type, recipient_email_normalized)
  DO UPDATE SET recipient_roles = ARRAY(
    SELECT DISTINCT unnest(
      listing_review_notification_deliveries.recipient_roles || EXCLUDED.recipient_roles
    )
  );

  INSERT INTO listing_review_notification_deliveries (
    request_id, event_type, recipient_email, recipient_name, recipient_roles
  ) VALUES (
    p_request_id, 'submitted', v_request.federico_email,
    v_request.federico_name, ARRAY['federico']
  )
  ON CONFLICT (request_id, event_type, recipient_email_normalized)
  DO UPDATE SET recipient_roles = ARRAY(
    SELECT DISTINCT unnest(
      listing_review_notification_deliveries.recipient_roles || EXCLUDED.recipient_roles
    )
  );

  INSERT INTO listing_review_events (request_id, event_type, actor_type)
  VALUES (p_request_id, 'submitted', 'prospect');

  RETURN QUERY SELECT v_request.revision + 1, v_submitted_at;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_listing_review(UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_listing_review(UUID, INTEGER, JSONB) TO service_role;
