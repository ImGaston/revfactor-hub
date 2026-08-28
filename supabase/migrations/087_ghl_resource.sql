-- The Pipeline section is removed from the Hub: the sales pipeline now lives in
-- GoHighLevel, and /ghl replaces /pipeline as the GHL↔Hub connection section.
-- Rename the permission resource so every role (incl. the external `marketing`
-- role from 041) keeps exactly the grants it had, now under `ghl`. Revenue
-- Briefs, which was gated by pipeline:view, is gated by ghl:view.
--
-- The lead tables (leads, lead_tags, …) and their RLS policies referencing
-- has_permission('pipeline', …) are intentionally left in place: data is
-- retained and the ingest webhooks / Leads Read API run with the admin client.
-- Regular roles simply lose direct row access, which matches the UI removal.

update role_permissions set resource = 'ghl' where resource = 'pipeline';
