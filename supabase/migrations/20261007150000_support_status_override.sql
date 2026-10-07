-- Support tickets: super-admin status changes and "resolved outside the Hub".
--
-- Some asks get handled on a call, by email, or by a fix nobody logged. A
-- super admin (today: Fede and Gastón) can now set a ticket's status directly
-- with a required note, including resolving it outside the Hub, which skips
-- the verification checklist. Everything lands on the timeline.

-- 1. The guard: same body as migration 20261001120000 plus the outside-the-Hub
--    branch (super admin + note), checked before the normal resolve gate.
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
  END IF;

  -- Resolved outside the Hub (a call, an email, a fix nobody logged): a super
  -- admin closes it with a note, and the checklist below does not apply.
  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved'
     AND COALESCE((NEW.verification->>'outside_hub')::boolean, FALSE) THEN
    IF public.get_my_role() IS DISTINCT FROM 'super_admin' THEN
      RAISE EXCEPTION 'Only a super admin can resolve a ticket outside the Hub'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF char_length(COALESCE(btrim(NEW.verification->>'note'), '')) < 3 THEN
      RAISE EXCEPTION 'Add a note on how it was resolved outside the Hub'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.resolved_at := COALESCE(NEW.resolved_at, NOW());
  ELSIF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
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

-- 2. One transaction for a status change: open promises are cancelled with the
--    note when the ticket closes, the ticket moves, and the timeline records it.
--    SECURITY INVOKER: row-level security (support:edit) still applies, and the
--    super-admin check is explicit.
CREATE OR REPLACE FUNCTION public.set_support_ticket_status(
  p_ticket UUID,
  p_status TEXT,
  p_note TEXT,
  p_dismiss_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ticket support_tickets%ROWTYPE;
  v_note TEXT := btrim(COALESCE(p_note, ''));
  v_closing BOOLEAN := p_status IN ('resolved', 'dismissed');
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only a super admin can change a ticket''s status directly'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status NOT IN ('open', 'in_progress', 'awaiting_client', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Pick open, in progress, waiting on client, resolved, or dismissed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(v_note) < 3 OR char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Add a note (3 to 1,000 characters)' USING ERRCODE = 'check_violation';
  END IF;
  IF p_status = 'dismissed' AND p_dismiss_reason IS NULL THEN
    RAISE EXCEPTION 'Pick a reason for dismissing' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_ticket FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_ticket.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'This ticket was merged; change the ticket it was merged into'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_ticket.status = p_status THEN
    RAISE EXCEPTION 'The ticket is already in that status; add a note instead'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_closing THEN
    WITH cancelled AS (
      UPDATE support_ticket_commitments SET
        status = 'cancelled',
        closed_at = NOW(),
        closed_by = auth.uid(),
        close_note = left('Closed outside the Hub: ' || v_note, 1000)
      WHERE ticket_id = p_ticket AND status = 'open'
      RETURNING id
    )
    INSERT INTO support_ticket_events (ticket_id, event_type, actor_id, body, payload)
    SELECT p_ticket, 'commitment_cancelled', auth.uid(), 'Closed with the ticket',
      jsonb_build_object('commitment_id', id, 'with_status_change', TRUE)
    FROM cancelled;
  END IF;

  IF p_status = 'resolved' THEN
    UPDATE support_tickets SET
      status = 'resolved',
      verified_by = auth.uid(),
      verification = jsonb_build_object('outside_hub', TRUE, 'note', v_note, 'resolved_at', NOW())
    WHERE id = p_ticket;
  ELSIF p_status = 'dismissed' THEN
    UPDATE support_tickets SET
      status = 'dismissed',
      dismiss_reason = p_dismiss_reason,
      dismiss_note = v_note
    WHERE id = p_ticket;
  ELSE
    UPDATE support_tickets SET status = p_status WHERE id = p_ticket;
  END IF;

  INSERT INTO support_ticket_events (ticket_id, event_type, actor_id, body, payload)
  VALUES (p_ticket, 'status_changed', auth.uid(), v_note, jsonb_strip_nulls(jsonb_build_object(
    'from', v_ticket.status,
    'to', p_status,
    'outside_hub', CASE WHEN p_status = 'resolved' THEN TRUE END,
    'dismiss_reason', CASE WHEN p_status = 'dismissed' THEN p_dismiss_reason END
  )));

  RETURN p_ticket;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_support_ticket_status(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_support_ticket_status(UUID, TEXT, TEXT, TEXT) TO authenticated;
