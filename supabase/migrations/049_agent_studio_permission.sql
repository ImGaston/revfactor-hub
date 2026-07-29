-- Migration 049: Agent Studio module permission
--
-- The first Agent Studio release is an internal, read-only sandbox. It can
-- query only data the signed-in user can already read through RLS and it has no
-- Assembly send or application mutation tool.
--
-- super_admin needs no row because has_permission() always approves it.

INSERT INTO role_permissions (role_name, resource, action, allowed) VALUES
  ('admin', 'agent_studio', 'view', TRUE)
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;
