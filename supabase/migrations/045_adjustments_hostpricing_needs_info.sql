-- Migration 045: hostpricing role, needs_info status, recommendation type,
-- comment origin + stats view, adjustment status history
--
-- Makes the internal bottleneck visible on /adjustments:
--   * `adjustment_comments.origin` records who a comment came from (set
--     server-side from the author's role). The "needs internal reply" flag is
--     NOT stored — it is derived from the last comment's origin via the
--     `adjustment_comment_stats` view (no read-tracking tables).
--   * `needs_info` status: a resolver is blocked on information from the
--     internal team. Requires a note; an internal comment auto-returns the
--     ticket to `open` (enforced in app/(authenticated)/adjustments/actions.ts).
--   * `recommendation` type: strategic pricing suggestions (e.g. composite
--     listing setup) that need internal discussion before execution.
--   * `adjustment_status_history`: append-only audit of status transitions,
--     written by the server action. Starts empty for past transitions — old
--     tickets keep their trail via resolver/reviewer fields and note comments.
--   * `hostpricing` role: external pricing partner, adjustments-only, no
--     control (the resolved -> controlled step stays internal) and no delete.

-- ==========================================================
-- 1. Comment origin (default backfills existing rows as internal)
-- ==========================================================
ALTER TABLE adjustment_comments
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'internal'
  CHECK (origin IN ('internal', 'hostpricing', 'client'));

-- ==========================================================
-- 2. Status CHECK: + needs_info
-- ==========================================================
ALTER TABLE adjustments DROP CONSTRAINT adjustments_status_check;
ALTER TABLE adjustments ADD CONSTRAINT adjustments_status_check
  CHECK (status IN ('open', 'in_progress', 'needs_info', 'resolved', 'controlled', 'issue', 'rejected'));

-- ==========================================================
-- 3. Type CHECK: + recommendation
-- ==========================================================
ALTER TABLE adjustments DROP CONSTRAINT adjustments_type_check;
ALTER TABLE adjustments ADD CONSTRAINT adjustments_type_check
  CHECK (type IN (
    'setup', 'min_stay', 'price', 'min_price', 'max_price', 'target_payout',
    'checkin_checkout', 'discount', 'markup_fees', 'availability', 'review',
    'recommendation', 'other'
  ));

-- ==========================================================
-- 4. Status history (append-only)
-- ==========================================================
CREATE TABLE adjustment_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id UUID NOT NULL REFERENCES adjustments(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  changed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_adjustment_status_history_adjustment
  ON adjustment_status_history(adjustment_id, created_at);

ALTER TABLE adjustment_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view adjustment_status_history"
  ON adjustment_status_history FOR SELECT TO authenticated
  USING (public.has_permission('adjustments', 'view'));

CREATE POLICY "Authorized users can insert adjustment_status_history"
  ON adjustment_status_history FOR INSERT TO authenticated
  WITH CHECK (changed_by = auth.uid() AND public.has_permission('adjustments', 'edit'));

-- No UPDATE/DELETE policies: history is append-only.

-- ==========================================================
-- 5. Comment stats view (security invoker — comments RLS applies)
-- ==========================================================
-- has_unanswered_external_comment is derived in code as
-- last_comment_origin != 'internal'; nothing is stored on adjustments.
CREATE VIEW public.adjustment_comment_stats
WITH (security_invoker = true) AS
SELECT
  adjustment_id,
  COUNT(*)::int AS comment_count,
  (ARRAY_AGG(origin ORDER BY created_at DESC))[1] AS last_comment_origin,
  MAX(created_at) AS last_comment_at
FROM adjustment_comments
GROUP BY adjustment_id;

REVOKE ALL ON public.adjustment_comment_stats FROM public, anon;
GRANT SELECT ON public.adjustment_comment_stats TO authenticated, service_role;

-- ==========================================================
-- 6. hostpricing role
-- ==========================================================
INSERT INTO roles (name, description, is_system) VALUES
  ('hostpricing', 'HostPricing partner — submits pricing adjustments and recommendations', FALSE)
ON CONFLICT (name) DO NOTHING;

-- DO UPDATE, not DO NOTHING: createRole() in Settings → Roles seeds every
-- resource x action combination as FALSE. If the role was already created
-- through the UI, DO NOTHING would silently leave every permission off.
INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('hostpricing', 'adjustments', 'view', TRUE),
  ('hostpricing', 'adjustments', 'create', TRUE),
  ('hostpricing', 'adjustments', 'edit', TRUE)
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Explicitly denied: no delete, and the resolved -> controlled step stays internal.
INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('hostpricing', 'adjustments', 'delete', FALSE),
  ('hostpricing', 'adjustments', 'control', FALSE)
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;
