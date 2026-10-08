-- Migration 089: Weather-bot delivery queue and leased Slack handoff.
--
-- Market Signals remains the source of truth. This queue snapshots only
-- material weather signals for delivery by the external Slack bot. Atlas,
-- Sage, and Weather-bot use scoped Hub API keys; none receive a Supabase
-- service-role credential and none can write pricing, stay rules, a PMS, an
-- OTA, or an Adjustment.

CREATE TABLE public.weather_bot_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  impact_id UUID NOT NULL
    REFERENCES public.market_event_impacts(id) ON DELETE CASCADE,
  event_version INTEGER NOT NULL CHECK (event_version > 0),
  signal_fingerprint TEXT NOT NULL UNIQUE
    CHECK (signal_fingerprint ~ '^[a-f0-9]{32}$'),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'leased', 'delivered', 'failed')
  ),
  priority SMALLINT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  payload JSONB NOT NULL CHECK (JSONB_TYPEOF(payload) = 'object'),
  slack_channel_id TEXT CHECK (
    slack_channel_id IS NULL OR CHAR_LENGTH(slack_channel_id) <= 120
  ),
  slack_message_ts TEXT CHECK (
    slack_message_ts IS NULL OR CHAR_LENGTH(slack_message_ts) <= 120
  ),
  last_error TEXT CHECK (
    last_error IS NULL OR CHAR_LENGTH(last_error) <= 2000
  ),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR status <> 'leased'
  ),
  CHECK (
    (status = 'delivered' AND delivered_at IS NOT NULL)
    OR status <> 'delivered'
  )
);

CREATE INDEX idx_weather_bot_deliveries_claim
  ON public.weather_bot_deliveries (priority DESC, available_at, created_at)
  WHERE status = 'queued';
CREATE INDEX idx_weather_bot_deliveries_impact_recent
  ON public.weather_bot_deliveries (impact_id, created_at DESC);

CREATE TRIGGER trg_weather_bot_deliveries_updated_at
  BEFORE UPDATE ON public.weather_bot_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.weather_bot_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Market Signals viewers can view Weather-bot delivery health"
  ON public.weather_bot_deliveries FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));

COMMENT ON TABLE public.weather_bot_deliveries IS
  'Leased, deduplicated Slack delivery queue for material weather signals. Payloads are immutable snapshots of governed Market Signals evidence.';

