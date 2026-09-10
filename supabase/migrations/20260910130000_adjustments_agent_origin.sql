-- Adjustments: add 'agent' origin for tickets filed by an AI agent
-- (e.g. Agent Studio / automated market-signal recommendations).
-- Same visibility rules as the other origins: never exposed on the
-- public /a/<token> shell. No backfill — existing rows keep their origin.

ALTER TABLE adjustments DROP CONSTRAINT IF EXISTS adjustments_origin_check;
ALTER TABLE adjustments ADD CONSTRAINT adjustments_origin_check
  CHECK (origin IN ('client', 'internal', 'hostpricing', 'agent'));
