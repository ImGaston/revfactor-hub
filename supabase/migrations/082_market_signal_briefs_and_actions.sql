-- Migration 082: governed Signal Brief cache and atomic Adjustment linkage.
--
-- AI output explains deterministic Market Signals evidence. It does not own
-- scoring, action gates, or any PriceLabs/PMS/OTA mutation. Human decisions
-- remain append-only in market_signal_reviews.

CREATE TABLE public.market_signal_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impact_id UUID NOT NULL
    REFERENCES public.market_event_impacts(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  prompt_version TEXT NOT NULL CHECK (CHAR_LENGTH(prompt_version) BETWEEN 3 AND 80),
  model_id TEXT NOT NULL CHECK (CHAR_LENGTH(model_id) BETWEEN 3 AND 120),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  input_snapshot JSONB NOT NULL CHECK (JSONB_TYPEOF(input_snapshot) = 'object'),
  output JSONB CHECK (output IS NULL OR JSONB_TYPEOF(output) = 'object'),
  error_message TEXT CHECK (
    error_message IS NULL OR CHAR_LENGTH(error_message) <= 2000
  ),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
  generation_ms INTEGER CHECK (generation_ms IS NULL OR generation_ms >= 0),
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (impact_id, input_hash, prompt_version, model_id),
  CHECK (
    (status = 'completed' AND output IS NOT NULL AND generated_at IS NOT NULL)
    OR status <> 'completed'
  )
);

CREATE INDEX idx_market_signal_briefs_impact_recent
  ON public.market_signal_briefs (impact_id, generated_at DESC NULLS LAST);
CREATE INDEX idx_market_signal_briefs_pending
  ON public.market_signal_briefs (status, updated_at)
  WHERE status = 'pending';

CREATE TRIGGER trg_market_signal_briefs_updated_at
  BEFORE UPDATE ON public.market_signal_briefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_signal_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Market Signals viewers can view Signal Briefs"
  ON public.market_signal_briefs FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));

COMMENT ON TABLE public.market_signal_briefs IS
  'Cached, structured AI explanations of deterministic Market Signals evidence. No model output can execute a commercial change.';

