-- Report Builder: at most one active run at a time.
--
-- The per-minute cron tick and the manual "Sync Report Builder" button can
-- both try to start a run; this index makes the second insert fail (23505),
-- which lib/report-builder/runner.ts treats as "already in progress". It is
-- the lock that keeps overlapping invocations from starting duplicate runs.
-- No column changes: report_runs keeps its schema.

-- Close out runs the old inline-polling runner left behind, the same way the
-- new reaper does, so the index can be built. Production had five 'ingesting'
-- runs from Jul–Aug 2026 (function killed mid-ingest, partial metrics) and an
-- expired 'polling' run. Consumers never read them (not 'completed').
UPDATE report_runs
SET status = 'failed', error_reason = 'ingest_interrupted: ingestion did not finish', completed_at = NOW()
WHERE status = 'ingesting' AND last_polled_at < NOW() - INTERVAL '10 minutes';

UPDATE report_runs
SET status = 'failed', error_reason = 'session_expired', completed_at = NOW()
WHERE status = 'polling' AND session_expires_at < NOW();

UPDATE report_runs
SET status = 'failed', error_reason = 'trigger_interrupted: the run never received a request_id', completed_at = NOW()
WHERE status = 'pending' AND started_at < NOW() - INTERVAL '5 minutes';

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_runs_single_active
  ON report_runs ((true))
  WHERE status IN ('pending', 'polling', 'ingesting');
