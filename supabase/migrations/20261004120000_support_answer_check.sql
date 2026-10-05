-- Support answers: the Hub's suggested answer, the owner's answer, and the
-- AI answer check (Jev). Drafted 2026-10-04 — not applied to any project.
--
--   * support_ticket_answers     the answer the ticket owner will send in
--                                Assembly (one current answer per ticket,
--                                with who/when). The Hub never sends it.
--   * support_suggested_answers  ledger of Hub-generated drafts: text, the
--                                sources it was given, the Jev confidence
--                                result, and the full Jev response. The
--                                current draft is still shown from
--                                support_tickets.suggested_reply (contract
--                                v1.3) with `source: "hub"`.
--   * support_answer_checks      append-only Jev checks of the owner's answer:
--                                answer snapshot, per-question results,
--                                overall verdict, model, full response.
--   * support_ticket_events      + 'answer_saved' on the timeline (the
--                                existing, unused 'answer_checked' records
--                                Hub checks).
--
-- Permissions reuse the `support` resource: reading needs support:view,
-- writing needs support:edit. No new action. Automatic drafts (capture API
-- `after()` and the backfill route) are written by the service role after
-- API-key or CRON_SECRET auth, so their rows have no creator.
--
-- Writing the owner's answer or a draft never touches support_tickets
-- columns other than suggested_reply, which the guard already ignores for
-- updated_at, so the capture bot's `updated_since` sync does not see them.

-- ==========================================================
-- 1. Timeline: 'answer_saved'
-- ==========================================================
ALTER TABLE support_ticket_events DROP CONSTRAINT support_ticket_events_event_type_check;
ALTER TABLE support_ticket_events ADD CONSTRAINT support_ticket_events_event_type_check
  CHECK (event_type IN (
    'created', 'triaged', 'edited', 'assigned', 'handoff', 'status_changed', 'note',
    'client_message', 'client_acknowledged', 'client_rejected', 'client_told_live',
    'team_reply', 'team_asked_client', 'internal_note_from_chat',
    'answer_recorded', 'answer_checked', 'answer_saved',
    'commitment_made', 'commitment_kept', 'commitment_cancelled', 'commitment_rescheduled',
    'adjustment_linked', 'property_validated', 'possible_duplicate', 'merged',
    'verified', 'verification_failed', 'reopened', 'dismissed'
  ));

-- ==========================================================
-- 2. The owner's answer
-- ==========================================================
CREATE TABLE support_ticket_answers (
  ticket_id UUID PRIMARY KEY REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- What the owner will paste into Assembly. Credentials are rejected and
  -- emails/phones masked by the server action before saving.
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_support_ticket_answers_set_updated_at
  BEFORE UPDATE ON support_ticket_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE support_ticket_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_ticket_answers"
  ON support_ticket_answers FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
-- The writer is always the signed-in user, so who/when can't be forged
CREATE POLICY "Authorized users can insert support_ticket_answers"
  ON support_ticket_answers FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('support', 'edit') AND updated_by = auth.uid());
CREATE POLICY "Authorized users can update support_ticket_answers"
  ON support_ticket_answers FOR UPDATE TO authenticated
  USING (public.has_permission('support', 'edit'))
  WITH CHECK (public.has_permission('support', 'edit') AND updated_by = auth.uid());
-- No DELETE policy: an answer is replaced, never removed. Checks keep the
-- snapshots of earlier versions.

-- ==========================================================
-- 3. Hub-generated suggested answers (ledger)
-- ==========================================================
CREATE TABLE support_suggested_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- auto = right after capture; backfill = the catch-up route; manual = the
  -- Generate/Regenerate button
  origin TEXT NOT NULL CHECK (origin IN ('auto', 'backfill', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  body TEXT CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 4000),
  -- What the draft was given and what it cited: [{ id, kind, label, href, cited }]
  sources JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
  -- Gated Jev result for the confidence badge: { status, level, score, checks, model, question_set }
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
-- 4. AI answer checks (append-only)
-- ==========================================================
CREATE TABLE support_answer_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  -- The answer exactly as checked (masked), so a later edit can't rewrite history
  answer_snapshot TEXT NOT NULL CHECK (char_length(answer_snapshot) BETWEEN 1 AND 4000),
  -- [{ key, label, outcome: ok|problem|unsure|skipped, detail, confidence, source }]
  results JSONB NOT NULL CHECK (jsonb_typeof(results) = 'array'),
  -- pass = every check clears the bar; fix = a confident miss;
  -- needs_human = a mid-band answer, which is never treated as a decision
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fix', 'needs_human')),
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
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
  ON support_answer_checks(ticket_id, created_at DESC);

ALTER TABLE support_answer_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_answer_checks"
  ON support_answer_checks FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
CREATE POLICY "Authorized users can insert support_answer_checks"
  ON support_answer_checks FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('support', 'edit') AND created_by = auth.uid());
-- No UPDATE/DELETE policies: checks are append-only.
