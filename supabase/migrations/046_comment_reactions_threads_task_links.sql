-- Migration 046: emoji reactions, internal reply-threads, and task links
-- for adjustment_comments and task_comments (hover action bar feature).
--
--   * Reactions: one row per (comment, user, emoji) — Slack-style, a user can
--     add several different emojis. Free-text emoji, no CHECK: the picker is
--     curated in the UI and rows are only ever rendered as text.
--   * Threads: `parent_id` self-reference, one level deep (UI only offers
--     replying to top-level comments). On adjustment_comments every reply is
--     an INTERNAL thread: SELECT/INSERT of rows with a parent require
--     `adjustments:control`, the permission that already separates internal
--     staff from contractor/hostpricing. task_comments need no extra gate —
--     no external role has any `tasks` permission.
--   * `linked_task_id`: set when "Create task" is used on a comment, so the
--     comment can show a chip pointing at the task it spawned.
--   * `adjustment_comment_stats` now counts only top-level comments: internal
--     replies must not flip the needs-reply flag (their audience can't even
--     see them) nor inflate the row comment count.

-- ==========================================================
-- 1. Threads + task links
-- ==========================================================
ALTER TABLE adjustment_comments
  ADD COLUMN parent_id UUID REFERENCES adjustment_comments(id) ON DELETE CASCADE,
  ADD COLUMN linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX idx_adjustment_comments_parent
  ON adjustment_comments(parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE task_comments
  ADD COLUMN parent_id UUID REFERENCES task_comments(id) ON DELETE CASCADE,
  ADD COLUMN linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX idx_task_comments_parent
  ON task_comments(parent_id) WHERE parent_id IS NOT NULL;

-- ==========================================================
-- 2. Internal-thread gate on adjustment_comments
-- ==========================================================
DROP POLICY "Authorized users can view adjustment_comments" ON adjustment_comments;
CREATE POLICY "Authorized users can view adjustment_comments"
  ON adjustment_comments FOR SELECT TO authenticated
  USING (
    public.has_permission('adjustments', 'view')
    AND (parent_id IS NULL OR public.has_permission('adjustments', 'control'))
  );

DROP POLICY "Authorized users can insert adjustment_comments" ON adjustment_comments;
CREATE POLICY "Authorized users can insert adjustment_comments"
  ON adjustment_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.has_permission('adjustments', 'view')
    AND (parent_id IS NULL OR public.has_permission('adjustments', 'control'))
  );

-- ==========================================================
-- 3. Reaction tables
-- ==========================================================
CREATE TABLE adjustment_comment_reactions (
  comment_id UUID NOT NULL REFERENCES adjustment_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id, emoji)
);

ALTER TABLE adjustment_comment_reactions ENABLE ROW LEVEL SECURITY;

-- Reaction rows carry only (comment uuid, emoji); gating SELECT on the parent
-- comment's visibility isn't worth a per-row subquery at this scale.
CREATE POLICY "Authorized users can view adjustment_comment_reactions"
  ON adjustment_comment_reactions FOR SELECT TO authenticated
  USING (public.has_permission('adjustments', 'view'));
CREATE POLICY "Authorized users can insert adjustment_comment_reactions"
  ON adjustment_comment_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.has_permission('adjustments', 'view'));
CREATE POLICY "Users can delete own adjustment_comment_reactions"
  ON adjustment_comment_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE task_comment_reactions (
  comment_id UUID NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id, emoji)
);

ALTER TABLE task_comment_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view task_comment_reactions"
  ON task_comment_reactions FOR SELECT TO authenticated
  USING (public.has_permission('tasks', 'view'));
CREATE POLICY "Authorized users can insert task_comment_reactions"
  ON task_comment_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.has_permission('tasks', 'view'));
CREATE POLICY "Users can delete own task_comment_reactions"
  ON task_comment_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ==========================================================
-- 4. Stats view: top-level comments only
-- ==========================================================
CREATE OR REPLACE VIEW public.adjustment_comment_stats
WITH (security_invoker = true) AS
SELECT
  adjustment_id,
  COUNT(*)::int AS comment_count,
  (ARRAY_AGG(origin ORDER BY created_at DESC))[1] AS last_comment_origin,
  MAX(created_at) AS last_comment_at
FROM adjustment_comments
WHERE parent_id IS NULL
GROUP BY adjustment_id;
