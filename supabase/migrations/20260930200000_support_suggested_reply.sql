-- Support tickets: the capture bot's suggested reply (contract v1.3).
--
-- One draft per ticket, overwritten by each new draft. A person always edits
-- and sends it in Assembly; the bot never messages clients. Written only by
-- the capture-bot API (service role, `support:write` key); shown on /support.
--
-- Shape (validated by the API, bounded here as a backstop):
--   { text, basis[], skill, prompt_version, generated_at }

ALTER TABLE support_tickets
  ADD COLUMN suggested_reply JSONB
    CONSTRAINT support_tickets_suggested_reply_shape CHECK (
      suggested_reply IS NULL
      -- COALESCE: a missing key yields NULL, which a CHECK would let through
      OR COALESCE(
        jsonb_typeof(suggested_reply) = 'object'
        AND jsonb_typeof(suggested_reply->'text') = 'string'
        AND char_length(suggested_reply->>'text') BETWEEN 1 AND 4000
        AND jsonb_typeof(suggested_reply->'generated_at') = 'string'
        AND pg_column_size(suggested_reply) <= 16384,
        FALSE
      )
    );

COMMENT ON COLUMN support_tickets.suggested_reply IS
  'Capture-bot draft reply (text, basis, skill, prompt_version, generated_at). Draft only: a person edits and sends it. Overwritten by each new draft.';

-- The guard stamps updated_at on every update. A draft is not a change to the
-- ticket, and the bot syncs on updated_at, so stamping it would make every
-- draft look like ticket activity (and could loop the bot into re-drafting).
-- Same body as migration 20260929160000 except the updated_at line.
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
