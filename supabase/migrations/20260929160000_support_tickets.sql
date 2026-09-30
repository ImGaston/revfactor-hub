-- Migration 20260929160000: Support tickets — the first layer for every client ask.
--
-- Every client question or request becomes a support ticket first. Only some
-- tickets spawn an Adjustment (the PriceLabs change queue) as a second step.
-- The September 2026 30-day chat audit showed first replies are fast; what
-- fails is follow-through: promises with no loop back, answers about the wrong
-- property or question, and changes never confirmed back to the client.
--
--   * support_tickets             one row per client ask (not per chat thread)
--   * support_ticket_listings     the validated properties the ask is about
--   * support_ticket_commitments  "we'll review / follow up" promises with due
--                                 dates; open ones block resolution
--   * support_ticket_events       append-only timeline (bot + human)
--   * support_capture_messages    ledger of chat messages the capture bot has
--                                 processed — each message is split exactly once
--   * support_routing_rules       default owner by category / request type
--   * adjustments.support_ticket_id  the ticket an Adjustment was spawned from
--   * clients.churn_risk / clients.support_capture
--
-- Closure is two-step like Adjustments: someone records the answer
-- (`answered`), then a `support:control` holder verifies it before it is
-- `resolved`. The resolve gate is enforced here as well as in the server
-- action, because the capture bot writes through the service role.
--
-- Revised 2026-09-29 after the capture-bot design review
-- (docs/support/grok-review-decisions.md): processed-message ledger and ask
-- fingerprints instead of ask indexes, duplicate/merge fields, dismissal
-- reason codes, verifier override reason, "told live" instead of "confirmed",
-- promise reschedules that keep the original due date, nudges vs chases,
-- rule-derived priority, backfill markers.
--
-- Tickets are internal only. Nothing here is exposed to owners or on /a/.

-- ==========================================================
-- 1. Permission resource `support`
-- ==========================================================
-- INSERT ... SELECT FROM roles so a role deleted in the UI never fails the
-- migration on the role_permissions FK. DO UPDATE because createRole() seeds
-- every resource x action as FALSE, and DO NOTHING would keep those.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'support', a.action, TRUE
FROM roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('control')) AS a(action)
WHERE r.name = 'super_admin'
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- admin works the queue and verifies answers. Delete stays off: dismiss keeps
-- the audit trail; turn it on per role in Settings -> Roles if needed.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'support', a.action, a.allowed
FROM roles r
CROSS JOIN (VALUES
  ('view', TRUE), ('create', TRUE), ('edit', TRUE), ('control', TRUE),
  ('delete', FALSE), ('publish', FALSE)
) AS a(action, allowed)
WHERE r.name = 'admin'
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- External roles never see client support conversations.
INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'support', a.action, FALSE
FROM roles r
CROSS JOIN (VALUES ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')) AS a(action)
WHERE r.name IN ('contractor', 'marketing', 'hostpricing')
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- ==========================================================
-- 2. Client-level support settings
-- ==========================================================
-- Churn risk is a property of the client relationship, not of one ticket.
-- Set by people (or a later scorer); feeds the ticket priority rules.
ALTER TABLE clients
  ADD COLUMN churn_risk TEXT CHECK (churn_risk IN ('low', 'medium', 'high'));

-- FALSE = the capture bot skips this client's chat entirely. People can
-- still create tickets for them manually.
ALTER TABLE clients
  ADD COLUMN support_capture BOOLEAN NOT NULL DEFAULT TRUE;

-- Desk accounts handled personally: still captured and logged, but their
-- tickets are marked hand-managed and nothing automatic changes their status,
-- priority, or owner. Set per client after deployment.
ALTER TABLE clients
  ADD COLUMN support_hand_managed BOOLEAN NOT NULL DEFAULT FALSE;

-- Nicknames clients use for a listing ("the Cabin", "Creek Backyard"). The
-- capture matcher checks them after exact names; triage fills them in when a
-- person resolves an unmatched name.
ALTER TABLE listings
  ADD COLUMN aliases TEXT[] NOT NULL DEFAULT '{}';

-- ==========================================================
-- 3. Capture ledger (service-role writes only)
-- ==========================================================
CREATE TABLE support_capture_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('assembly', 'email', 'whatsapp', 'call')),
  source_message_id TEXT NOT NULL CHECK (char_length(source_message_id) BETWEEN 1 AND 200),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL CHECK (author_role IN ('client', 'team', 'internal')),
  message_at TIMESTAMPTZ NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('captured', 'no_ask', 'skipped_client_excluded')),
  model TEXT,
  prompt_version TEXT,
  ask_count INT NOT NULL DEFAULT 0 CHECK (ask_count >= 0),
  event_count INT NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  reprocess_count INT NOT NULL DEFAULT 0 CHECK (reprocess_count >= 0),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reprocessed_at TIMESTAMPTZ,
  UNIQUE (source, source_message_id)
);

CREATE INDEX idx_support_capture_messages_client ON support_capture_messages(client_id, message_at DESC);

ALTER TABLE support_capture_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_capture_messages"
  ON support_capture_messages FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
-- No write policies: only the capture API (service role) records messages.