CREATE OR REPLACE FUNCTION public.enqueue_weather_bot_deliveries(
  p_market_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.weather_bot_deliveries
  WHERE status IN ('delivered', 'failed')
    AND created_at < NOW() - INTERVAL '90 days';

  INSERT INTO public.weather_bot_deliveries (
    impact_id,
    event_version,
    signal_fingerprint,
    priority,
    payload
  )
  SELECT
    mei.id,
    version_row.event_version,
    MD5(
      mei.id::TEXT || ':' ||
      version_row.event_version::TEXT || ':' ||
      mei.action_gate || ':' ||
      me.state
    ),
    CASE
      WHEN mei.action_gate = 'unwind' OR me.state IN ('canceled', 'postponed') THEN 100
      WHEN mei.materiality_score >= 85 THEN 90
      WHEN mei.action_gate = 'review_now' THEN 80
      ELSE 60
    END,
    JSONB_BUILD_OBJECT(
      'schemaVersion', 1,
      'impactId', mei.id,
      'eventId', me.id,
      'eventVersion', version_row.event_version,
      'title', me.title,
      'state', me.state,
      'startAt', me.start_at,
      'endAt', me.end_at,
      'market', JSONB_BUILD_OBJECT(
        'id', rm.id,
        'slug', rm.slug,
        'name', rm.name,
        'timezone', rm.timezone
      ),
      'scores', JSONB_BUILD_OBJECT(
        'materiality', mei.materiality_score,
        'vulnerability', mei.vulnerability_score,
        'actionGate', mei.action_gate,
        'evidenceFreshness', mei.evidence_freshness
      ),
      'impactWindow', JSONB_BUILD_OBJECT(
        'start', mei.impact_start,
        'end', mei.impact_end,
        'distanceMiles', mei.distance_miles
      ),
      'exposure', COALESCE(
        mei.score_components -> 'vulnerability',
        JSONB_BUILD_OBJECT(
          'evaluatedListings', 0,
          'exposedListings', 0,
          'topListings', '[]'::JSONB
        )
      ),
      'evidence', CASE
        WHEN evidence_row.evidence_url IS NULL THEN NULL
        ELSE JSONB_BUILD_OBJECT(
          'url', evidence_row.evidence_url,
          'publisher', evidence_row.publisher,
          'summary', evidence_row.evidence_summary,
          'observedAt', evidence_row.observed_at,
          'authorityTier', evidence_row.authority_tier
        )
      END,
      'generatedAt', NOW(),
      'hubUrl', '/market-signals'
    )
  FROM public.market_event_impacts mei
  JOIN public.market_events me ON me.id = mei.event_id
  JOIN public.revenue_markets rm ON rm.id = mei.market_id
  JOIN LATERAL (
    SELECT MAX(mev.version)::INTEGER AS event_version
    FROM public.market_event_versions mev
    WHERE mev.event_id = me.id
  ) version_row ON version_row.event_version IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT
      mee.evidence_url,
      mee.publisher,
      mee.evidence_summary,
      mee.observed_at,
      mee.authority_tier
    FROM public.market_event_evidence mee
    WHERE mee.event_id = me.id
    ORDER BY mee.authority_tier ASC, mee.observed_at DESC
    LIMIT 1
  ) evidence_row ON TRUE
  WHERE me.category = 'weather'
    AND mei.status = 'active'
    AND (p_market_id IS NULL OR mei.market_id = p_market_id)
    AND me.state NOT IN ('ended', 'rejected', 'duplicate', 'superseded')
    AND (
      mei.action_gate IN ('review_now', 'unwind')
      OR mei.materiality_score >= 70
      OR me.state IN ('canceled', 'postponed')
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_weather_bot_delivery(
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  delivery_id UUID,
  lease_token UUID,
  attempt INTEGER,
  payload JSONB
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_lease_token UUID := gen_random_uuid();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'Lease duration must be between 30 and 900 seconds';
  END IF;

  UPDATE public.weather_bot_deliveries
  SET
    status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
    available_at = CASE
      WHEN attempts >= max_attempts THEN available_at
      ELSE NOW() + LEAST(INTERVAL '30 minutes', attempts * INTERVAL '2 minutes')
    END,
    last_error = COALESCE(last_error, 'Weather-bot lease expired before completion'),
    lease_token = NULL,
    lease_expires_at = NULL
  WHERE status = 'leased'
    AND lease_expires_at < NOW();

  RETURN QUERY
  WITH candidate AS (
    SELECT wbd.id
    FROM public.weather_bot_deliveries wbd
    WHERE wbd.status = 'queued'
      AND wbd.available_at <= NOW()
      AND wbd.attempts < wbd.max_attempts
    ORDER BY wbd.priority DESC, wbd.available_at, wbd.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.weather_bot_deliveries wbd
  SET
    status = 'leased',
    attempts = wbd.attempts + 1,
    lease_token = v_lease_token,
    lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
    last_error = NULL
  FROM candidate
  WHERE wbd.id = candidate.id
  RETURNING
    wbd.id,
    wbd.lease_token,
    wbd.attempts::INTEGER,
    wbd.payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_weather_bot_delivery(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_delivered BOOLEAN,
  p_slack_channel_id TEXT DEFAULT NULL,
  p_slack_message_ts TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  UPDATE public.weather_bot_deliveries wbd
  SET
    status = CASE
      WHEN p_delivered THEN 'delivered'
      WHEN wbd.attempts >= wbd.max_attempts THEN 'failed'
      ELSE 'queued'
    END,
    available_at = CASE
      WHEN p_delivered OR wbd.attempts >= wbd.max_attempts THEN wbd.available_at
      ELSE NOW() + LEAST(INTERVAL '30 minutes', wbd.attempts * INTERVAL '2 minutes')
    END,
    slack_channel_id = CASE
      WHEN p_delivered THEN LEFT(NULLIF(BTRIM(p_slack_channel_id), ''), 120)
      ELSE wbd.slack_channel_id
    END,
    slack_message_ts = CASE
      WHEN p_delivered THEN LEFT(NULLIF(BTRIM(p_slack_message_ts), ''), 120)
      ELSE wbd.slack_message_ts
    END,
    delivered_at = CASE WHEN p_delivered THEN NOW() ELSE NULL END,
    last_error = CASE
      WHEN p_delivered THEN NULL
      ELSE LEFT(COALESCE(NULLIF(BTRIM(p_error), ''), 'Unknown Weather-bot delivery error'), 2000)
    END,
    lease_token = NULL,
    lease_expires_at = NULL
  WHERE wbd.id = p_delivery_id
    AND wbd.status = 'leased'
    AND wbd.lease_token = p_lease_token
  RETURNING wbd.status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Weather-bot delivery lease is no longer valid';
  END IF;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_weather_bot_deliveries(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_weather_bot_delivery(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_weather_bot_delivery(UUID, UUID, BOOLEAN, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_weather_bot_deliveries(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_weather_bot_delivery(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_weather_bot_delivery(UUID, UUID, BOOLEAN, TEXT, TEXT, TEXT)
  TO service_role;
