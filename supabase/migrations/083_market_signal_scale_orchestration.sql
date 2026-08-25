-- Migration 083: scalable Market Signals work orchestration and set-based scoring persistence.
--
-- One leased job isolates each market so a slow provider response cannot block
-- the rest of the portfolio. Derived vulnerability state is replaced in one
-- transaction and stores only the bounded actionable property set. Neither
-- path can write pricing, stay rules, a PMS, an OTA, or an Adjustment.

CREATE TABLE public.market_signal_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL
    REFERENCES public.revenue_markets(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (
    reason IN ('scheduled', 'manual', 'recovery', 'inventory_refresh')
  ),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed')
  ),
  priority SMALLINT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  result JSONB CHECK (result IS NULL OR JSONB_TYPEOF(result) = 'object'),
  last_error TEXT CHECK (last_error IS NULL OR CHAR_LENGTH(last_error) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR status <> 'running'
  )
);

CREATE UNIQUE INDEX idx_market_signal_jobs_one_active_per_market
  ON public.market_signal_jobs (market_id)
  WHERE status IN ('queued', 'running');
CREATE INDEX idx_market_signal_jobs_claim
  ON public.market_signal_jobs (priority DESC, available_at, created_at)
  WHERE status = 'queued';
CREATE INDEX idx_market_signal_jobs_market_recent
  ON public.market_signal_jobs (market_id, created_at DESC);

CREATE TRIGGER trg_market_signal_jobs_updated_at
  BEFORE UPDATE ON public.market_signal_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_signal_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Market Signals viewers can view job health"
  ON public.market_signal_jobs FOR SELECT TO authenticated
  USING (public.has_permission('market_signals', 'view'));

COMMENT ON TABLE public.market_signal_jobs IS
  'Durable per-market ingestion/scoring/brief work with leases, bounded retries, and operator-visible results.';