-- ==========================================================
-- 4. Tickets
-- ==========================================================
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human reference ("#128") for chat and WhatsApp; never reused
  ticket_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- What the ask is about. `unknown` = not validated yet (triage);
  -- `listings` = the rows in support_ticket_listings; `portfolio` = every
  -- listing; `account` = not property-specific (billing, access, offboarding).
  property_scope TEXT NOT NULL DEFAULT 'unknown'
    CHECK (property_scope IN ('unknown', 'listings', 'portfolio', 'account')),
  property_validated_at TIMESTAMPTZ,
  -- NULL with a timestamp = validated deterministically by the ingest matcher
  property_validated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Category drives routing, default owner, and the Adjustment suggestion.
  -- Request type drives what "done" means.
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN (
      'pricing', 'stay_rules', 'availability', 'listing_setup', 'performance',
      'reporting', 'billing', 'onboarding', 'offboarding', 'other'
    )),
  -- question = a specific answer; change = applied and told live; decision =
  -- an explicit yes/no or recommendation; issue = fixed, checked, explained.
  request_type TEXT NOT NULL DEFAULT 'question'
    CHECK (request_type IN ('question', 'change', 'decision', 'issue')),

  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 3 AND 300),
  -- Redacted excerpt of the ask; source_message_id links to the full text
  client_message TEXT CHECK (client_message IS NULL OR char_length(client_message) <= 2000),
  requested_by_name TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Normalized period the ask is about, e.g. `2027-07` or `2026-10-12/2026-10-14`
  time_window TEXT CHECK (time_window IS NULL OR char_length(time_window) <= 40),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('assembly', 'email', 'whatsapp', 'call', 'manual')),
  source_message_id TEXT,
  capture_message_id UUID REFERENCES support_capture_messages(id) ON DELETE SET NULL,
  -- Server-derived from request type + category + property set + time window,
  -- so a re-run that words the summary differently still matches.
  ask_fingerprint TEXT CHECK (ask_fingerprint IS NULL OR char_length(ask_fingerprint) BETWEEN 6 AND 64),
  -- Idempotency key: `<source>:<messageId>:<ask_fingerprint>` for captured
  -- tickets, NULL for manual ones
  external_key TEXT UNIQUE CHECK (external_key IS NULL OR char_length(external_key) BETWEEN 3 AND 300),
  -- The ask is in a screenshot/attachment the bot could not read
  needs_attachment_review BOOLEAN NOT NULL DEFAULT FALSE,

  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'open', 'in_progress', 'awaiting_client', 'answered', 'resolved', 'dismissed')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  -- `rule` = recomputed from sentiment, churn risk, chases, and money at
  -- stake; `manual` = a person pinned it
  priority_source TEXT NOT NULL DEFAULT 'rule' CHECK (priority_source IN ('rule', 'manual')),
  client_sentiment TEXT NOT NULL DEFAULT 'neutral'
    CHECK (client_sentiment IN ('neutral', 'concerned', 'unhappy')),
  -- Billing/offboarding ask with money involved (charge after termination, refund)
  money_at_stake BOOLEAN NOT NULL DEFAULT FALSE,
  -- Copied from the client at capture: automatic status/priority/owner
  -- changes are off for this ticket
  hand_managed BOOLEAN NOT NULL DEFAULT FALSE,
  assignee_id UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Possible duplicate flagged at capture; a person merges or clears it
  possible_duplicate_of UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  merged_into UUID REFERENCES support_tickets(id) ON DELETE SET NULL,

  -- Conversation clocks (clock hours, like the audit). "Waiting on us" is
  -- derived from these, never stored as a flag.
  first_response_at TIMESTAMPTZ,
  last_client_message_at TIMESTAMPTZ,
  last_team_message_at TIMESTAMPTZ,
  -- The reply clock never starts before this (backfilled tickets)
  sla_anchor_at TIMESTAMPTZ,
  -- Chase = a client message while we already owed the next move.
  -- Nudge = a polite "any update?" before anything was due; the second nudge
  -- on a ticket also counts as a chase.
  client_chase_count INT NOT NULL DEFAULT 0 CHECK (client_chase_count >= 0),
  client_nudge_count INT NOT NULL DEFAULT 0 CHECK (client_nudge_count >= 0),

  -- The answer under verification
  answer_summary TEXT CHECK (answer_summary IS NULL OR char_length(answer_summary) <= 4000),
  answered_at TIMESTAMPTZ,
  answered_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Capture-bot check of the latest team reply against the ask. Asked/replied
  -- are short quotes so a person can judge the flag in seconds.
  answer_check_verdict TEXT CHECK (answer_check_verdict IN ('pass', 'fail', 'uncertain')),
  answer_check_asked TEXT CHECK (answer_check_asked IS NULL OR char_length(answer_check_asked) <= 500),
  answer_check_replied TEXT CHECK (answer_check_replied IS NULL OR char_length(answer_check_replied) <= 500),
  answer_check_gap TEXT CHECK (answer_check_gap IS NULL OR char_length(answer_check_gap) <= 500),
  answer_check_at TIMESTAMPTZ,
  -- The client was told the change is live (required for change tickets)
  client_told_live_at TIMESTAMPTZ,
  -- The client thanked or confirmed the answer (evidence, never required)
  client_acknowledged_at TIMESTAMPTZ,

  -- Verification snapshot frozen at resolve time: the checklist plus
  -- `override_reason` when the answer check was not `pass`
  verification JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(verification) = 'object'),
  verified_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  dismiss_reason TEXT CHECK (dismiss_reason IN (
    'not_an_ask', 'duplicate', 'client_self_resolved', 'no_longer_needed', 'handled_offline'
  )),
  dismiss_note TEXT CHECK (dismiss_note IS NULL OR char_length(dismiss_note) <= 1000),

  -- Imported from the 2026-09-28 open-item recheck (or a later sweep). Kept
  -- out of SLA and promise metrics until resolved; reported as backlog.
  backfilled BOOLEAN NOT NULL DEFAULT FALSE,
  backfill_batch TEXT,

  -- Display-only capture metadata: model, prompt version, per-field
  -- confidence, rationale
  ai_classification JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ai_classification) = 'object'),

  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT support_tickets_dismiss_shape CHECK (
    (status = 'dismissed') = (dismiss_reason IS NOT NULL)
  ),
  CONSTRAINT support_tickets_dismiss_note CHECK (
    dismiss_reason IS NULL
    OR dismiss_reason NOT IN ('handled_offline', 'duplicate')
    OR (dismiss_note IS NOT NULL AND char_length(dismiss_note) > 0)
  ),
  CONSTRAINT support_tickets_merge_shape CHECK (
    merged_into IS NULL OR (status = 'dismissed' AND dismiss_reason = 'duplicate')
  ),
  CONSTRAINT support_tickets_no_self_reference CHECK (
    possible_duplicate_of IS DISTINCT FROM id AND merged_into IS DISTINCT FROM id
  ),
  CONSTRAINT support_tickets_backfill_shape CHECK (backfilled = (backfill_batch IS NOT NULL))
);

