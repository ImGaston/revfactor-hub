-- Migration 041: `marketing` role (external, pipeline-only) + `pipeline:control`
--
-- Adds an external marketing collaborator role, scoped strictly to the Pipeline
-- module. Same trust posture as `contractor` (the India team): limited access,
-- no ability to reach clients, listings or financial data.
--
-- Introduces `pipeline:control` to gate the two Assembly server actions that
-- RLS cannot protect, because they act outside Postgres:
--   * createAssemblyClientForLead — creates the Assembly client (sends an invite
--     email to the prospect) and inserts into `clients` with the admin client,
--     bypassing RLS entirely.
--   * sendContractToAssembly — creates and sends a legal contract to the prospect.
-- Both are enforced in code (app/(authenticated)/pipeline/actions.ts); this
-- migration only seeds the permission. `control` already exists in the
-- role_permissions action CHECK (widened in 037) and in lib/permissions.ts.
--
-- Also seeds `contractor`, created through Settings → Roles on 2026-07-03 and
-- never captured in a migration, so the schema is reproducible from scratch.

-- ==========================================================
-- 1. marketing role
-- ==========================================================
INSERT INTO roles (name, description, is_system) VALUES
  ('marketing', 'External marketing collaborator — sales pipeline only', FALSE)
ON CONFLICT (name) DO NOTHING;

-- DO UPDATE, not DO NOTHING: createRole() in Settings → Roles seeds every
-- resource x action combination as FALSE. If the role was already created
-- through the UI, DO NOTHING would silently leave every permission off.
INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('marketing', 'pipeline', 'view', TRUE),
  ('marketing', 'pipeline', 'create', TRUE),
  ('marketing', 'pipeline', 'edit', TRUE)
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Explicitly denied: marketing neither deletes leads nor converts them into
-- clients / sends contracts.
INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('marketing', 'pipeline', 'delete', FALSE),
  ('marketing', 'pipeline', 'control', FALSE)
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- ==========================================================
-- 2. pipeline:control for existing roles
-- ==========================================================
-- admin can already run both Assembly actions today (they carry no permission
-- check at all), so this grant keeps behaviour unchanged once the gate lands.
-- super_admin needs no row: has_permission() always approves it.
INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('admin', 'pipeline', 'control', TRUE)
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- ==========================================================
-- 3. contractor role (drift: created via UI on 2026-07-03)
-- ==========================================================
-- DO NOTHING on purpose: on the live database these already exist and may have
-- been tuned through Settings → Roles; on a fresh database they are recreated.
-- No `adjustments:control` — the resolved -> controlled step stays internal.
INSERT INTO roles (name, description, is_system) VALUES
  ('contractor', 'External contractor — resolves adjustments', FALSE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('contractor', 'adjustments', 'view', TRUE),
  ('contractor', 'adjustments', 'edit', TRUE)
ON CONFLICT (role_name, resource, action) DO NOTHING;
