-- Timestamp migration: Slack delivery ledger for Wins notes.
--
-- Isolated from the numeric 075/076 Wins family so it does not fight the
-- RF-INTEL timestamp ledger. Additive only: a new append-oriented table plus
-- one extra win_events type. Existing Assembly-review event types stay valid.

-- ==========================================================
-- 1. Widen win_events so slack_posted can be recorded
--
-- Keep every original type. Dropping any of them would reject historical
-- Assembly-review rows (copied / assembly_opened / marked_shared).
-- ==========================================================
ALTER TABLE win_events DROP CONSTRAINT IF EXISTS win_events_event_type_check;
ALTER TABLE win_events ADD CONSTRAINT win_events_event_type_check
  CHECK (event_type IN (
    'viewed',
    'message_generated',
    'message_edited',
    'copied',
    'assembly_opened',
    'marked_shared',
    'dismissed',
    'reopened',
    'slack_posted'
  ));

-- ==========================================================
-- 2. Delivery rows — one sent post per candidate × channel
-- ==========================================================
CREATE TABLE win_slack_deliveries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID NOT NULL REFERENCES win_candidates(id) ON DELETE CASCADE,
  channel_id    TEXT NOT NULL,
  slack_ts      TEXT,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  skip_reason   TEXT,
  payload_hash  TEXT NOT NULL,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT win_slack_deliveries_status_shape CHECK (
    (status = 'sent' AND slack_ts IS NOT NULL AND skip_reason IS NULL AND sent_at IS NOT NULL)
    OR (status = 'skipped' AND skip_reason IS NOT NULL AND slack_ts IS NULL)
    OR (status = 'failed' AND skip_reason IS NOT NULL)
  )
);

-- Re-runs no-op when a sent row already exists for that candidate + channel.
CREATE UNIQUE INDEX win_slack_deliveries_sent_once
  ON win_slack_deliveries (candidate_id, channel_id)
  WHERE status = 'sent';

-- Stranger test: channel_id + slack_ts + win_candidates.id reconstructs.
CREATE INDEX idx_win_slack_deliveries_stranger
  ON win_slack_deliveries (channel_id, slack_ts, candidate_id)
  WHERE slack_ts IS NOT NULL;

CREATE INDEX idx_win_slack_deliveries_candidate
  ON win_slack_deliveries (candidate_id, created_at DESC);

-- ==========================================================
-- 3. RLS — permission-based, never USING (true)
--
-- Append-only: SELECT + INSERT. No UPDATE/DELETE policy, so Postgres
-- denies those by default. A sent row is the audit of an outbound post.
-- ==========================================================
ALTER TABLE win_slack_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view win_slack_deliveries"
  ON win_slack_deliveries FOR SELECT TO authenticated
  USING (public.has_permission('wins', 'view'));

CREATE POLICY "Authorized users can insert win_slack_deliveries"
  ON win_slack_deliveries FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('wins', 'edit'));