CREATE INDEX idx_support_tickets_status ON support_tickets(status);
CREATE INDEX idx_support_tickets_client ON support_tickets(client_id, requested_at DESC);
CREATE INDEX idx_support_tickets_fingerprint ON support_tickets(client_id, ask_fingerprint)
  WHERE ask_fingerprint IS NOT NULL;
CREATE INDEX idx_support_tickets_assignee ON support_tickets(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_support_tickets_merged_into ON support_tickets(merged_into) WHERE merged_into IS NOT NULL;
-- API cursor (`updated_since`) for the capture bot and the daily digest
CREATE INDEX idx_support_tickets_updated ON support_tickets(updated_at, id);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_tickets"
  ON support_tickets FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
CREATE POLICY "Authorized users can insert support_tickets"
  ON support_tickets FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('support', 'create'));
CREATE POLICY "Authorized users can update support_tickets"
  ON support_tickets FOR UPDATE TO authenticated
  USING (public.has_permission('support', 'edit'))
  WITH CHECK (public.has_permission('support', 'edit'));
CREATE POLICY "Authorized users can delete support_tickets"
  ON support_tickets FOR DELETE TO authenticated
  USING (public.has_permission('support', 'delete'));

-- ==========================================================
-- 5. Validated properties
-- ==========================================================
CREATE TABLE support_ticket_listings (
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_id, listing_id)
);

CREATE INDEX idx_support_ticket_listings_listing ON support_ticket_listings(listing_id);

ALTER TABLE support_ticket_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_ticket_listings"
  ON support_ticket_listings FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
-- create OR edit: a ticket's properties are written in the same action that
-- creates it
CREATE POLICY "Authorized users can insert support_ticket_listings"
  ON support_ticket_listings FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('support', 'create') OR public.has_permission('support', 'edit'));
CREATE POLICY "Authorized users can delete support_ticket_listings"
  ON support_ticket_listings FOR DELETE TO authenticated
  USING (public.has_permission('support', 'edit'));

-- ==========================================================
-- 6. Commitments ("we'll review", "by Monday")
-- ==========================================================
CREATE TABLE support_ticket_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 3 AND 500),
  -- The ORIGINAL due date. A reschedule never moves it, so lateness is always
  -- measured against the first promise.
  due_at TIMESTAMPTZ NOT NULL,
  -- explicit = a date/time was stated; relative = "tomorrow", "by Monday"
  -- resolved in America/New_York; default_vague = "we'll review" (+24h);
  -- default_concrete = a named deliverable with no date (+48h); manual = Hub
  due_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (due_source IN ('explicit', 'relative', 'default_vague', 'default_concrete', 'manual')),
  -- The working due date after a reschedule (next-due uses this)
  rescheduled_to TIMESTAMPTZ,
  -- Late is derived (closed_at > due_at, or open past due_at), never stored
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept', 'cancelled')),
  -- Who promised, as seen in the chat; may not be a Hub user
  made_by_name TEXT,
  made_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('bot', 'manual')),
  external_key TEXT UNIQUE CHECK (external_key IS NULL OR char_length(external_key) BETWEEN 3 AND 300),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  close_note TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_ticket_commitments_closed_shape CHECK ((status = 'open') = (closed_at IS NULL)),
  CONSTRAINT support_ticket_commitments_cancel_note CHECK (
    status <> 'cancelled' OR (close_note IS NOT NULL AND char_length(close_note) > 0)
  )
);

CREATE INDEX idx_support_ticket_commitments_ticket ON support_ticket_commitments(ticket_id);
CREATE INDEX idx_support_ticket_commitments_open_due
  ON support_ticket_commitments((COALESCE(rescheduled_to, due_at))) WHERE status = 'open';

ALTER TABLE support_ticket_commitments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_ticket_commitments"
  ON support_ticket_commitments FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
