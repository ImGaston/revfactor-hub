-- Support answers: blind-first answering with a Hub suggested answer, a Jev
-- review, and a consolidated final answer. Drafted 2026-10-04, reworked
-- 2026-10-05 for Fede's flow — not applied to any project.
--
-- The flow on /support/[id]:
--   1. The team writes its own answer first. The suggested answer (Hub or
--      bot draft) is never sent to the browser until this answer is saved.
--   2. The first save unlocks the suggestion; the team reviews its answer
--      against it (Jev answer check + Jev comparison).
--   3. The team saves a final answer to send in Assembly. The Hub never sends.
--
--   * support_ticket_answers      one row per ticket: the blind first answer
--                                 (immutable), the suggestion as it was at
--                                 unlock, the answer as edited in review, and
--                                 the final answer with its draft-usage metric
--   * support_suggested_answers   ledger of Hub-generated drafts (the current
--                                 draft stays in support_tickets.suggested_reply,
--                                 contract v1.3/v1.6, with `source: "hub"`)
--   * support_answer_checks       append-only Jev checks of the team answer
--                                 (`team`) or the final answer (`final`)
--   * support_answer_comparisons  append-only Jev comparisons of the team
--                                 answer with the suggestion, plus the
--                                 "what the suggestion adds" list
--   * support_ticket_events       + answer_saved, suggestion_unlocked,
--                                 answer_finalized ('answer_checked' already
--                                 exists and records Hub checks)
--
-- Permissions reuse the `support` resource: reading needs support:view,
-- writing needs support:edit. No new action. Automatic drafts (capture API
-- `after()`, the CRON_SECRET backfill) are service-role writes with no creator.
-- Nothing here touches support_tickets, so the capture bot's `updated_since`
-- sync never sees answer work.

-- ==========================================================
-- 1. Timeline event types (superset of production's list)
-- ==========================================================
ALTER TABLE support_ticket_events DROP CONSTRAINT support_ticket_events_event_type_check;
ALTER TABLE support_ticket_events ADD CONSTRAINT support_ticket_events_event_type_check
  CHECK (event_type IN (
    'created', 'triaged', 'edited', 'assigned', 'handoff', 'status_changed', 'note',
    'client_message', 'client_acknowledged', 'client_rejected', 'client_told_live',
    'team_reply', 'team_asked_client', 'internal_note_from_chat',
    'answer_recorded', 'answer_checked', 'answer_saved', 'suggestion_unlocked', 'answer_finalized',
    'commitment_made', 'commitment_kept', 'commitment_cancelled', 'commitment_rescheduled',
    'adjustment_linked', 'property_validated', 'possible_duplicate', 'merged',
    'verified', 'verification_failed', 'reopened', 'dismissed'
  ));

-- ==========================================================
-- 2. The team's answer, from blind first draft to final
-- ==========================================================
CREATE TABLE support_ticket_answers (
  ticket_id UUID PRIMARY KEY REFERENCES support_tickets(id) ON DELETE CASCADE,

  -- Step 1: written before the suggestion was visible. Never changes; it is
  -- the baseline for blind-first and draft-usage metrics.
  first_body TEXT NOT NULL CHECK (char_length(btrim(first_body)) BETWEEN 1 AND 4000),
  first_saved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  first_saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The suggestion as it was when the first save unlocked it:
  -- { text, source, generation_id, generated_at }; NULL = none was ready.
  -- Set once (at unlock, or the first time one appears afterwards).
  suggestion_at_unlock JSONB CHECK (
    suggestion_at_unlock IS NULL
    OR (jsonb_typeof(suggestion_at_unlock) = 'object' AND suggestion_at_unlock ? 'text')
  ),

  -- Step 2: the team's answer as edited during review
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Step 3: the answer to send in Assembly. Credentials are rejected and
  -- emails/phones masked by the server action before any text is saved.
  final_body TEXT CHECK (final_body IS NULL OR char_length(btrim(final_body)) BETWEEN 1 AND 4000),
  -- What the owner started the final from: their answer, the suggestion, an
  -- AI merge, or their own edit of one of those
  final_source TEXT CHECK (final_source IN ('mine', 'suggested', 'merged', 'edited')),
  final_saved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  final_saved_at TIMESTAMPTZ,
  -- The suggestion as shown when the final was saved (what usage is measured against)
  suggestion_at_final JSONB CHECK (
    suggestion_at_final IS NULL
    OR (jsonb_typeof(suggestion_at_final) = 'object' AND suggestion_at_final ? 'text')
  ),
  -- Draft usage: share of the suggestion's new word pairs (vs the blind first
  -- answer) that reached the final; bucketed none < 0.15 <= partly < 0.60 <= mostly
  suggestion_adoption NUMERIC(4, 3) CHECK (suggestion_adoption IS NULL OR suggestion_adoption BETWEEN 0 AND 1),
  used_suggestion TEXT CHECK (used_suggestion IN ('none', 'partly', 'mostly')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT support_ticket_answers_final_shape CHECK (
    (final_body IS NULL) = (final_saved_at IS NULL)
    AND (final_body IS NULL) = (used_suggestion IS NULL)
    AND (final_body IS NULL) = (final_source IS NULL)
  )
);

-- Freeze the blind answer and the unlock snapshot; stamp who/when for the
-- final from the session, never from the client payload.
CREATE OR REPLACE FUNCTION public.support_ticket_answer_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.first_saved_at := NOW();
    NEW.updated_at := NOW();
    IF NEW.final_body IS NOT NULL THEN
      RAISE EXCEPTION 'Save the team''s own answer before a final answer'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.first_body IS DISTINCT FROM OLD.first_body
     OR NEW.first_saved_by IS DISTINCT FROM OLD.first_saved_by
     OR NEW.first_saved_at IS DISTINCT FROM OLD.first_saved_at THEN
    RAISE EXCEPTION 'The first (blind) answer cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.suggestion_at_unlock IS NOT NULL
     AND NEW.suggestion_at_unlock IS DISTINCT FROM OLD.suggestion_at_unlock THEN
    RAISE EXCEPTION 'The suggestion snapshot at unlock cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := NOW();
  IF NEW.final_body IS DISTINCT FROM OLD.final_body
     OR NEW.final_source IS DISTINCT FROM OLD.final_source
     OR NEW.suggestion_at_final IS DISTINCT FROM OLD.suggestion_at_final THEN
    NEW.final_saved_at := CASE WHEN NEW.final_body IS NULL THEN NULL ELSE NOW() END;
    NEW.final_saved_by := CASE WHEN NEW.final_body IS NULL THEN NULL ELSE COALESCE(auth.uid(), NEW.final_saved_by) END;
  ELSE
    NEW.final_saved_at := OLD.final_saved_at;
    NEW.final_saved_by := OLD.final_saved_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.support_ticket_answer_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER support_ticket_answers_guard
  BEFORE INSERT OR UPDATE ON support_ticket_answers
  FOR EACH ROW EXECUTE FUNCTION public.support_ticket_answer_guard();

ALTER TABLE support_ticket_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_ticket_answers"
  ON support_ticket_answers FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
-- The first save is always the signed-in user's own answer
CREATE POLICY "Authorized users can insert support_ticket_answers"
  ON support_ticket_answers FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('support', 'edit')
    AND first_saved_by = auth.uid()
    AND updated_by = auth.uid()
  );
