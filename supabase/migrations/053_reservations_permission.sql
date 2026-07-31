-- Migration 053: Reservations module permission
-- The reservations UI reads public.pricelabs_reservations_bq, a SECURITY
-- DEFINER view over pricelabs_bq.pricelabs_reservations — RLS does not apply,
-- so hasPermission('reservations','view') in the routes is the only boundary.
-- Everyone can access: seed view=TRUE for every existing role (roles are
-- dynamic rows, so select them instead of hardcoding names).

INSERT INTO role_permissions (role_name, resource, action, allowed)
SELECT r.name, 'reservations', 'view', TRUE
FROM roles r
ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;
