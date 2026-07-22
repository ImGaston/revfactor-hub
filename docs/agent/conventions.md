# Conventions — RevFactor Hub

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
- Sidebar nav items carry a `resource` key and are filtered by `permissionMap["{resource}:view"]` (super_admin sees all; Financials keeps its explicit super_admin flag). When adding a module, add its resource to `RESOURCES` in `lib/permissions.ts`, seed `role_permissions` in the migration, and confirm existing roles have the `view` row — the live table is UI-managed and can drift from migration seeds (knowledge was missing for admin until 2026-07-03).
- Financial data and `/financials` are `super_admin` only. Enforce this server-side and pass `isSuperAdmin` to UI components for conditional rendering.
- Client churn fields (`clients.ending_reason_tags`, `clients.ending_note`, migration 048) are super_admin-only via app-layer gating, same pattern as `billing_amount`: RLS rides on `clients:view`, so every loader that selects them must null them for non-super_admin, and `updateClientAction` strips them from non-super_admin input.
- RLS is enabled across tables. `get_my_role()` is a SECURITY DEFINER helper to avoid recursive policies.
- RLS policies are permission-based since `038_rls_hardening.sql` (2026-07-03): SELECT uses `public.has_permission('<resource>', 'view')` and writes use `create`/`edit`/`delete` (child/junction tables use `edit`). **Never ship a `USING (true)` policy on a new table** — map it to a resource and seed `role_permissions`. Tables left open to any session: `profiles` (SELECT, for author names), `roles` + `role_permissions` (SELECT, the layout builds the permission map), and `listings` (SELECT also allows `adjustments:view`).
- `clients` SELECT requires `clients:view`. Flows that only need client names for roles without it (Adjustments queue/card) must join the `clients_basic` view (`id, name, status`; intentionally SECURITY DEFINER — the Supabase linter flags it, that's accepted) instead of `clients`.
- `profiles.role` changes are blocked by the `profiles_role_guard` trigger unless the updater is super_admin (admin client / SQL exempt). New app views must set `security_invoker = true` unless they exist precisely to bypass RLS like `clients_basic`.
- **RLS does not cover everything.** A server action that uses `createAdminClient()` or calls an external API (Assembly, Stripe, PriceLabs) runs outside RLS, so it **must check `hasPermission()` in code** — the DB will not stop it. Prior art: `pipeline:control` gates `createAssemblyClientForLead` (admin-client insert into `clients` + portal invite) and `sendContractToAssembly` (sends a contract to the prospect) in `app/(authenticated)/pipeline/actions.ts`.
- **Machine-to-machine auth** (external consumers, no Supabase session) uses `lib/api-auth.server.ts`: `Authorization: Bearer rvf_live_<64 hex>`, resolved by SHA-256 digest against `api_keys` with one indexed lookup, scoped via `API_SCOPES` (`leads:read`). 401 for missing/invalid/revoked, 403 for a valid key missing the scope. Keys are issued and revoked with `scripts/create-api-key.ts` / `revoke-api-key.ts` — never an env var, so an external's key can be rotated without a redeploy. This is distinct from the inbound webhooks (`WEBHOOK_SECRET`, `SCHEDULER_WEBHOOK_SECRET`) and cron (`CRON_SECRET`), which stay static shared secrets.
- **When a route verifies a key and then reads through `createAdminClient()`, the column projection *is* the security boundary** — RLS is bypassed. Enumerate columns explicitly, never `select("*")`, and say so in a comment. Prior art: `app/api/v1/leads/route.ts` and the public adjustment shell `app/a/[token]/page.tsx`. Concretely, `leads.description` must never be projected: the scheduler webhook flattens the host's name/email, the meet link, and free-text notes into it. Outbound public APIs live under `app/api/v1/` so the contract can be versioned.
- Roles seeded by migration must use `ON CONFLICT (role_name, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed` when the grant has to be deterministic: `createRole()` in Settings → Roles pre-seeds every `resource × action` row as `FALSE`, so `DO NOTHING` silently no-ops if the role already exists. Use `DO NOTHING` only when the intent is "recreate on a fresh DB, never touch the live one".
- Adjustment comment `origin` is set **server-side from the author's profile role** (`hostpricing` role → `hostpricing`, else `internal`; `client` reserved — owners have no login), never accepted from the client. The needs-reply flag is always derived (`hasUnansweredExternalComment` over `adjustment_comment_stats`), never stored. An internal comment (author with `adjustments:edit`) on a `needs_info` ticket auto-reverts it to `open` inside `addAdjustmentComment`; status-change notes in `updateAdjustmentStatus` are inserted inline precisely so they bypass that revert. Every status transition writes an `adjustment_status_history` row.
- **PostgREST embeds must be FK-hinted once a second relationship path exists** — adding the reaction junction tables (046) made the bare `profiles(...)` embed on `adjustment_comments`/`task_comments` ambiguous (comment→profiles direct via `author_id` AND many-to-many via `<table>_reactions`), and PostgREST returns **HTTP 300** which supabase-js surfaces as an error → the UI silently rendered "no comments". Same for `tasks(...)` from `task_comments` (two FKs: `task_id`, `linked_task_id`). Always write `profiles!<table>_author_id_fkey(...)` / `tasks!task_comments_task_id_fkey(...)` on these tables, and when adding any junction/second FK, grep for bare embeds of the newly-ambiguous target.
- Adjustment comment DELETE (047): author's own rows OR `has_permission('adjustments','delete')` (super_admin/admin) — surfaced as a trash action on the hover bar with an `AlertDialog` confirm. `task_comments` delete stays author-only.
- Comment threads are the same comments table with `parent_id` set (one level deep, migration 046). On `adjustment_comments`, rows with a parent are **internal**: SELECT/INSERT require `adjustments:control` in RLS — never render or count them for external roles (the stats view and the needs_info auto-reopen already skip them; `/a/<token>` queries filter `.is("parent_id", null)`). Reactions live in `<table>_reactions` `(comment_id, user_id, emoji)`; the hover bar and chips are the shared `components/comments/*` components — reuse them for any new comment surface.

## UI
- Phase 1 uses the shadcn default theme; brand theming comes later.
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
ASSEMBLY_API_KEY=
STRIPE_SECRET_KEY=
ONBOARDING_ENTITLEMENT_SYNC_ENABLED=false
CRON_SECRET=
WHATSAPP_GROUP_INVITE_URL=
```

`WHATSAPP_GROUP_INVITE_URL` is the team WhatsApp group invite (`https://chat.whatsapp.com/<code>`), read server-side in the Adjustments create flow only. Never expose it on the public `/a/` shell or in Open Graph tags — anyone with the invite link can join the group.

Rules: no quotes, no spaces after `=`, and only `NEXT_PUBLIC_` variables are browser-accessible.

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