CREATE OR REPLACE FUNCTION public.enqueue_market_signal_jobs(
  p_reason TEXT DEFAULT 'scheduled',
  p_market_id UUID DEFAULT NULL,
  p_priority SMALLINT DEFAULT 50
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_reason NOT IN ('scheduled', 'manual', 'recovery', 'inventory_refresh') THEN
    RAISE EXCEPTION 'Invalid Market Signals job reason';
  END IF;
  IF p_priority < 0 OR p_priority > 100 THEN
    RAISE EXCEPTION 'Invalid Market Signals job priority';
  END IF;

  DELETE FROM public.market_signal_jobs
  WHERE status IN ('succeeded', 'failed')
    AND created_at < NOW() - INTERVAL '30 days';

  INSERT INTO public.market_signal_jobs (
    market_id,
    reason,
    priority,
    available_at
  )
  SELECT rm.id, p_reason, p_priority, NOW()
  FROM public.revenue_markets rm
  WHERE rm.status = 'active'
    AND rm.management_mode = 'agent'
    AND (p_market_id IS NULL OR rm.id = p_market_id)
  ON CONFLICT (market_id) WHERE status IN ('queued', 'running')
  DO UPDATE SET
    priority = GREATEST(public.market_signal_jobs.priority, EXCLUDED.priority),
    reason = CASE
      WHEN EXCLUDED.priority >= public.market_signal_jobs.priority
        THEN EXCLUDED.reason
      ELSE public.market_signal_jobs.reason
    END,
    available_at = LEAST(public.market_signal_jobs.available_at, EXCLUDED.available_at);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_market_signal_job(
  p_lease_seconds INTEGER DEFAULT 330
)
RETURNS TABLE (
  job_id UUID,
  market_id UUID,
  reason TEXT,
  attempt INTEGER,
  lease_token UUID
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

  UPDATE public.market_signal_jobs
  SET
    status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
    available_at = CASE
      WHEN attempts >= max_attempts THEN available_at
      ELSE NOW() + LEAST(INTERVAL '30 minutes', attempts * INTERVAL '2 minutes')
    END,
    completed_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END,
    last_error = COALESCE(last_error, 'Worker lease expired before completion'),
    lease_token = NULL,
    lease_expires_at = NULL
  WHERE status = 'running'
    AND lease_expires_at < NOW();

  RETURN QUERY
  WITH candidate AS (
    SELECT msj.id
    FROM public.market_signal_jobs msj
    WHERE msj.status = 'queued'
      AND msj.available_at <= NOW()
      AND msj.attempts < msj.max_attempts
    ORDER BY msj.priority DESC, msj.available_at, msj.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.market_signal_jobs msj
  SET
    status = 'running',
    attempts = msj.attempts + 1,
    lease_token = v_lease_token,
    lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
    started_at = NOW(),
    completed_at = NULL,
    duration_ms = NULL
  FROM candidate
  WHERE msj.id = candidate.id
  RETURNING
    msj.id,
    msj.market_id,
    msj.reason,
    msj.attempts::INTEGER,
    msj.lease_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_market_signal_job(
  p_job_id UUID,
  p_lease_token UUID,
  p_succeeded BOOLEAN,
  p_result JSONB DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_duration_ms INTEGER DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  UPDATE public.market_signal_jobs msj
  SET
    status = CASE
      WHEN p_succeeded THEN 'succeeded'
      WHEN msj.attempts >= msj.max_attempts THEN 'failed'
      ELSE 'queued'
    END,
    available_at = CASE
      WHEN p_succeeded OR msj.attempts >= msj.max_attempts THEN msj.available_at
      ELSE NOW() + LEAST(INTERVAL '30 minutes', msj.attempts * INTERVAL '2 minutes')
    END,
    completed_at = CASE
      WHEN p_succeeded OR msj.attempts >= msj.max_attempts THEN NOW()
      ELSE NULL
    END,
    duration_ms = p_duration_ms,
    result = p_result,
    last_error = CASE
      WHEN p_succeeded THEN NULL
      ELSE LEFT(COALESCE(p_error, 'Unknown Market Signals worker error'), 2000)
    END,
    lease_token = NULL,
    lease_expires_at = NULL
  WHERE msj.id = p_job_id
    AND msj.status = 'running'
    AND msj.lease_token = p_lease_token
  RETURNING msj.status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Market Signals job lease is no longer valid';
  END IF;
  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_market_signal_scoring(
  p_market_id UUID,
  p_impacts JSONB,
  p_exposures JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_impacts INTEGER := 0;
  v_exposures INTEGER := 0;
BEGIN
  IF JSONB_TYPEOF(p_impacts) <> 'array' OR JSONB_TYPEOF(p_exposures) <> 'array' THEN
    RAISE EXCEPTION 'Scoring payloads must be arrays';
  END IF;

  DELETE FROM public.market_event_listing_exposures mele
  USING public.market_event_impacts mei
  WHERE mele.impact_id = mei.id
    AND mei.market_id = p_market_id;

  WITH rows AS (
    SELECT *
    FROM JSONB_TO_RECORDSET(p_exposures) AS x(
      impact_id UUID,
      listing_id UUID,
      metric_source TEXT,
      metric_period DATE,
      source_observed_at TIMESTAMPTZ,
      occupancy_pct NUMERIC,
      market_occupancy_pct NUMERIC,
      occupancy_stly_pct NUMERIC,
      median_booking_window_days NUMERIC,
      days_until_impact INTEGER,
      last_booked_at TIMESTAMPTZ,
      vulnerability_score NUMERIC,
      score_components JSONB,
      freshness TEXT
    )
  )
  INSERT INTO public.market_event_listing_exposures (
    impact_id,
    listing_id,
    metric_source,
    metric_period,
    source_observed_at,
    occupancy_pct,
    market_occupancy_pct,
    occupancy_stly_pct,
    median_booking_window_days,
    days_until_impact,
    last_booked_at,
    vulnerability_score,
    score_components,
    freshness
  )
  SELECT
    rows.impact_id,
    rows.listing_id,
    rows.metric_source,
    rows.metric_period,
    rows.source_observed_at,
    rows.occupancy_pct,
    rows.market_occupancy_pct,
    rows.occupancy_stly_pct,
    rows.median_booking_window_days,
    rows.days_until_impact,
    rows.last_booked_at,
    rows.vulnerability_score,
    rows.score_components,
    rows.freshness
  FROM rows
  JOIN public.market_event_impacts mei
    ON mei.id = rows.impact_id
   AND mei.market_id = p_market_id
  JOIN public.revenue_market_listings rml
    ON rml.market_id = p_market_id
   AND rml.listing_id = rows.listing_id
   AND rml.membership_status = 'approved';

  GET DIAGNOSTICS v_exposures = ROW_COUNT;

  WITH rows AS (
    SELECT *
    FROM JSONB_TO_RECORDSET(p_impacts) AS x(
      id UUID,
      vulnerability_score NUMERIC,
      action_gate TEXT,
      score_components JSONB,
      evidence_freshness TEXT
    )
  )
  UPDATE public.market_event_impacts mei
  SET
    vulnerability_score = rows.vulnerability_score,
    action_gate = rows.action_gate,
    score_components = rows.score_components,
    evidence_freshness = rows.evidence_freshness
  FROM rows
  WHERE mei.id = rows.id
    AND mei.market_id = p_market_id;

  GET DIAGNOSTICS v_impacts = ROW_COUNT;

  RETURN JSONB_BUILD_OBJECT(
    'impactsUpdated', v_impacts,
    'exposuresStored', v_exposures
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_market_signal_jobs(TEXT, UUID, SMALLINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_market_signal_job(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_market_signal_job(UUID, UUID, BOOLEAN, JSONB, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_market_signal_scoring(UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_market_signal_jobs(TEXT, UUID, SMALLINT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_market_signal_job(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_market_signal_job(UUID, UUID, BOOLEAN, JSONB, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_market_signal_scoring(UUID, JSONB, JSONB)
  TO service_role;
