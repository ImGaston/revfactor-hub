# Conventions — RevFactor Hub

## Visual Agent Flows

- Agent Flows use a controlled `@xyflow/react` canvas with explicit full-snapshot saves; the Supabase version is authoritative and drafts may be temporarily invalid while being designed.
- Validate reachability, cycles, decision labels, terminal outputs, and graph size before testing or promotion. Keep the initial ceiling at 50 nodes and 100 edges.
- Store only serializable node data in JSONB. React components, callbacks, and node behavior live in the code registry in `lib/agent-flows.ts`.
- Do not add arbitrary JavaScript, shell, SQL, database-query, or unrestricted HTTP nodes. Assembly, PriceLabs, client context, and Knowledge nodes are read-only; any future side effect requires a human-approval node and a separately authorized runtime.
- Lifecycle versions after draft are immutable. Production promotion does not implicitly attach a flow to a playbook or change Agent Studio behavior.
- Flow instructions must describe observable operating behavior and evidence boundaries, never private chain-of-thought.

## Coding

- Use TypeScript strict mode.
- Use `@/` imports from the project root.
- Use shadcn/ui components; install missing primitives with `npx shadcn@latest add [component]`.
- Use Server Actions (`"use server"`) for data mutations.
- Supabase queries should use Supabase clients, not raw SQL in frontend code.
- Server Components should use `lib/supabase/server.ts`; Client Components should use `lib/supabase/client.ts`.
- Admin operations that create users or bypass RLS should use `lib/supabase/admin.ts` and stay server-side.
- Keep `next/headers` imports strictly in server-only files such as `.server.ts`.
- Handle Supabase query errors and show user feedback with Sonner where applicable.
- Prefer React 19 `useOptimistic` for instant mutation feedback, especially kanban drag-and-drop.

## Auth and Permissions

