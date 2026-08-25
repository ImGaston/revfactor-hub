-- Migration 084: enqueue scheduled market work only when a source is due.
--
-- The worker may wake every minute to drain many markets, but each source
-- retains its own cadence. Manual, recovery, and inventory-only work bypass the
-- provider cadence without changing it.

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
    AND (
      p_reason <> 'scheduled'
      OR EXISTS (
        SELECT 1
        FROM public.revenue_market_sources rms
        WHERE rms.market_id = rm.id
          AND rms.is_active = TRUE
          AND (
            rms.last_attempt_at IS NULL
            OR rms.last_attempt_at <= NOW() - make_interval(mins => rms.cadence_minutes)
          )
      )
    )
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

REVOKE ALL ON FUNCTION public.enqueue_market_signal_jobs(TEXT, UUID, SMALLINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_market_signal_jobs(TEXT, UUID, SMALLINT)
  TO service_role;