CREATE POLICY "Authorized users can insert support_ticket_commitments"
  ON support_ticket_commitments FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('support', 'create') OR public.has_permission('support', 'edit'));
CREATE POLICY "Authorized users can update support_ticket_commitments"
  ON support_ticket_commitments FOR UPDATE TO authenticated
  USING (public.has_permission('support', 'edit'))
  WITH CHECK (public.has_permission('support', 'edit'));
-- No DELETE policy: cancel with a note instead, so promise history survives.

-- ==========================================================
-- 7. Timeline (append-only)
-- ==========================================================
CREATE TABLE support_ticket_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'triaged', 'edited', 'assigned', 'handoff', 'status_changed', 'note',
    'client_message', 'client_acknowledged', 'client_rejected', 'client_told_live',
    'team_reply', 'team_asked_client', 'internal_note_from_chat',
    'answer_recorded', 'answer_checked',
    'commitment_made', 'commitment_kept', 'commitment_cancelled', 'commitment_rescheduled',
    'adjustment_linked', 'property_validated', 'possible_duplicate', 'merged',
    'verified', 'verification_failed', 'reopened', 'dismissed'
  )),
  -- Hub user, or NULL for capture-bot events (see actor_label)
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_label TEXT CHECK (actor_label IS NULL OR char_length(actor_label) <= 120),
  body TEXT CHECK (body IS NULL OR char_length(body) <= 4000),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  capture_message_id UUID REFERENCES support_capture_messages(id) ON DELETE SET NULL,
  -- Capture-bot idempotency key (usually `<source>:<messageId>:<type>`)
  external_key TEXT UNIQUE CHECK (external_key IS NULL OR char_length(external_key) BETWEEN 3 AND 300),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_support_ticket_events_ticket ON support_ticket_events(ticket_id, occurred_at);
CREATE INDEX idx_support_ticket_events_type_time ON support_ticket_events(event_type, occurred_at);

ALTER TABLE support_ticket_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_ticket_events"
  ON support_ticket_events FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view'));
CREATE POLICY "Authorized users can insert support_ticket_events"
  ON support_ticket_events FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND (public.has_permission('support', 'create') OR public.has_permission('support', 'edit'))
  );
-- No UPDATE/DELETE policies: the timeline is append-only. A merge leaves the
-- source ticket's events where they are; the target's timeline also reads the
-- tickets merged into it.

-- ==========================================================
-- 8. Default owner routing
-- ==========================================================
-- First matching rule by rank wins; NULL category/request_type = any. Rows
-- reference Hub profiles, so they are configured in the app, not seeded here.
CREATE TABLE support_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT CHECK (category IN (
    'pricing', 'stay_rules', 'availability', 'listing_setup', 'performance',
    'reporting', 'billing', 'onboarding', 'offboarding', 'other'
  )),
  request_type TEXT CHECK (request_type IN ('question', 'change', 'decision', 'issue')),
  assignee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rank INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULLS NOT DISTINCT: one catch-all row, not one per re-seed
  UNIQUE NULLS NOT DISTINCT (category, request_type)
);

ALTER TABLE support_routing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized users can view support_routing_rules"
  ON support_routing_rules FOR SELECT TO authenticated
  USING (public.has_permission('support', 'view') OR public.has_permission('settings', 'edit'));
CREATE POLICY "Authorized users can insert support_routing_rules"
  ON support_routing_rules FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('settings', 'edit'));
CREATE POLICY "Authorized users can update support_routing_rules"
  ON support_routing_rules FOR UPDATE TO authenticated
  USING (public.has_permission('settings', 'edit'))
  WITH CHECK (public.has_permission('settings', 'edit'));
CREATE POLICY "Authorized users can delete support_routing_rules"
  ON support_routing_rules FOR DELETE TO authenticated
  USING (public.has_permission('settings', 'edit'));

-- ==========================================================
-- 9. Adjustments spawned from a ticket
-- ==========================================================
ALTER TABLE adjustments
  ADD COLUMN support_ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL;

CREATE INDEX idx_adjustments_support_ticket
  ON adjustments(support_ticket_id) WHERE support_ticket_id IS NOT NULL;

-- ==========================================================
-- 10. Invariant guards
-- ==========================================================
-- SECURITY DEFINER so the checks see every commitment/adjustment/listing even
-- when the writer's RLS would hide some (a support user without
-- adjustments:view must not pass the gate by not seeing an open Adjustment).
-- They only read; the fixed search_path prevents object shadowing.