- Auth methods are password and magic link via Supabase Auth.
- Roles are dynamic rows in `roles`; `profiles.role` references `roles.name`.
- Permissions live in `role_permissions` with resource/action pairs.
- Server permission checks use `lib/permissions.server.ts`; client-safe checks use `lib/permissions.ts`.
- Settings tabs are permission-gated by resource/action, not role names.
- Revenue Manager reuses the global action catalog: `revenue:view` is read, `create`/`edit` are draft management, `publish` is profile/strategy/recommendation approval, and `control` is manual execution verification/outcome control. Migration 075 defaults `admin` to view/create/edit only and leaves publish/control fail-closed for the pilot.
- `settings/layout.tsx` builds super_admin's permission map from the canonical `RESOURCES × ACTIONS` grid, **not** a hand-written array. It used to hardcode six keys, which silently hid any tab whose permission nobody remembered to add — Wins Rules was invisible to super_admin until this was fixed (2026-08-20).
- Sidebar nav items carry a `resource` key and are filtered by `permissionMap["{resource}:view"]` (super_admin sees all; Financials keeps its explicit super_admin flag). When adding a module, add its resource to `RESOURCES` in `lib/permissions.ts`, seed `role_permissions` in the migration, and confirm existing roles have the `view` row — the live table is UI-managed and can drift from migration seeds (knowledge was missing for admin until 2026-07-03).
- `role_permissions` writes from `/settings/roles` must use `upsert` with `onConflict: "role_name,resource,action"`, never plain `update` — an update on a missing row silently no-ops and the checkbox appears broken (fixed 2026-08-06, migration 072 backfilled all role × resource × action gaps and removed stale `calendar`/`notes` rows). The roles UI derives counts and checkbox state from the canonical `RESOURCES × ACTIONS` grid, not raw DB rows.
- Financial data and `/financials` are `super_admin` only. Enforce this server-side and pass `isSuperAdmin` to UI components for conditional rendering.
- Client churn fields (`clients.ending_reason_tags`, `clients.ending_note`, migration 048) are super_admin-only via app-layer gating, same pattern as `billing_amount`: RLS rides on `clients:view`, so every loader that selects them must null them for non-super_admin, and `updateClientAction` strips them from non-super_admin input.
- RLS is enabled across tables. `get_my_role()` is a SECURITY DEFINER helper to avoid recursive policies.
- RLS policies are permission-based since `038_rls_hardening.sql` (2026-07-03): SELECT uses `public.has_permission('<resource>', 'view')` and writes use `create`/`edit`/`delete` (child/junction tables use `edit`). **Never ship a `USING (true)` policy on a new table** — map it to a resource and seed `role_permissions`. Tables left open to any session: `profiles` (SELECT, for author names), `roles` + `role_permissions` (SELECT, the layout builds the permission map), and `listings` (SELECT also allows `adjustments:view`).
- `clients` SELECT requires `clients:view`. Flows that only need client names for roles without it (Adjustments queue/card/create-dialog, Listings list/detail/export) must join the `clients_basic` view (`id, name, status`; intentionally SECURITY DEFINER — the Supabase linter flags it, that's accepted) instead of `clients`. Embeds alias it as `clients:clients_basic(...)`; PostgREST resolves the relationship through the base-table FK. `clients_basic` is granted to `authenticated` only, not `anon`.
- The `hostpricing` role is intentionally minimal (2026-08-06): `adjustments` view/create/edit + `listings:view`, nothing else (no clients, reservations, or control). Their client picker in the Adjustments dialog works via `clients_basic`.
- `profiles.role` changes are blocked by the `profiles_role_guard` trigger unless the updater is super_admin (admin client / SQL exempt). New app views must set `security_invoker = true` unless they exist precisely to bypass RLS like `clients_basic`.
- **RLS does not cover everything.** A server action that uses `createAdminClient()` or calls an external API (Assembly, Stripe, PriceLabs) runs outside RLS, so it **must check `hasPermission()` in code** — the DB will not stop it. Prior art: `pipeline:control` gates `createAssemblyClientForLead` (admin-client insert into `clients` + portal invite) and `sendContractToAssembly` (sends a contract to the prospect) in `app/(authenticated)/pipeline/actions.ts`.
- **Machine-to-machine auth** (external consumers, no Supabase session) uses `lib/api-auth.server.ts`: `Authorization: Bearer rvf_live_<64 hex>`, resolved by SHA-256 digest against `api_keys` with one indexed lookup, scoped via `API_SCOPES` (`leads:read`). 401 for missing/invalid/revoked, 403 for a valid key missing the scope. Keys are issued and revoked with `scripts/create-api-key.ts` / `revoke-api-key.ts` — never an env var, so an external's key can be rotated without a redeploy. This is distinct from the inbound webhooks (`WEBHOOK_SECRET`, `SCHEDULER_WEBHOOK_SECRET`) and cron (`CRON_SECRET`), which stay static shared secrets.
- **When a route verifies a key and then reads through `createAdminClient()`, the column projection _is_ the security boundary** — RLS is bypassed. Enumerate columns explicitly, never `select("*")`, and say so in a comment. Prior art: `app/api/v1/leads/route.ts` and the public adjustment shell `app/a/[token]/page.tsx`. Concretely, `leads.description` must never be projected: the scheduler webhook flattens the host's name/email, the meet link, and free-text notes into it. Outbound public APIs live under `app/api/v1/` so the contract can be versioned.
- `team_credentials` (migration 070) is its own resource: `admin` has view/create/edit (delete off by default, tunable in Settings → Roles) and the external roles (`contractor`, `marketing`, `hostpricing`) are explicitly denied. Its server actions (`app/(authenticated)/knowledge/credentials-actions.ts`) check `hasPermission` in code in addition to the RLS backstop — follow that pattern for new credential-like mutations.
- Roles seeded by migration must use `ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed` when the grant has to be deterministic: `createRole()` in Settings → Roles pre-seeds every `resource × action` row as `FALSE`, so `DO NOTHING` silently no-ops if the role already exists. Use `DO NOTHING` only when the intent is "recreate on a fresh DB, never touch the live one".
- Adjustment comment `origin` is set **server-side from the author's profile role** (`hostpricing` role → `hostpricing`, else `internal`; `client` reserved — owners have no login), never accepted from the client. The needs-reply flag is always derived (`hasUnansweredExternalComment` over `adjustment_comment_stats`), never stored. An internal comment (author with `adjustments:edit`) on a `needs_info` ticket auto-reverts it to `open` inside `addAdjustmentComment`; status-change notes in `updateAdjustmentStatus` are inserted inline precisely so they bypass that revert. Every status transition writes an `adjustment_status_history` row.
- Display-only structured context on a row may live in a single app-validated JSONB column (`adjustments.signals`, migration 071 — free-form strings, keys filtered in `validateAdjustmentInput`); anything that gets queried, filtered, or sorted gets discrete columns. When adding columns to `adjustments`, add them to **every explicit projection that feeds `updateAdjustment`/`duplicateAdjustment`** (`ADJUSTMENT_SELECT` on the list page, the `duplicateAdjustment` source select) or edits silently wipe them — and never to the `/a/<token>` public-shell projection.
- **PostgREST embeds must be FK-hinted once a second relationship path exists** — adding the reaction junction tables (046) made the bare `profiles(...)` embed on `adjustment_comments`/`task_comments` ambiguous (comment→profiles direct via `author_id` AND many-to-many via `<table>_reactions`), and PostgREST returns **HTTP 300** which supabase-js surfaces as an error → the UI silently rendered "no comments". Same for `tasks(...)` from `task_comments` (two FKs: `task_id`, `linked_task_id`). Always write `profiles!<table>_author_id_fkey(...)` / `tasks!task_comments_task_id_fkey(...)` on these tables, and when adding any junction/second FK, grep for bare embeds of the newly-ambiguous target.
- Adjustment comment DELETE (047): author's own rows OR `has_permission('adjustments','delete')` (super_admin/admin) — surfaced as a trash action on the hover bar with an `AlertDialog` confirm. `task_comments` delete stays author-only.
- Comment threads are the same comments table with `parent_id` set (one level deep, migration 046). On `adjustment_comments`, rows with a parent are **internal**: SELECT/INSERT require `adjustments:control` in RLS — never render or count them for external roles (the stats view and the needs_info auto-reopen already skip them; `/a/<token>` queries filter `.is("parent_id", null)`). Reactions live in `<table>_reactions` `(comment_id, user_id, emoji)`; the hover bar and chips are the shared `components/comments/*` components — reuse them for any new comment surface.

## Wins Dashboard

- `/wins` crosses two clocks that must never be conflated: **pickup is measured by `booked_date`** (when the guest reserved, from `pricelabs_reservations_cache`) and **TY/STLY revenue by stay date** (from `report_metrics`). Every surface labels which one it is showing; the generated message never fuses them into a causal claim.
- Pickup uses three consecutive **31-day** windows inclusive of both ends, anchored on the newest *complete* booking day (the current day is always excluded — it is partial). `as_of = 2026-08-12` reproduces the reference workbook exactly (W3 = Jul 13–Aug 12, W2 = Jun 12–Jul 12), verified to the cent against `Rabbit Run`.
- Trend cuts are `> +15%` / `< -15%`, with **±15.00% inclusive in `Held`**. Verified empirically against the workbook's 239 rows (lowest Up +15.18%, highest Down -15.46%); the workbook has no row at the exact boundary, so the inclusive rule is this project's decision.
- **A percentage is suppressed, not approximated, when it would mislead**: STLY = 0 → `no_stly`; STLY below `minStlyRevenue` ($5,000) → `small_stly_base`; |pct| > 300% → `extreme`. Always show the absolute delta first. 106 of 242 listings have no STLY and 22 sit under the floor — without this, messages like the workbook's "+18,013% vs STLY" (on a $249 base) would reach clients.
- **Detection thresholds are editable but versioned, never mutated** (migration 076, Settings → Wins Rules). `win_rule_sets` rows are immutable — a database trigger allows only `is_active` to change — and saving publishes a new version. A partial unique index enforces exactly one active set, and `activate_win_rule_set()` flips both rows in one statement so the index can never reject a half-applied switch. `WINS_RULES_V1` in `lib/wins.ts` is now only the seed and the fallback when the table is unreadable; each run still freezes the resolved rules into `win_detection_runs.rules_snapshot`, so a message reviewed months ago stays explainable by the numbers that produced it.
- **`evaluateCandidate()` is the single evaluator.** Both the detection run and the rules editor's impact preview call it, so the preview cannot drift from what publishing would actually do. It re-derives the threshold-dependent reason codes (`stale_source`, `small_stly_base`, `extreme_yoy_pct`, `compset_qa_required`, `occ_up_adr_down`, listed in `RULE_DEPENDENT_REASON_CODES`) and carries the data-dependent ones through untouched — a stale `small_stly_base` from a previous rule set must never survive a re-evaluation.
- **`copied` and `assembly_opened` are user intent, never delivery.** The Hub cannot observe Assembly. Only `marked_shared` records a human assertion, written by its own explicit action; `recordWinEventAction` refuses that event type. Never present, store, or aggregate either as "sent". `lib/__tests__/wins-boundaries.test.ts` enforces this plus the no-Assembly-writes boundary structurally.
- Listing names are internal labels that append state and owner (`"Austin House | TX | Michelle"` — 152 of 249 active listings carry a pipe). `publicListingName()` takes the half before the first separator for client-facing text; the UI keeps the full name.
- **Portfolio pickup totals must dedupe the matview fan-out.** `pricelabs_reservations_cache` fans one `reservation_key` across several hub listings, so summing per-listing pickup across a client double-counts real bookings. Candidates carrying `ambiguous_listing_mapping` are excluded from portfolio totals and surfaced separately.
- Candidate grain is **one hub listing per run** (`UNIQUE (run_id, hub_listing_id)`), not one PriceLabs listing — 242 hub listings map from 239 PriceLabs ids. A rerun **upserts** candidates so ids stay stable: delete-then-insert orphans already-copied drafts via `ON DELETE SET NULL`, preserving the frozen evidence but losing the link that tells a reviewer the evidence moved.
- **`has_permission()` returns NULL, not FALSE, for a session with no profile row** (it is `EXISTS(...) OR get_my_role() = 'super_admin'`, and `false OR NULL` is NULL). In plpgsql, `IF NOT NULL THEN` never enters its branch, so **a gate written as `IF NOT public.has_permission(...)` lets an unidentified session straight through**. Always write `IS NOT TRUE`. RLS policies are unaffected (NULL is not TRUE, so rows filter out) — this only bites in-function guards. Found by probing the live function, not by review.
- Occupancy and ADR are aggregated as **simple averages across months** (PriceLabs convention) and every surface says so. The Hub has no daily available-nights source, so weighting is impossible — never present the simple average as weighted.
- `potential_revenue_open_inventory` is opportunity, not evidence of a win. It appears in the drawer under its own heading and is banned from every message template.

## UI
- The visual system is a "liquid glass" layer on top of the shadcn `radix-luma` style (`components.json`: `style: radix-luma`, `menuColor: inverted-translucent`). Tokens, utilities, and motion live in `app/globals.css`; see the Liquid Glass section below.
- Glass is for **chrome only** (sidebar, top bar, dialogs, sheets, popovers, dropdowns, command palette, toasts). Content surfaces — `Card`, tables, kanban cards — stay opaque and get elevation (`shadow-e1..e4`) instead. Do not make a data-dense surface translucent.
- Sidebar navigation uses lucide-react icons.
- Financial numbers are right-aligned and `font-mono`.
- Status indicators use shadcn `Badge`.
- Forms use shadcn Form, react-hook-form, and zod validation when the local pattern exists.
- Loading states use shadcn `Skeleton`.
- Destructive actions require `AlertDialog` confirmation.
- Inline editing follows the `+Add` -> input with save/cancel pattern.
- Collapsible sections default hidden with `useState(false)` and ChevronRight/ChevronDown toggles.
- Password fields use show/hide and clipboard-copy controls.
- Long unbroken user text (URLs, UTM blobs, tokens) inside flex/grid layouts needs `wrap-anywhere` (`overflow-wrap: anywhere`) plus `min-w-0` on the flex column — `break-words` is not enough because `overflow-wrap: break-word` does not shrink the intrinsic min-content width, so the long word widens the whole container before wrapping ever applies (bit the lead-detail Description inside the Dialog, 2026-07-13). The same applies to the base `Textarea`: its `field-sizing-content` sizes the control from its content, so it carries `wrap-anywhere` in `components/ui/textarea.tsx` (bit the Edit Lead dialog, same day). Clamp long blocks with `line-clamp-N` + a Show more/less toggle.
- `SidebarInset` in `app/(authenticated)/layout.tsx` carries `min-w-0`: it is a flex child, and without it any wide `whitespace-nowrap` table pushes the whole layout past the viewport instead of scrolling inside the table's `overflow-x-auto` container (bit /adjustments on laptop widths, 2026-08-01). For dense tables, also mark the long text columns `whitespace-normal` on the `TableCell` so they wrap and the table fits without horizontal scroll.
- **A scrollable glass surface must scroll on an inner wrapper, never on the glass element itself.** `glass-chrome` paints its `backdrop-filter` on an absolutely-positioned `::before` sized to the element's *visible* box. Put `overflow-y-auto` on that same element and the pseudo scrolls away with the content, so past one viewport the frosted panel simply ends and the page shows through — it reads as the surface "changing colour at the bottom". This is the same root cause as the `dropdown-menu` / `select` / `command` limitation noted at the end of this file; for a `Sheet` it is avoidable. Keep `SheetContent` unscrolled and wrap the body in `min-h-0 flex-1 overflow-y-auto` (`SheetContent` is already `flex flex-col`; without `min-h-0` the child refuses to shrink and nothing scrolls). Bonus: the header stays pinned. Hit by the Wins detail drawer, 2026-08-20.
- **Widening a `Sheet` needs the `data-[side=…]:` prefix.** `components/ui/sheet.tsx` pins the horizontal sides with `data-[side=right]:w-3/4` and `data-[side=right]:sm:max-w-sm` (384px). A plain `w-full` / `sm:max-w-2xl` on `SheetContent` does **not** win: they are different variant groups, so tailwind-merge keeps both classes and the attribute selector takes precedence. Write `data-[side=right]:w-full data-[side=right]:sm:max-w-2xl` instead. The failure is silent and looks like a design choice — the Wins detail drawer shipped at 384px and truncated nearly every metric before this was found (2026-08-20).
- Detail-as-modal with a real URL uses the intercepting-route pattern (slot `app/(authenticated)/@modal/` + `(.)route/[id]`), not a client Dialog that refetches: one shared server component renders both the full page and the modal, close = `router.back()`, and the slot keeps `default.tsx` + a required (never optional) catch-all returning null. Prior art: Pipeline lead detail; rationale and gotchas in `decisions.md` 2026-07-13.

## Kanban

- Columns use subtle tinted backgrounds matching semantic status.
- Cards use a `border-l-[3px]` accent matching column color.
- Column headers show label and count badge.
- Empty columns show centered "No items".
- Card metadata appears as icon/label pairs.
- Priority and tag badges may use custom colors.
- Drag-and-drop uses `@hello-pangea/dnd` with optimistic UI.
- Cards support click-to-move menus, archive/complete actions, and optional status indicators.
- The `/roadmap` Kanban treats `posts` as tasks. Every task must have a `roadmap_projects` parent; the board supports an all-project view and a single-project filter. The legacy `posts.eta` storage field is presented as the task Deadline in the app, while `roadmap_projects.deadline` is the overall project deadline.

## Listings

- Listing detail has a PriceLabs-style KPI row: Base Price, Min Price, Occ(7N), Mkt Occ(7N), Occ(30N), Mkt Occ(30N), Wknd Occ(30N), Mkt Wknd(30N), MPI(30N), Last Booked.
- `occColor(occ, marketOcc)` uses red under 0.8x market, amber from 0.8x to 1x, green from 1x to 1.2x, blue above 1.2x.
- Client detail listing cards show Occ(7N), Occ(30N), MPI(30N), Last Booked from real PriceLabs data.
- Settings > Listings accepts numeric Airbnb IDs only and builds `https://www.airbnb.com/rooms/{id}`.
- The unified PriceLabs / Listing ID field sets both `listing_id` and `pricelabs_link` using `https://app.pricelabs.co/pricing?listings={id}`.
- If a full URL is pasted, extract the ID and show a generated link preview.
- All "add/edit listing" forms share `components/listings/listing-form-fields.tsx` (Name, City, State selector, Airbnb ID, PriceLabs/Listing ID) plus its helpers `buildListingFields`, `listingValuesFromRecord`, `EMPTY_LISTING_VALUES`. Reused by `components/clients/add-listing-dialog.tsx`, `settings/listings/listing-dialog.tsx`, and the financials `link-subscription-dialog.tsx` quick-add. State is a code selector from `lib/us-states.ts` (always store the 2-letter code) — do not use a free-text State input.

## Client Pricing Dashboard

- Client detail pages read the private embed link directly from `clients.dashboard_url`.
- Present `dashboard_url` as a compact copy action alongside the other client integration buttons; never expose or reconstruct a separate dashboard token, and never include the URL in logs, analytics, or error messages.

## Environment

Required variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PRICELABS_API_KEY=
PREDICTHQ_ACCESS_TOKEN=
ASSEMBLY_API_KEY=
STRIPE_SECRET_KEY=
AI_GATEWAY_API_KEY=
ONBOARDING_ENTITLEMENT_SYNC_ENABLED=false
CRON_SECRET=
WHATSAPP_GROUP_INVITE_URL=
```

`WHATSAPP_GROUP_INVITE_URL` is the team WhatsApp group invite (`https://chat.whatsapp.com/<code>`), read server-side in the Adjustments create flow only. Never expose it on the public `/a/` shell or in Open Graph tags — anyone with the invite link can join the group.

Rules: no quotes, no spaces after `=`, and only `NEXT_PUBLIC_` variables are browser-accessible.

`AI_GATEWAY_API_KEY` is required for local Agent Studio model runs. Vercel deployments may instead authenticate AI Gateway through Vercel OIDC. Keep both credentials server-only.

Agent Studio is a draft sandbox: model tools remain read-only, runs stay ephemeral, and no Assembly send tool is exposed. A future production sending path needs its own explicit permission, approval/audit flow, and server-side policy gate.

## Agent Memory Hygiene

- Store durable project/system memory in `docs/agent/`, not `.claude/rules/`.
- Do not store personal profile memory, private preferences, secrets, tokens, credentials, or customer-sensitive details in repo docs.
- If a task creates durable knowledge, update the relevant memory doc during the work and mention it in the final response.
- Skip memory updates for trivial tasks, quick factual answers, or changes already fully captured by code.

## Optional Claude Local Stop Hook

`.claude/` is ignored by git, so local Claude hooks are optional and machine-specific. If you want a local end-of-session nudge, add a Stop hook in `.claude/settings.local.json` that points to a script like:

```bash
#!/bin/bash
CONTEXT=$(cat)

STRONG_PATTERNS="fixed|workaround|gotcha|that's wrong|check again|we already|should have|discovered|realized|turns out"
WEAK_PATTERNS="error|bug|issue|problem|fail"

if echo "$CONTEXT" | grep -qiE "$STRONG_PATTERNS"; then
  cat << 'EOF'
{"decision":"approve","systemMessage":"This session involved fixes or discoveries. Consider updating docs/agent/ with durable learnings."}
EOF
elif echo "$CONTEXT" | grep -qiE "$WEAK_PATTERNS"; then
  echo '{"decision":"approve","systemMessage":"If you learned something non-obvious, update docs/agent/."}'
else
  echo '{"decision":"approve"}'
fi
```

Do not commit local hook settings unless the team deliberately decides to version a safe template outside `.claude/`.

## Agent Studio Governance

- Treat client prompts, Assembly history, database text, and Knowledge content as untrusted input; immutable runtime safety instructions outrank editable playbooks.
- Persist only permission-scoped traces. Redact emails, phone numbers, and URLs from Assembly excerpts before model use and storage.
- Assembly and PriceLabs access is read-only. Any future Assembly send path must use the approval ledger and explicit human approval.
- Playbook changes create immutable draft versions. Production promotion requires a separate approver.
- Token, cost, latency, daily/monthly budget, and retention limits are server-enforced.
- Only callable model tools belong in `agent_playbook_versions.allowed_tools`. Client, Assembly, and PriceLabs context is preloaded by the server and recorded as sources; it is not represented as a callable tool.
- Structured-output compatibility and reasoning controls are model-specific. Keep the required JSON fields explicit in immutable instructions and smoke-test every selectable Gateway model after model-catalog or AI SDK changes.
- Agent Studio must query only Knowledge rows where `status='published'`, `audience='client_safe'`, `review_status='approved'`, and `agent_enabled=true`. Editing an approved answer revokes agent enablement until it is reviewed again.
- “Knowledge change” feedback requires a corrected response and creates a disabled FAQ draft; it never teaches the live agent automatically.

## Market Signals Boundaries

- Market Signals use the `market_signals` permission resource. Canonical events/evidence are service-ingested and read-only to authenticated users; human reviewers append decisions rather than rewriting evidence or history.
- Market Signals scoring and queue selection are deterministic and auditable. The Vercel AI Gateway Signal Brief may explain only the stored snapshot; it must not calculate booking vulnerability, choose numeric ADR/stay-rule changes, bypass the bounded review gate, or mutate PriceLabs/PMS/OTA systems. Persist the prompt version, model, fingerprinted input snapshot, structured output, usage, latency, and failure state. Validate grounding before exposing output.
- A Needs Review item must have current PriceLabs evidence for at least half of the market's active approved listings, explicit vulnerability at or above 45, verified/current event evidence, materiality at or above 65, and selection inside the five-distinct-family market review budget. Unknown/stale/overflow items stay on Watchlist.
- Market footprint setup is agent-managed: coordinate matches can be approved and configured markets activated without a human setup gate. The agent may automatically enable a registered source only after its secure server credential exists. Human approval begins at consequential revenue recommendations and all downstream PriceLabs/PMS/OTA mutations.
- Provider adapters must normalize into `NormalizedProviderEvent`; secrets stay server-side and a missing credential must fail closed. Never add a committed fallback token.
- Event identity is source-independent. Deduplicate by canonical fingerprint and provider records, not provider ID alone. Unknown recurring-family keys must remain title-specific rather than falling back to `sports`, `concerts`, or another broad category.
- Initial reviewer proposals name bounded actions and missing evidence; they do not invent an ADR percentage or mutate PriceLabs, a PMS, or an OTA.
- Human Watch/Dismiss/Escalate/Create/Link decisions are tied to the completed brief version and append-only. A changed deterministic snapshot creates a new brief and reopens review. Creating or linking an Adjustment must use the migration-082 transactional RPCs; only an open internal recommendation may be created, and no commercial change is approved or applied by that operation.
- Scheduled and manual refreshes must enqueue one durable `market_signal_jobs` row per market. Workers claim with a lease and `FOR UPDATE SKIP LOCKED`; never reintroduce a request-scoped loop across all active markets. A source's own cadence controls provider reads even though the worker wakes more frequently.
- Deterministic scoring may evaluate every approved listing in memory, but database evidence is bounded to the top 25 exposed listings for each selected review signal. Keep full evaluated/exposed counts in the impact summary and use the atomic scoring RPC; do not persist the complete event × listing Cartesian product.
- PriceLabs inventory refresh must enqueue `inventory_refresh` jobs so vulnerability and cached briefs can be recomputed without a PredictHQ request. The event-provider beta expiring must not stop inventory-only work or queue retries.

## Liquid Glass Visual System

Added 2026-08-20. All tokens and utilities live in `app/globals.css`.

**Utilities**
- `glass-chrome` — translucent surface. Sets `position: relative` + a `::before` at `z-index: -1` carrying the `backdrop-filter`. Three reasons the blur is on the pseudo and not the element: `backdrop-filter` on an element makes it a containing block for `position: fixed` descendants; WebKit bleeds the blur past `border-radius` when an ancestor animates (every Radix content does); and putting the tint on the pseudo's own background paints it *above* the filtered backdrop, which is what lets `brightness()` crush only the backdrop.
- **Never add `isolation: isolate` to a glass host.** `isolate` creates a *backdrop root*, which limits the blur's sampling to the element itself and silently kills the effect. Verified in the browser.
- `glass-panel` (86%) — anchored chrome that is always on screen and blurs scrolling content (sidebar, top bar). Lower blur on purpose: those surfaces re-rasterize per frame.
- `glass-dense` (92%) — surfaces that float over arbitrary content and hold long text (dialogs, sheets, toasts).
- `motion-snappy` / `motion-smooth` / `motion-bouncy` — pair a spring easing with its matched duration. Always use these instead of `ease-* duration-*` separately: the settle time is baked into each `linear()` curve, so a mismatched duration makes the spring read wrong. They also set `--tw-ease`/`--tw-duration`, which is what `tw-animate-css` reads, so Radix `data-open:animate-in` transitions spring for free.

**Every `var()` inside `glass-chrome` carries a fallback**, and must keep doing so. The failure mode when a token does not resolve is a *transparent* surface — and since the `inverted-translucent` menus paint near-white text, that renders as invisible text, not as a visible glitch. Degrading to an opaque `--popover` is ugly but readable. (Hit in dev on 2026-08-20 via a stale Turbopack CSS cache; `rm -rf .next` clears it.)

**Glass only where something actually passes behind it.** The page background is flat — there is no ambient/gradient layer (tried and removed, see `decisions.md` 2026-08-20). So `backdrop-filter` is only worth its cost where real content moves underneath:

| Surface | Treatment | Why |
|---|---|---|
| Top bar | `glass-chrome glass-panel` | Content scrolls under it. This is the one anchored surface where the frost reads. |
| Sidebar (desktop) | solid `bg-sidebar` + `border-r` | Fixed column; nothing ever passes behind it, so glass would blur flat color and cost GPU for nothing. |
| Mobile drawer | `glass-chrome` | Covers real content. |
| Overlays, menus, palette, toasts | `glass-chrome` | Same. |

Do not "unify" the sidebar back into glass for consistency's sake — it looks the same as a solid panel and only costs frames.

**Re-tinting glass.** Callers override `--glass-surface` (e.g. `[--glass-surface:var(--sidebar)]`), never `--glass-opacity` — that one is reserved so `prefers-reduced-transparency` can neutralize it.

⚠️ **`--glass-surface` must be re-declared in every theme block that changes `--popover`.** A custom property resolves its `var()` at the element where it is *declared*, then inherits already-substituted. Declared only in `:root`, a subtree that forces `.dark` (the `inverted-translucent` menus over a light page) inherits the *light* popover and renders grey-on-grey. This is why `.dark` re-declares `--glass-surface: var(--popover)`.

**Contrast.** Dark glass over light content needs high opacity — the math (`a*0.205 + (1-a)*L_backdrop <= ~0.28`) puts the floor near 82%, which is why `.dark` uses 82% and not the 62% that reads fine in a fully dark page. Automated contrast tools cannot see through `backdrop-filter` and will report these surfaces as passing; check rendered pixels.

**Springs.** `--ease-snappy/smooth/bouncy` are damped-harmonic step responses sampled to CSS `linear()` at 20 stops, parameterized by (zeta, duration). Regenerate with the sampler documented in `decisions.md`, do not hand-edit the numbers.

**Elevation.** `--shadow-e1..e4` each bundle the specular rim (inset highlights + hairline ring) *with* the shadow, deliberately: `glass-rim` and `elevated` as separate utilities would both write `box-shadow` and silently overwrite each other. One class = border + depth.

**Local deltas to `components/ui/*`.** These files are otherwise stock registry output; a `npx shadcn@latest add <name>` would revert them. Each edit is a single utility token so it is easy to re-apply: `card`, `table`, `tabs`, `skeleton`, `button`, `badge`, `empty`, `tooltip`, `popover`, `dialog`, `sheet`, `alert-dialog`, `command`, `sidebar`, `dropdown-menu`, `select`. `textarea.tsx` also carries the older `wrap-anywhere` fix.

**Known limitation.** `dropdown-menu`, `select`, and `command` put `overflow-y-auto` on the same element that carries the glass `::before`. An absolutely-positioned pseudo inside a scroll container scrolls with the content, so on a menu long enough to scroll the blur drifts out of view. Pre-existing; fixing it means moving the scroll to an inner wrapper.
