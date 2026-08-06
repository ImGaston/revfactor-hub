-- 072: Backfill role_permissions so every role has a row for every
-- resource × action combination, and drop rows for removed resources.
--
-- Why: togglePermission/bulkToggleResource used UPDATE, which silently
-- no-ops when the row is missing. Roles created before newer resources
-- (agent_studio, reservations, team_credentials) or newer actions
-- (publish, control) were added had gaps, so their checkboxes in
-- /settings/roles appeared to do nothing.

-- Resources removed from the app (Calendar and Notes stub sections)
delete from role_permissions where resource in ('calendar', 'notes');

-- Backfill missing combinations. super_admin gets allowed=true for
-- consistency (server checks short-circuit it to true anyway);
-- everything else defaults to false.
insert into role_permissions (role_name, resource, action, allowed)
select r.name, res.resource, act.action, (r.name = 'super_admin')
from roles r
cross join (values
  ('clients'), ('listings'), ('tasks'), ('pipeline'), ('roadmap'),
  ('onboarding'), ('users'), ('settings'), ('financials'), ('knowledge'),
  ('adjustments'), ('agent_studio'), ('reservations'), ('team_credentials')
) as res(resource)
cross join (values
  ('view'), ('create'), ('edit'), ('delete'), ('publish'), ('control')
) as act(action)
on conflict (role_name, resource, action) do nothing;