CREATE POLICY "Authorized users can update support_ticket_answers"
  ON support_ticket_answers FOR UPDATE TO authenticated
  USING (public.has_permission('support', 'edit'))
  WITH CHECK (public.has_permission('support', 'edit') AND updated_by = auth.uid());
-- No DELETE policy: answers are replaced, never removed.

-- ==========================================================
-- 3. Hub-generated suggested answers (ledger)
-- ==========================================================
CREATE TABLE support_suggested_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- auto = right after capture; backfill = the catch-up route; manual = the
  -- Prepare/Regenerate button
  origin TEXT NOT NULL CHECK (origin IN ('auto', 'backfill', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  body TEXT CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 4000),
  -- What the draft was given and what it cited: [{ id, kind, label, href, cited }]
  sources JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
  -- Gated Jev result for the confidence badge:
  -- { status, level, score, checks, model, model_version, transport, question_set }
  confidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(confidence) = 'object'),
  -- The full Jev response, for audit (NULL when Jev is not configured or failed)
  jev_response JSONB CHECK (jev_response IS NULL OR jev_response ? 'answers'),
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  prompt_version TEXT NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 60),
  -- TRUE when this draft was written to support_tickets.suggested_reply. An
  -- automatic draft never replaces a bot draft, so it may stay FALSE.
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT CHECK (error_message IS NULL OR char_length(error_message) <= 1000),
  input_tokens INT CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INT CHECK (output_tokens IS NULL OR output_tokens >= 0),
  generation_ms INT CHECK (generation_ms IS NULL OR generation_ms >= 0),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT support_suggested_answers_completed_shape CHECK (
    status <> 'completed' OR (body IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT support_suggested_answers_manual_creator CHECK (
    origin <> 'manual' OR created_by IS NOT NULL
  )
);

-- At most one automatic draft per ticket, ever: the capture hook and the
-- backfill race on this index instead of on application state.
CREATE UNIQUE INDEX uq_support_suggested_answers_automatic
  ON support_suggested_answers(ticket_id) WHERE origin IN ('auto', 'backfill');
CREATE INDEX idx_support_suggested_answers_ticket
  ON support_suggested_answers(ticket_id, created_at DESC);

CREATE TRIGGER trg_support_suggested_answers_set_updated_at
  BEFORE UPDATE ON support_suggested_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE support_suggested_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_suggested_answers"
  ON support_suggested_answers FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
-- People only create manual drafts, as themselves; automatic rows are
-- service-role writes.
CREATE POLICY "Authorized users can insert support_suggested_answers"
  ON support_suggested_answers FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('support', 'edit')
    AND origin = 'manual'
    AND created_by = auth.uid()
  );
