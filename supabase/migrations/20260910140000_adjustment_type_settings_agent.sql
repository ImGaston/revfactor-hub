-- Adjustment type visibility for the `agent` origin (see
-- 20260910130000_adjustments_agent_origin.sql).
--
-- Third creator group on adjustment_type_settings: which types an AI agent
-- may file. Fail-closed by default (FALSE, and a type without a row reads as
-- disabled for agents in code — unlike internal/hostpricing, which default
-- to visible). Seeded to match what agents already file today
-- (RF-AUTO-002 / Seasons apply-now → pricing_flexibility).
-- UI/agent-side filter only — the server keeps accepting any valid type.

ALTER TABLE adjustment_type_settings
  ADD COLUMN agent_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE adjustment_type_settings
  SET agent_enabled = TRUE
  WHERE type = 'pricing_flexibility';
