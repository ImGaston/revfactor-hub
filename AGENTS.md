# Agent Routing — RevFactor Hub

This file is intentionally short and synchronized across agent entrypoints. It routes agents to durable project memory in `docs/agent/` instead of duplicating the full architecture in every startup context.

## Project Snapshot
- Internal operations hub for RevFactor, a short-term rental revenue management consultancy.
- Built for 2-3 internal users in Phase 1; not client-facing.
- Production URL: `hub.revfactor.io`.
- Stack: Next.js 16 App Router, React 19, shadcn/ui, Tailwind CSS v4, Supabase, Vercel, pnpm.
- Important app area: `app/(authenticated)/` holds the authenticated dashboard, clients, listings, tasks, roadmap, pipeline, onboarding, financials, settings, calendar, notes, and knowledge routes.

## Memory Map
Read the smallest relevant docs before changing code:

- `docs/agent/project-map.md` — routes, modules, database tables, storage, views, scripts, domain terms.
- `docs/agent/conventions.md` — coding, UI, Supabase, server/client split, auth, permissions, environment, local Claude hook template.
- `docs/agent/integrations.md` — Assembly, PriceLabs, Stripe, Pacing Chart, landing-page webhook.
- `docs/agent/performance.md` — authenticated route performance rules, loading skeletons, caching decisions, indexes, verification.
- `docs/agent/decisions.md` — dated durable decisions and rationale.
- `docs/agent/sessions.md` — short rolling summaries of substantive agent/doc work.
- Existing deep references: `docs/data-flow-audit.md`, `docs/performance-baseline.md`, `docs/webhook-pipeline-integration.md`.

## Critical Rules
- Use TypeScript strict mode and `@/` imports from the project root.
- Use Supabase clients only: server client in Server Components, browser client in Client Components, admin client only for privileged server-side operations.
- Keep `next/headers` imports in server-only files such as `.server.ts`; client components must import only client-safe modules.
- Use Server Actions (`"use server"`) for data mutations; handle Supabase errors and surface user feedback with Sonner where applicable.
- Use shadcn/ui components and lucide-react icons for UI; destructive actions require `AlertDialog`.
- Financial data (`billing_amount`, `autopayment_set_up`, `stripe_dashboard`, `/financials`) is `super_admin` only in server checks and UI props.
- Settings visibility is permission-based, not hardcoded by role, except explicit `super_admin` financial gating.
- Listings forms use numeric Airbnb IDs and a unified PriceLabs / Listing ID field that sets both `listing_id` and `pricelabs_link`.
- Kanban UX uses `@hello-pangea/dnd`, optimistic UI, tinted columns, colored left card accents, click-to-move menus, and optional archive/complete sections.
- Do not add page-level ISR (`export const revalidate = N`) to authenticated routes; see `docs/agent/performance.md`.
- Do not put secrets, tokens, personal profile memory, or private user preferences in repo docs.

## Durable Memory Updates
Update the shared memory docs as work reveals durable knowledge:

- New architecture, route, table, or module shape → `docs/agent/project-map.md`.
- New convention, UI rule, auth/permission rule, or workflow policy → `docs/agent/conventions.md`.
- New integration behavior or external API constraint → `docs/agent/integrations.md`.
- New performance/caching/loading decision → `docs/agent/performance.md` and/or `docs/agent/decisions.md`.
- Dated decision with rationale → `docs/agent/decisions.md`.
- Substantive completed work summary → `docs/agent/sessions.md`.

Update memory as part of the work when it is natural and safe. Mention the updated memory docs in the final response. Skip memory updates for trivial tasks or quick factual answers.

## Verification Defaults
- For documentation-only changes, review diffs and run targeted `rg` checks; typecheck is not required.
- For TypeScript/code changes, run `pnpm typecheck` unless the user explicitly narrows the task or the change cannot affect types.
- For UI work, run the local app and verify the relevant route visually when practical.
- Do not revert unrelated local changes. Current worktrees may already contain user or agent edits.
