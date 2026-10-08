-- Martín's support sweep writes notes and status through a scoped bot key. The
-- caller owns the approval gate for closes; this service-role RPC keeps the Hub
-- write atomic, idempotent, and auditable without pretending the bot is a user.

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
    IF COALESCE((NEW.verification->>'by_bot')::boolean, FALSE)
       AND auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Only the service role can resolve a ticket as a bot'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.verified_by IS NULL
       AND NOT (
         COALESCE((NEW.verification->>'outside_hub')::boolean, FALSE)
         AND COALESCE((NEW.verification->>'by_bot')::boolean, FALSE)
         AND auth.role() = 'service_role'
       ) THEN
      RAISE EXCEPTION 'Resolving a support ticket requires a verifier'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Resolved outside the Hub (a call, an email, a fix nobody logged): a super
  -- admin or the service-role support bot closes it with a note, and the
  -- checklist below does not apply.
  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved'
     AND COALESCE((NEW.verification->>'outside_hub')::boolean, FALSE) THEN
    IF COALESCE((NEW.verification->>'by_bot')::boolean, FALSE) THEN
      IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Only the service role can resolve a ticket as a bot'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF public.get_my_role() IS DISTINCT FROM 'super_admin' THEN
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

CREATE OR REPLACE FUNCTION public.apply_support_ticket_bot_update(
  p_ticket UUID,
  p_actor_label TEXT,
  p_api_key_id UUID,
  p_note TEXT,
  p_status TEXT,
  p_dismiss_reason TEXT DEFAULT NULL,
  p_answer_summary TEXT DEFAULT NULL,
  p_external_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ticket support_tickets%ROWTYPE;
  v_existing RECORD;
  v_note TEXT := btrim(COALESCE(p_note, ''));
  v_event_id UUID;
  v_closing BOOLEAN := p_status IN ('resolved', 'dismissed');
BEGIN
  IF p_external_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_external_key, 0));
    SELECT e.id AS event_id, t.id AS ticket_id, t.ticket_number, t.status
      INTO v_existing
    FROM support_ticket_events e
    JOIN support_tickets t ON t.id = e.ticket_id
    WHERE e.external_key = p_external_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'replayed', TRUE,
        'event_id', v_existing.event_id,
        'ticket_id', v_existing.ticket_id,
        'ticket_number', v_existing.ticket_number,
        'status', v_existing.status
      );
    END IF;
  END IF;

  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_ticket FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_ticket.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'This ticket was merged; change the ticket it was merged into'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_status IS NOT NULL AND v_ticket.status = p_status THEN
    RAISE EXCEPTION 'The ticket is already in that status; add a note instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_status IS NOT NULL AND v_ticket.hand_managed THEN
    RAISE EXCEPTION 'This ticket is hand-managed; only a person can change its status'
      USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(v_note) < 3 OR char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Add a note (3 to 1,000 characters)' USING ERRCODE = 'check_violation';
  END IF;
  IF p_status IS NOT NULL
     AND p_status NOT IN ('open', 'in_progress', 'awaiting_client', 'answered', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Pick a supported status' USING ERRCODE = 'check_violation';
  END IF;
  IF p_status = 'dismissed' AND p_dismiss_reason IS NULL THEN
    RAISE EXCEPTION 'Pick a reason for dismissing' USING ERRCODE = 'check_violation';
  END IF;
  IF p_status IS DISTINCT FROM 'dismissed' AND p_dismiss_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Pick a reason only when dismissing' USING ERRCODE = 'check_violation';
  END IF;
  IF p_status IS DISTINCT FROM 'answered' AND p_answer_summary IS NOT NULL THEN
    RAISE EXCEPTION 'Add an answer summary only with answered status' USING ERRCODE = 'check_violation';
  END IF;

  IF p_status IS NULL THEN
    INSERT INTO support_ticket_events (
      ticket_id, event_type, actor_id, actor_label, body, payload, external_key
    ) VALUES (
      p_ticket, 'note', NULL, p_actor_label, v_note,
      jsonb_build_object('source', 'api', 'api_key_id', p_api_key_id), p_external_key
    ) RETURNING id INTO v_event_id;
  ELSE
    IF v_closing THEN
      WITH cancelled AS (
        UPDATE support_ticket_commitments SET
          status = 'cancelled',
          closed_at = NOW(),
          closed_by = NULL,
          close_note = left('Closed outside the Hub: ' || v_note, 1000)
        WHERE ticket_id = p_ticket AND status = 'open'
        RETURNING id
      )
      INSERT INTO support_ticket_events (
        ticket_id, event_type, actor_id, actor_label, body, payload
      )
      SELECT p_ticket, 'commitment_cancelled', NULL, p_actor_label, 'Closed with the ticket',
        jsonb_build_object('commitment_id', id, 'with_status_change', TRUE, 'source', 'api',
          'api_key_id', p_api_key_id)
      FROM cancelled;
    END IF;

    IF p_status = 'resolved' THEN
      UPDATE support_tickets SET
        status = 'resolved',
        verified_by = NULL,
        verification = jsonb_build_object(
          'outside_hub', TRUE, 'by_bot', TRUE, 'note', v_note,
          'actor_label', p_actor_label, 'resolved_at', NOW()
        )
      WHERE id = p_ticket;
    ELSIF p_status = 'dismissed' THEN
      UPDATE support_tickets SET
        status = 'dismissed', dismiss_reason = p_dismiss_reason, dismiss_note = v_note
      WHERE id = p_ticket;
    ELSIF p_status = 'answered' THEN
      UPDATE support_tickets SET
        status = 'answered', answered_at = COALESCE(answered_at, NOW()),
        answer_summary = COALESCE(p_answer_summary, answer_summary),
        -- A bot summary replaces the answer, so it is no longer a person's
        answered_by = CASE WHEN p_answer_summary IS NOT NULL THEN NULL ELSE answered_by END
      WHERE id = p_ticket;
    ELSE
      UPDATE support_tickets SET status = p_status WHERE id = p_ticket;
    END IF;

    INSERT INTO support_ticket_events (
      ticket_id, event_type, actor_id, actor_label, body, payload, external_key
    ) VALUES (
      p_ticket, 'status_changed', NULL, p_actor_label, v_note,
      jsonb_strip_nulls(jsonb_build_object(
        'from', v_ticket.status,
        'to', p_status,
        'source', 'api',
        'api_key_id', p_api_key_id,
        'outside_hub', CASE WHEN p_status = 'resolved' THEN TRUE END,
        'by_bot', TRUE,
        'dismiss_reason', CASE WHEN p_status = 'dismissed' THEN p_dismiss_reason END
      )),
      p_external_key
    ) RETURNING id INTO v_event_id;
  END IF;

  RETURN jsonb_build_object(
    'replayed', FALSE,
    'event_id', v_event_id,
    'ticket_id', v_ticket.id,
    'ticket_number', v_ticket.ticket_number,
    'status', COALESCE(p_status, v_ticket.status),
    'previous_status', v_ticket.status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_support_ticket_bot_update(
  UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_support_ticket_bot_update(
  UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