ALTER TABLE public.market_signal_reviews
  ADD COLUMN brief_id UUID
  REFERENCES public.market_signal_briefs(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX idx_market_signal_reviews_brief_decision
  ON public.market_signal_reviews (brief_id)
  WHERE brief_id IS NOT NULL;

-- Create one safe, open internal Adjustment for one currently exposed listing
-- and append the Market Signals decision in the same database transaction.
CREATE OR REPLACE FUNCTION public.create_market_signal_adjustment(
  p_impact_id UUID,
  p_brief_id UUID,
  p_listing_id UUID,
  p_reason TEXT
)
RETURNS TABLE (adjustment_id UUID, public_token UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_client_id UUID;
  v_event_title TEXT;
  v_market_name TEXT;
  v_impact_start DATE;
  v_impact_end DATE;
  v_materiality NUMERIC;
  v_vulnerability NUMERIC;
  v_exposure NUMERIC;
  v_listing_name TEXT;
  v_adjustment_id UUID;
  v_public_token UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_permission('market_signals', 'edit') THEN
    RAISE EXCEPTION 'Market Signals edit permission is required';
  END IF;
  IF NOT public.has_permission('adjustments', 'create') THEN
    RAISE EXCEPTION 'Adjustments create permission is required';
  END IF;
  IF p_reason IS NULL OR CHAR_LENGTH(BTRIM(p_reason)) < 3
    OR CHAR_LENGTH(BTRIM(p_reason)) > 2000 THEN
    RAISE EXCEPTION 'A bounded review reason is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.market_signal_briefs msb
    WHERE msb.id = p_brief_id
      AND msb.impact_id = p_impact_id
      AND msb.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'A completed current Signal Brief is required';
  END IF;

  SELECT
    l.client_id,
    l.name,
    me.title,
    rm.name,
    mei.impact_start,
    mei.impact_end,
    mei.materiality_score,
    mei.vulnerability_score,
    mele.vulnerability_score
  INTO
    v_client_id,
    v_listing_name,
    v_event_title,
    v_market_name,
    v_impact_start,
    v_impact_end,
    v_materiality,
    v_vulnerability,
    v_exposure
  FROM public.market_event_impacts mei
  JOIN public.market_events me ON me.id = mei.event_id
  JOIN public.revenue_markets rm ON rm.id = mei.market_id
  JOIN public.market_event_listing_exposures mele
    ON mele.impact_id = mei.id
   AND mele.listing_id = p_listing_id
   AND mele.freshness = 'current'
   AND mele.vulnerability_score >= 45
  JOIN public.listings l ON l.id = mele.listing_id
  WHERE mei.id = p_impact_id
    AND mei.status = 'active'
    AND mei.action_gate = 'review_now';

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'The selected listing is not a current exposed listing for this signal';
  END IF;

  INSERT INTO public.adjustments (
    scope,
    client_id,
    listing_id,
    type,
    target_value,
    date_from,
    date_to,
    booking_window,
    urgency,
    origin,
    requested_by,
    origin_message,
    status,
    created_by
  ) VALUES (
    'single_listing',
    v_client_id,
    p_listing_id,
    'recommendation',
    FORMAT(
      'Review event-driven pricing and stay rules for %s. No commercial change is approved by this request.',
      v_event_title
    ),
    v_impact_start,
    v_impact_end,
    NULL,
    CASE WHEN v_impact_start <= CURRENT_DATE + 30 THEN 'high' ELSE 'medium' END,
    'internal',
    'Market Signals',
    FORMAT(
      'Created from Market Signals for %s in %s. Listing exposure %s; market materiality %s; market vulnerability %s. Review live PriceLabs pricing, inventory, stay rules, and channel restrictions before approving any change.',
      v_listing_name,
      v_market_name,
      ROUND(v_exposure),
      ROUND(v_materiality),
      ROUND(v_vulnerability)
    ),
    'open',
    v_user_id
  )
  RETURNING id, adjustments.public_token
  INTO v_adjustment_id, v_public_token;

  INSERT INTO public.market_signal_reviews (
    impact_id,
    decision,
    reason,
    evidence_snapshot,
    adjustment_id,
    brief_id,
    created_by
  ) VALUES (
    p_impact_id,
    'create_adjustment',
    BTRIM(p_reason),
    JSONB_BUILD_OBJECT(
      'eventTitle', v_event_title,
      'marketName', v_market_name,
      'listingId', p_listing_id,
      'listingName', v_listing_name,
      'impactStart', v_impact_start,
      'impactEnd', v_impact_end,
      'materialityScore', v_materiality,
      'vulnerabilityScore', v_vulnerability,
      'listingExposureScore', v_exposure,
      'adjustmentId', v_adjustment_id
    ),
    v_adjustment_id,
    p_brief_id,
    v_user_id
  );

  RETURN QUERY SELECT v_adjustment_id, v_public_token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_market_signal_adjustment(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_market_signal_adjustment(UUID, UUID, UUID, TEXT)
  TO authenticated;

-- Link an already-open Adjustment only when it belongs to a client represented
-- by the signal's exposed listings. This appends a decision and mutates nothing.
CREATE OR REPLACE FUNCTION public.link_market_signal_adjustment(
  p_impact_id UUID,
  p_brief_id UUID,
  p_adjustment_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_adjustment_client_id UUID;
  v_adjustment_listing_id UUID;
  v_adjustment_status TEXT;
  v_event_title TEXT;
  v_market_name TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_permission('market_signals', 'edit') THEN
    RAISE EXCEPTION 'Market Signals edit permission is required';
  END IF;
  IF NOT public.has_permission('adjustments', 'view') THEN
    RAISE EXCEPTION 'Adjustments view permission is required';
  END IF;
  IF p_reason IS NULL OR CHAR_LENGTH(BTRIM(p_reason)) < 3
    OR CHAR_LENGTH(BTRIM(p_reason)) > 2000 THEN
    RAISE EXCEPTION 'A bounded link reason is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.market_signal_briefs msb
    WHERE msb.id = p_brief_id
      AND msb.impact_id = p_impact_id
      AND msb.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'A completed current Signal Brief is required';
  END IF;

  SELECT client_id, listing_id, status
  INTO v_adjustment_client_id, v_adjustment_listing_id, v_adjustment_status
  FROM public.adjustments
  WHERE id = p_adjustment_id;

  IF v_adjustment_client_id IS NULL THEN
    RAISE EXCEPTION 'Adjustment not found';
  END IF;
  IF v_adjustment_status NOT IN ('open', 'in_progress', 'needs_info', 'issue') THEN
    RAISE EXCEPTION 'Only an open Adjustment can be linked';
  END IF;

  SELECT me.title, rm.name
  INTO v_event_title, v_market_name
  FROM public.market_event_impacts mei
  JOIN public.market_events me ON me.id = mei.event_id
  JOIN public.revenue_markets rm ON rm.id = mei.market_id
  WHERE mei.id = p_impact_id
    AND mei.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.market_event_listing_exposures mele
      JOIN public.listings l ON l.id = mele.listing_id
      WHERE mele.impact_id = mei.id
        AND (
          mele.listing_id = v_adjustment_listing_id
          OR l.client_id = v_adjustment_client_id
        )
    );

  IF v_event_title IS NULL THEN
    RAISE EXCEPTION 'The Adjustment is not related to an exposed signal client or listing';
  END IF;

  INSERT INTO public.market_signal_reviews (
    impact_id,
    decision,
    reason,
    evidence_snapshot,
    adjustment_id,
    brief_id,
    created_by
  ) VALUES (
    p_impact_id,
    'link_adjustment',
    BTRIM(p_reason),
    JSONB_BUILD_OBJECT(
      'eventTitle', v_event_title,
      'marketName', v_market_name,
      'adjustmentId', p_adjustment_id,
      'adjustmentClientId', v_adjustment_client_id,
      'adjustmentListingId', v_adjustment_listing_id
    ),
    p_adjustment_id,
    p_brief_id,
    v_user_id
  );

  RETURN p_adjustment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_market_signal_adjustment(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_market_signal_adjustment(UUID, UUID, UUID, TEXT)
  TO authenticated;
