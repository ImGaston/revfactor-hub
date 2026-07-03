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
- RLS is enabled across tables. `get_my_role()` is a SECURITY DEFINER helper to avoid recursive policies.
- RLS policies are permission-based since `038_rls_hardening.sql` (2026-07-03): SELECT uses `public.has_permission('<resource>', 'view')` and writes use `create`/`edit`/`delete` (child/junction tables use `edit`). **Never ship a `USING (true)` policy on a new table** — map it to a resource and seed `role_permissions`. Tables left open to any session: `profiles` (SELECT, for author names), `roles` + `role_permissions` (SELECT, the layout builds the permission map), and `listings` (SELECT also allows `adjustments:view`).
- `clients` SELECT requires `clients:view`. Flows that only need client names for roles without it (Adjustments queue/card) must join the `clients_basic` view (`id, name, status`; intentionally SECURITY DEFINER — the Supabase linter flags it, that's accepted) instead of `clients`.
- `profiles.role` changes are blocked by the `profiles_role_guard` trigger unless the updater is super_admin (admin client / SQL exempt). New app views must set `security_invoker = true` unless they exist precisely to bypass RLS like `clients_basic`.

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
