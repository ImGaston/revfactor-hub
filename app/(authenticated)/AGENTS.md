# Agent Routing — Authenticated Routes

This scoped file is intentionally a pointer. Keep the detailed performance rules in the shared memory layer so all agents read the same source of truth.

Before changing authenticated list/detail routes, read:

- `../../docs/agent/performance.md` — query trimming, lazy dialog data, loading skeletons, caching decisions, indexes, verification.
- `../../docs/agent/conventions.md` — server/client split, permissions, Supabase, UI rules.
- `../../docs/agent/project-map.md` — route and data model map.
