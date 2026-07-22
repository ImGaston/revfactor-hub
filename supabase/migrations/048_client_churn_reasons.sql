-- Churn reason capture for inactive clients.
-- Tag values live in code (CLIENT_CHURN_REASONS, lib/clients.ts) — no CHECK, matching leads.lost_reason.
-- Visibility is super_admin-only at the app layer (loaders null these for other roles, like billing_amount).
-- clients_basic is untouched: its fixed column list (id, name, status) cannot leak these.
ALTER TABLE clients
  ADD COLUMN ending_reason_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN ending_note TEXT;