-- 10a. Ticket lifecycle: stamp updated_at, enforce the resolve gate, keep the
-- client consistent with its properties and Adjustments.
CREATE OR REPLACE FUNCTION public.support_ticket_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'resolved' THEN
      RAISE EXCEPTION 'A support ticket cannot be created resolved; answer and verify it first'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  NEW.updated_at := NOW();

  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    IF EXISTS (
      SELECT 1 FROM support_ticket_listings stl
      JOIN listings l ON l.id = stl.listing_id
      WHERE stl.ticket_id = NEW.id AND l.client_id IS DISTINCT FROM NEW.client_id
    ) THEN
      RAISE EXCEPTION 'Remove this ticket''s properties before moving it to another client'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM adjustments a
      WHERE a.support_ticket_id = NEW.id AND a.client_id IS DISTINCT FROM NEW.client_id
    ) THEN
      RAISE EXCEPTION 'This ticket has Adjustments for its current client; unlink them first'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
    IF NEW.verified_by IS NULL THEN
      RAISE EXCEPTION 'Resolving a support ticket requires a verifier'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.property_validated_at IS NULL OR NEW.property_scope = 'unknown' THEN
      RAISE EXCEPTION 'Validate which property the ask is about before resolving'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.answered_at IS NULL THEN
      RAISE EXCEPTION 'Record the answer given to the client before resolving'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.answer_check_verdict IN ('fail', 'uncertain')
       AND char_length(COALESCE(btrim(NEW.verification->>'override_reason'), '')) < 5 THEN
      RAISE EXCEPTION 'The answer check flagged this reply; explain why it is still correct'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM support_ticket_commitments c
      WHERE c.ticket_id = NEW.id AND c.status = 'open'
    ) THEN
      RAISE EXCEPTION 'Close or cancel every open promise before resolving'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.request_type = 'change' THEN
      IF EXISTS (
        SELECT 1 FROM adjustments a
        WHERE a.support_ticket_id = NEW.id
          AND a.status NOT IN ('controlled', 'rejected')
      ) THEN
        RAISE EXCEPTION 'Every linked Adjustment must be controlled or rejected before resolving'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.client_told_live_at IS NULL THEN
        RAISE EXCEPTION 'Tell the client the change is live before resolving'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.resolved_at := COALESCE(NEW.resolved_at, NOW());
  ELSIF NEW.status IS DISTINCT FROM 'resolved' AND OLD.status = 'resolved' THEN
    -- Reopened: the old verification no longer describes the ticket. The
    -- `verified` event keeps the historical snapshot.
    NEW.resolved_at := NULL;
    NEW.verified_by := NULL;
    NEW.verification := '{}'::jsonb;
  END IF;

  IF NEW.status IS DISTINCT FROM 'dismissed' AND OLD.status = 'dismissed' THEN
    -- Undismissed: clear the reason so the dismiss constraint holds.
    IF NEW.merged_into IS NOT NULL THEN
      RAISE EXCEPTION 'A merged ticket cannot be reopened; work the ticket it was merged into'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.dismiss_reason := NULL;
    NEW.dismiss_note := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.support_ticket_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER support_tickets_guard
  BEFORE INSERT OR UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.support_ticket_guard();

-- 10b. A ticket's property must belong to the ticket's client — the data-level
-- half of "answered about the wrong property".
CREATE OR REPLACE FUNCTION public.support_ticket_listing_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM support_tickets t
    JOIN listings l ON l.client_id = t.client_id
    WHERE t.id = NEW.ticket_id AND l.id = NEW.listing_id
  ) THEN
    RAISE EXCEPTION 'That listing does not belong to this ticket''s client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.support_ticket_listing_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER support_ticket_listings_guard
  BEFORE INSERT OR UPDATE ON support_ticket_listings
  FOR EACH ROW EXECUTE FUNCTION public.support_ticket_listing_guard();

-- 10c. An Adjustment can only be linked to a ticket of the same client.
CREATE OR REPLACE FUNCTION public.adjustment_support_ticket_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.support_ticket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM support_tickets t
    WHERE t.id = NEW.support_ticket_id AND t.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'An Adjustment can only be linked to a support ticket of the same client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjustment_support_ticket_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER adjustments_support_ticket_guard
  BEFORE INSERT OR UPDATE OF support_ticket_id, client_id ON adjustments
  FOR EACH ROW EXECUTE FUNCTION public.adjustment_support_ticket_guard();

-- 10d. Promises: the original due date is immutable once set, so a reschedule
-- can never hide lateness.
CREATE OR REPLACE FUNCTION public.support_commitment_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    RAISE EXCEPTION 'A promise''s original due date cannot change; reschedule it instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.support_commitment_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER support_ticket_commitments_guard
  BEFORE UPDATE ON support_ticket_commitments
  FOR EACH ROW EXECUTE FUNCTION public.support_commitment_guard();