-- Completing (or failing) your own manual draft
CREATE POLICY "Authorized users can update support_suggested_answers"
  ON support_suggested_answers FOR UPDATE TO authenticated
  USING (public.has_permission('support', 'edit') AND created_by = auth.uid())
  WITH CHECK (
    public.has_permission('support', 'edit')
    AND origin = 'manual'
    AND created_by = auth.uid()
  );
-- No DELETE policy: the ledger is the audit trail.

-- ==========================================================
-- 4. Jev answer checks (append-only)
-- ==========================================================
CREATE TABLE support_answer_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- team = the team's answer in review; final = the final answer
  target TEXT NOT NULL CHECK (target IN ('team', 'final')),
  -- The answer exactly as checked (masked), so a later edit can't rewrite history
  answer_snapshot TEXT NOT NULL CHECK (char_length(answer_snapshot) BETWEEN 1 AND 4000),
  -- [{ key, label, outcome: ok|problem|unsure|skipped, detail, confidence, source }]
  results JSONB NOT NULL CHECK (jsonb_typeof(results) = 'array'),
  -- pass = every check clears the bar; fix = a confident miss;
  -- needs_human = a mid-band or missing answer, never treated as a decision
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fix', 'needs_human')),
  -- typesafe-ai/jev via AI Gateway (unpinned) or jev-1.13.0 direct
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  model_version TEXT CHECK (model_version IS NULL OR char_length(model_version) <= 100),
  transport TEXT NOT NULL CHECK (transport IN ('gateway', 'typesafe')),
  question_set TEXT NOT NULL CHECK (char_length(question_set) BETWEEN 1 AND 60),
  -- The redacted state Jev was given and its full response, for audit
  request_state JSONB NOT NULL CHECK (jsonb_typeof(request_state) = 'object'),
  jev_response JSONB NOT NULL CHECK (jsonb_typeof(jev_response) = 'object' AND jev_response ? 'answers'),
  knowledge_sources JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(knowledge_sources) = 'array'),
  duration_ms INT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_answer_checks_ticket
  ON support_answer_checks(ticket_id, target, created_at DESC);

ALTER TABLE support_answer_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_answer_checks"
  ON support_answer_checks FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
CREATE POLICY "Authorized users can insert support_answer_checks"
  ON support_answer_checks FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('support', 'edit') AND created_by = auth.uid());
-- No UPDATE/DELETE policies: checks are append-only.

-- ==========================================================
-- 5. Jev comparisons with the suggestion (append-only)
-- ==========================================================
CREATE TABLE support_answer_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  team_answer_snapshot TEXT NOT NULL CHECK (char_length(team_answer_snapshot) BETWEEN 1 AND 4000),
  -- The suggestion compared against: { text, source, generation_id, generated_at }
  suggestion_snapshot JSONB NOT NULL CHECK (
    jsonb_typeof(suggestion_snapshot) = 'object' AND suggestion_snapshot ? 'text'
  ),
  -- Jev rows: suggestion_covers_missing_point (boolean), facts_conflict (choice)
  jev_status TEXT NOT NULL CHECK (jev_status IN ('ok', 'not_configured', 'failed')),
  results JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(results) = 'array'),
  -- covered = nothing to take; review = worth a look; needs_human = mid-band
  verdict TEXT CHECK (verdict IN ('covered', 'review', 'needs_human')),
  model TEXT CHECK (model IS NULL OR char_length(model) BETWEEN 1 AND 100),
  model_version TEXT CHECK (model_version IS NULL OR char_length(model_version) <= 100),
  transport TEXT CHECK (transport IN ('gateway', 'typesafe')),
  question_set TEXT NOT NULL CHECK (char_length(question_set) BETWEEN 1 AND 60),
  request_state JSONB NOT NULL CHECK (jsonb_typeof(request_state) = 'object'),
  jev_response JSONB CHECK (jev_response IS NULL OR jev_response ? 'answers'),
  -- "What the suggestion adds" (AI Gateway): [{ point, quote }], each quote
  -- verified word for word against the suggestion; at most three
  adds JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(adds) = 'array' AND jsonb_array_length(adds) <= 3),
  adds_status TEXT NOT NULL CHECK (adds_status IN ('ok', 'not_configured', 'failed')),
  adds_model TEXT CHECK (adds_model IS NULL OR char_length(adds_model) BETWEEN 1 AND 100),
  error_message TEXT CHECK (error_message IS NULL OR char_length(error_message) <= 1000),
  duration_ms INT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_answer_comparisons_jev_shape CHECK (
    (jev_status = 'ok') = (verdict IS NOT NULL AND jev_response IS NOT NULL AND transport IS NOT NULL)
  )
);

CREATE INDEX idx_support_answer_comparisons_ticket
  ON support_answer_comparisons(ticket_id, created_at DESC);

ALTER TABLE support_answer_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_answer_comparisons"
  ON support_answer_comparisons FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
CREATE POLICY "Authorized users can insert support_answer_comparisons"
  ON support_answer_comparisons FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('support', 'edit') AND created_by = auth.uid());
-- No UPDATE/DELETE policies: comparisons are append-only.
