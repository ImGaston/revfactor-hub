-- Digest v2 for the client's ask: written from the whole client thread
-- (merged tickets included) with the client's listings as context. The new
-- sections (comps the client sent, likely properties, gaps to close, a
-- mixed-properties flag, link facts) live in one JSONB column. Additive.

ALTER TABLE support_ticket_ask_plain
  ADD COLUMN details JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 20000);