-- ==========================================================
-- 11. Merge a duplicate into the ticket that stays
-- ==========================================================
-- One transaction: promises, properties, and Adjustments move to the target;
-- the target keeps the earliest ask and the higher chase/nudge counts; the
-- source is dismissed as a duplicate pointing at the target. Events stay on
-- the source (the timeline is append-only) and the target's timeline reads
-- them through merged_into.
--
-- SECURITY DEFINER because moving promises spans rows the caller may only
-- partly see, so the permission check is explicit — and written IS NOT TRUE,
-- because has_permission() is NULL for a session without a profile.
CREATE OR REPLACE FUNCTION public.merge_support_ticket(p_source UUID, p_target UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source support_tickets%ROWTYPE;
  v_target support_tickets%ROWTYPE;
BEGIN
  IF public.has_permission('support', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'Not allowed to merge support tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_source = p_target THEN
    RAISE EXCEPTION 'A ticket cannot be merged into itself' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock in id order so two concurrent merges cannot deadlock
  PERFORM 1 FROM support_tickets WHERE id IN (p_source, p_target) ORDER BY id FOR UPDATE;
  SELECT * INTO v_source FROM support_tickets WHERE id = p_source;
  SELECT * INTO v_target FROM support_tickets WHERE id = p_target;

  IF v_source.id IS NULL OR v_target.id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_source.client_id <> v_target.client_id THEN
    RAISE EXCEPTION 'Only tickets of the same client can be merged' USING ERRCODE = 'check_violation';
  END IF;
  IF v_source.status IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Ticket #% is already closed', v_source.ticket_number USING ERRCODE = 'check_violation';
  END IF;
  IF v_target.status = 'dismissed' THEN
    RAISE EXCEPTION 'Ticket #% is dismissed; merge into an active ticket', v_target.ticket_number
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE support_ticket_commitments SET ticket_id = p_target WHERE ticket_id = p_source;

  INSERT INTO support_ticket_listings (ticket_id, listing_id)
  SELECT p_target, listing_id FROM support_ticket_listings WHERE ticket_id = p_source
  ON CONFLICT DO NOTHING;

  UPDATE adjustments SET support_ticket_id = p_target WHERE support_ticket_id = p_source;

  UPDATE support_tickets SET
    requested_at = LEAST(v_target.requested_at, v_source.requested_at),
    client_chase_count = GREATEST(v_target.client_chase_count, v_source.client_chase_count),
    client_nudge_count = GREATEST(v_target.client_nudge_count, v_source.client_nudge_count),
    last_client_message_at = GREATEST(v_target.last_client_message_at, v_source.last_client_message_at),
    last_team_message_at = GREATEST(v_target.last_team_message_at, v_source.last_team_message_at),
    first_response_at = LEAST(v_target.first_response_at, v_source.first_response_at),
    property_scope = CASE WHEN v_target.property_scope = 'unknown' AND v_source.property_validated_at IS NOT NULL
                          THEN v_source.property_scope ELSE v_target.property_scope END,
    property_validated_at = COALESCE(v_target.property_validated_at, v_source.property_validated_at),
    possible_duplicate_of = NULLIF(v_target.possible_duplicate_of, p_source),
    -- A resolved target that absorbed open work is no longer done
    status = CASE WHEN v_target.status = 'resolved'
                   AND EXISTS (SELECT 1 FROM support_ticket_commitments c WHERE c.ticket_id = p_target AND c.status = 'open')
                  THEN 'open' ELSE v_target.status END
  WHERE id = p_target;

  UPDATE support_tickets SET
    status = 'dismissed',
    dismiss_reason = 'duplicate',
    dismiss_note = 'Merged into #' || v_target.ticket_number,
    merged_into = p_target,
    possible_duplicate_of = NULL
  WHERE id = p_source;

  INSERT INTO support_ticket_events (ticket_id, event_type, actor_id, body, payload) VALUES
    (p_target, 'merged', auth.uid(), 'Merged #' || v_source.ticket_number || ' into this ticket',
      jsonb_build_object('source_ticket_id', p_source, 'source_ticket_number', v_source.ticket_number)),
    (p_source, 'merged', auth.uid(), 'Merged into #' || v_target.ticket_number,
      jsonb_build_object('target_ticket_id', p_target, 'target_ticket_number', v_target.ticket_number));

  RETURN p_target;
END;
$$;

-- Merging is a human decision; the capture bot only flags possible_duplicate_of.
REVOKE EXECUTE ON FUNCTION public.merge_support_ticket(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_support_ticket(UUID, UUID) TO authenticated;

-- ==========================================================
-- 12. Apply one capture atomically (capture API only)
-- ==========================================================
-- The capture planner (lib/support-capture.ts) validates the bot payload,
-- matches properties, applies the queue rules, and derives every
-- idempotency key; this function writes the whole plan in one transaction.
-- Every insert is ON CONFLICT DO NOTHING on its key, and an event's ticket
-- patch / promise change runs only when the event row is new, so replaying
-- a message can never double-count a chase or re-open a promise.
--
-- `ledger` is NULL when an item in the message errored: the message is then
-- not marked processed, and the bot fixes the item and resends the same
-- payload. SECURITY INVOKER and executable by service_role only — the
-- capture route calls it through the admin client after API-key auth.
CREATE OR REPLACE FUNCTION public.apply_support_capture(p_plan JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ledger JSONB := p_plan->'ledger';
  v_capture_id UUID;
  v_ticket JSONB;
  v_row JSONB;
  v_ticket_id UUID;
  v_ticket_number BIGINT;
  v_ticket_status TEXT;
  v_created BOOLEAN;
  v_event JSONB;
  v_event_id UUID;
  v_patch JSONB;
  v_commitment JSONB;
  v_ticket_results JSONB := '[]'::jsonb;
  v_event_results JSONB := '[]'::jsonb;
BEGIN
  IF v_ledger IS NOT NULL AND jsonb_typeof(v_ledger) = 'object' THEN
    INSERT INTO support_capture_messages (
      source, source_message_id, client_id, author_role, message_at, outcome,
      model, prompt_version, ask_count, event_count
    ) VALUES (
      v_ledger->>'source', v_ledger->>'source_message_id', (v_ledger->>'client_id')::uuid,
      v_ledger->>'author_role', (v_ledger->>'message_at')::timestamptz, v_ledger->>'outcome',
      v_ledger->>'model', v_ledger->>'prompt_version',
      COALESCE((v_ledger->>'ask_count')::int, 0), COALESCE((v_ledger->>'event_count')::int, 0)
    )
    ON CONFLICT (source, source_message_id) DO NOTHING
    RETURNING id INTO v_capture_id;

    IF v_capture_id IS NULL THEN
      IF COALESCE((v_ledger->>'reprocess')::boolean, FALSE) THEN
        UPDATE support_capture_messages SET
          reprocess_count = reprocess_count + 1,
          last_reprocessed_at = NOW(),
          model = COALESCE(v_ledger->>'model', model),
          prompt_version = COALESCE(v_ledger->>'prompt_version', prompt_version)
        WHERE source = v_ledger->>'source' AND source_message_id = v_ledger->>'source_message_id'
        RETURNING id INTO v_capture_id;
      ELSE
        -- Lost a race with another delivery of the same message
        SELECT id INTO v_capture_id FROM support_capture_messages
        WHERE source = v_ledger->>'source' AND source_message_id = v_ledger->>'source_message_id';
        RETURN jsonb_build_object('skipped', TRUE, 'capture_id', v_capture_id);
      END IF;
    END IF;
  END IF;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(COALESCE(p_plan->'tickets', '[]'::jsonb)) LOOP
    v_row := v_ticket->'row';
    v_ticket_id := NULL;
    INSERT INTO support_tickets (
      client_id, property_scope, property_validated_at, category, request_type, summary,
      client_message, requested_by_name, requested_at, time_window, source, source_message_id,
      capture_message_id, ask_fingerprint, external_key, needs_attachment_review, status,
      priority, priority_source, client_sentiment, money_at_stake, hand_managed, assignee_id,
      possible_duplicate_of, last_client_message_at, sla_anchor_at, answer_summary, answered_at,
      backfilled, backfill_batch, ai_classification
    ) VALUES (
      (v_row->>'client_id')::uuid, v_row->>'property_scope', (v_row->>'property_validated_at')::timestamptz,
      v_row->>'category', v_row->>'request_type', v_row->>'summary',
      v_row->>'client_message', v_row->>'requested_by_name', (v_row->>'requested_at')::timestamptz,
      v_row->>'time_window', v_row->>'source', v_row->>'source_message_id',
      v_capture_id, v_row->>'ask_fingerprint', v_ticket->>'external_key',
      COALESCE((v_row->>'needs_attachment_review')::boolean, FALSE), v_row->>'status',
      v_row->>'priority', COALESCE(v_row->>'priority_source', 'rule'), v_row->>'client_sentiment',
      COALESCE((v_row->>'money_at_stake')::boolean, FALSE), COALESCE((v_row->>'hand_managed')::boolean, FALSE),
      (v_row->>'assignee_id')::uuid, (v_row->>'possible_duplicate_of')::uuid,
      (v_row->>'last_client_message_at')::timestamptz, (v_row->>'sla_anchor_at')::timestamptz,
      v_row->>'answer_summary', (v_row->>'answered_at')::timestamptz,
      COALESCE((v_row->>'backfilled')::boolean, FALSE), v_row->>'backfill_batch',
      COALESCE(v_row->'ai_classification', '{}'::jsonb)
    )
    ON CONFLICT (external_key) DO NOTHING
    RETURNING id, ticket_number, status INTO v_ticket_id, v_ticket_number, v_ticket_status;

    v_created := v_ticket_id IS NOT NULL;
    IF v_created THEN
      INSERT INTO support_ticket_listings (ticket_id, listing_id)
      SELECT v_ticket_id, l.value::uuid
      FROM jsonb_array_elements_text(COALESCE(v_ticket->'listing_ids', '[]'::jsonb)) AS l(value)
      ON CONFLICT DO NOTHING;

      INSERT INTO support_ticket_commitments (
        ticket_id, description, due_at, due_source, made_by_name, made_at, source, external_key
      )
      SELECT v_ticket_id, c->>'description', (c->>'due_at')::timestamptz, c->>'due_source',
        c->>'made_by_name', (c->>'made_at')::timestamptz, 'bot', c->>'external_key'
      FROM jsonb_array_elements(COALESCE(v_ticket->'commitments', '[]'::jsonb)) AS c
      ON CONFLICT (external_key) DO NOTHING;

      INSERT INTO support_ticket_events (
        ticket_id, event_type, actor_label, body, payload, capture_message_id, external_key, occurred_at
      )
      SELECT v_ticket_id, e->>'event_type', e->>'actor_label', e->>'body',
        COALESCE(e->'payload', '{}'::jsonb), v_capture_id, e->>'external_key', (e->>'occurred_at')::timestamptz
      FROM jsonb_array_elements(COALESCE(v_ticket->'events', '[]'::jsonb)) AS e
      ON CONFLICT (external_key) DO NOTHING;
    ELSE
      SELECT id, ticket_number, status INTO v_ticket_id, v_ticket_number, v_ticket_status
      FROM support_tickets WHERE external_key = v_ticket->>'external_key';
    END IF;

    v_ticket_results := v_ticket_results || jsonb_build_array(jsonb_build_object(
      'external_key', v_ticket->>'external_key', 'ticket_id', v_ticket_id,
      'ticket_number', v_ticket_number, 'status', v_ticket_status, 'created', v_created
    ));
  END LOOP;

  FOR v_event IN SELECT value FROM jsonb_array_elements(COALESCE(p_plan->'events', '[]'::jsonb)) LOOP
    v_ticket_id := (v_event->>'ticket_id')::uuid;
    v_event_id := NULL;
    INSERT INTO support_ticket_events (
      ticket_id, event_type, actor_label, body, payload, capture_message_id, external_key, occurred_at
    ) VALUES (
      v_ticket_id, v_event->>'event_type', v_event->>'actor_label', v_event->>'body',
      COALESCE(v_event->'payload', '{}'::jsonb), v_capture_id, v_event->>'external_key',
      (v_event->>'occurred_at')::timestamptz
    )
    ON CONFLICT (external_key) DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NOT NULL THEN
      v_patch := COALESCE(v_event->'patch', '{}'::jsonb);
      IF v_patch <> '{}'::jsonb THEN
        UPDATE support_tickets SET
          status = COALESCE(v_patch->>'status', status),
          last_client_message_at = GREATEST(last_client_message_at, (v_patch->>'last_client_message_at')::timestamptz),
          last_team_message_at = GREATEST(last_team_message_at, (v_patch->>'last_team_message_at')::timestamptz),
          first_response_at = COALESCE(first_response_at, (v_patch->>'first_response_at')::timestamptz),
          client_chase_count = client_chase_count + COALESCE((v_patch->>'chase_delta')::int, 0),
          client_nudge_count = client_nudge_count + COALESCE((v_patch->>'nudge_delta')::int, 0),
          answer_summary = CASE WHEN v_patch ? 'answer_summary' THEN v_patch->>'answer_summary' ELSE answer_summary END,
          answered_at = CASE WHEN v_patch ? 'answered_at' THEN (v_patch->>'answered_at')::timestamptz ELSE answered_at END,
          answer_check_verdict = CASE WHEN v_patch ? 'answer_check_verdict' THEN v_patch->>'answer_check_verdict' ELSE answer_check_verdict END,
          answer_check_asked = CASE WHEN v_patch ? 'answer_check_asked' THEN v_patch->>'answer_check_asked' ELSE answer_check_asked END,
          answer_check_replied = CASE WHEN v_patch ? 'answer_check_replied' THEN v_patch->>'answer_check_replied' ELSE answer_check_replied END,
          answer_check_gap = CASE WHEN v_patch ? 'answer_check_gap' THEN v_patch->>'answer_check_gap' ELSE answer_check_gap END,
          answer_check_at = CASE WHEN v_patch ? 'answer_check_at' THEN (v_patch->>'answer_check_at')::timestamptz ELSE answer_check_at END,
          client_told_live_at = COALESCE(client_told_live_at, (v_patch->>'client_told_live_at')::timestamptz),
          client_acknowledged_at = GREATEST(client_acknowledged_at, (v_patch->>'client_acknowledged_at')::timestamptz),
          priority = COALESCE(v_patch->>'priority', priority),
          assignee_id = CASE WHEN v_patch ? 'assignee_id' THEN (v_patch->>'assignee_id')::uuid ELSE assignee_id END
        WHERE id = v_ticket_id;
      END IF;

      v_commitment := v_event->'commitment';
      IF v_commitment IS NOT NULL AND jsonb_typeof(v_commitment) = 'object' THEN
        CASE v_commitment->>'op'
          WHEN 'insert' THEN
            INSERT INTO support_ticket_commitments (
              ticket_id, description, due_at, due_source, made_by_name, made_at, source, external_key
            ) VALUES (
              v_ticket_id, v_commitment->>'description', (v_commitment->>'due_at')::timestamptz,
              v_commitment->>'due_source', v_commitment->>'made_by_name',
              (v_commitment->>'made_at')::timestamptz, 'bot', v_commitment->>'external_key'
            )
            ON CONFLICT (external_key) DO NOTHING;
          WHEN 'keep' THEN
            UPDATE support_ticket_commitments SET status = 'kept', closed_at = (v_commitment->>'closed_at')::timestamptz
            WHERE id = (v_commitment->>'id')::uuid AND ticket_id = v_ticket_id AND status = 'open';
          WHEN 'reschedule' THEN
            UPDATE support_ticket_commitments SET rescheduled_to = (v_commitment->>'rescheduled_to')::timestamptz
            WHERE id = (v_commitment->>'id')::uuid AND ticket_id = v_ticket_id AND status = 'open';
          WHEN 'cancel' THEN
            UPDATE support_ticket_commitments SET
              status = 'cancelled',
              closed_at = (v_commitment->>'closed_at')::timestamptz,
              close_note = v_commitment->>'close_note'
            WHERE id = (v_commitment->>'id')::uuid AND ticket_id = v_ticket_id AND status = 'open';
          ELSE
            RAISE EXCEPTION 'Unknown promise operation %', v_commitment->>'op' USING ERRCODE = 'check_violation';
        END CASE;
      END IF;
    END IF;

    v_event_results := v_event_results || jsonb_build_array(jsonb_build_object(
      'external_key', v_event->>'external_key', 'applied', v_event_id IS NOT NULL
    ));
  END LOOP;

  -- A message finished after an earlier incomplete attempt: link the tickets
  -- that attempt created
  IF v_capture_id IS NOT NULL THEN
    UPDATE support_tickets SET capture_message_id = v_capture_id
    WHERE source = v_ledger->>'source' AND source_message_id = v_ledger->>'source_message_id'
      AND capture_message_id IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'skipped', FALSE, 'capture_id', v_capture_id,
    'tickets', v_ticket_results, 'events', v_event_results
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_support_capture(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_support_capture(JSONB) TO service_role;
