-- Support tickets: check-ins (contract v1.5).
--
-- A check-in is outreach we start ourselves (e.g., an at-risk client), planned
-- with a date. The bot creates it from a team message or call note with the
-- outreach as a promise; the team's message to the client keeps that promise;
-- the ticket is done once the client's reply is logged.

ALTER TABLE support_tickets DROP CONSTRAINT support_tickets_request_type_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_request_type_check
  CHECK (request_type IN ('question', 'change', 'decision', 'issue', 'check_in'));

ALTER TABLE support_routing_rules DROP CONSTRAINT support_routing_rules_request_type_check;
ALTER TABLE support_routing_rules ADD CONSTRAINT support_routing_rules_request_type_check
  CHECK (request_type IN ('question', 'change', 'decision', 'issue', 'check_in'));

-- Resolve gate: a check-in also needs the client's reply after our outreach.
-- Same body as migration 20260930200000 plus the check_in block.
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

  IF (to_jsonb(NEW) - 'suggested_reply' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'suggested_reply' - 'updated_at') THEN
    NEW.updated_at := NOW();
  END IF;

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
    IF NEW.request_type = 'check_in'
       AND (NEW.first_response_at IS NULL
            OR GREATEST(NEW.last_client_message_at, NEW.client_acknowledged_at) IS NULL
            OR GREATEST(NEW.last_client_message_at, NEW.client_acknowledged_at) < NEW.first_response_at) THEN
      RAISE EXCEPTION 'Reach out, then log the client''s reply to the check-in before resolving'
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
