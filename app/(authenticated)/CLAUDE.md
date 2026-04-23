# CLAUDE.md — Authenticated Routes Performance Notes

Scoped notes for the list/detail routes in this subtree. Covers the perf pass done on `/clients` and `/listings` in April 2026. Patterns here should be reused when adding new list views.

## Query-trimming pattern (list views)

**Rule:** list `page.tsx` queries should only select columns the table/card actually renders, and joined arrays should only expose `{id, status}` (or whatever minimum powers counts/filters). The rich shape belongs to the detail page, not the list.

**Applied to:**
- [clients/page.tsx](clients/page.tsx) — drops `tasks(*).profiles(*)`, drops all `pl_*` from nested `listings(...)`. Uses the narrower `ClientListItem` type (see [lib/types.ts](../../lib/types.ts)) instead of `Client` so detail pages keep their full shape.

**When adding a new list view:** define a dedicated `XListItem` type. Do not reuse the detail-page type for the list.

## Lazy-fetch pattern for dialog data

**Problem:** `/listings/page.tsx` and `/settings/listings/page.tsx` used to do a second `supabase.from("clients").select("id, name")` just to populate the Client dropdown in `ListingDialog`. That query ran on every page load even when nobody opened the dialog.

**Fix:** the dialog fetches its own options on mount via a server action. See [settings/listings/actions.ts](settings/listings/actions.ts) → `getClientOptionsAction()` and [settings/listings/listing-dialog.tsx](settings/listings/listing-dialog.tsx) → `useEffect` gated on `open && !clients`. Disable the Select while loading (`disabled={clients === null}`) with a "Loading clients..." placeholder.

**When to reuse:** any dialog that needs a lookup list only relevant when the dialog opens (client lists, tag lists, user lists, template lists). Do NOT apply to data the table itself needs.

## loading.tsx skeletons

Every list + detail page under this subtree has a sibling `loading.tsx`:
- [clients/loading.tsx](clients/loading.tsx)
- [clients/[id]/loading.tsx](clients/[id]/loading.tsx)
- [listings/loading.tsx](listings/loading.tsx)
- [listings/[id]/loading.tsx](listings/[id]/loading.tsx)

Shape them to match the real page layout (same header/filter/table structure, ~10–12 placeholder rows). Reuse `components/ui/skeleton.tsx`.

**Any new list/detail route in `(authenticated)/` should ship with a `loading.tsx`.**

## Decisions explicitly rejected

- **No `export const revalidate = N` / ISR on pages.** Staleness is perceptible across 2–3 concurrent internal users and the cache segments per auth cookie anyway (low hit rate). If a specific query is later identified as expensive-and-stable, use `unstable_cache` with tags and target invalidation — not page-level ISR.
- **No Suspense/streaming refactor of detail pages.** `ClientDetailPage` is a 500+ line client component with interactive state; splitting it into server shell + streamed children would be a large refactor for marginal win at current dataset sizes. Revisit if a specific section ever grows a slow fetch.
- **No `client_portfolio_summary` SQL view.** After the Fase 1.1 trim the list payload is small enough (~380 rows of tiny shape for 76 clients). Moving the counts to SQL adds RLS surface area and type-maintenance cost with minimal payoff. Revisit if client count grows past ~300.

## DB indexes for these routes

Migration [030_perf_indexes_clients_listings.sql](../../supabase/migrations/030_perf_indexes_clients_listings.sql) adds:
- `idx_clients_name` — sort on `/clients`
- `idx_listings_name` — sort on `/listings`
- `idx_tasks_client_status` — open-task count aggregation

**Scope is explicit:** this migration is for these two routes only. Other perf work (PriceLabs `listing_id` lookups, `onboarding_progress`, etc.) belongs in its own migration.

## Verification checklist when touching these routes

1. `pnpm typecheck` green
2. Navigate to the route logged in, confirm counts/filters/sort still work
3. For `ListingDialog` changes: open the edit dialog, confirm the Client Select populates (brief "Loading clients..." is expected)
4. Check `preview_network` for failed requests after navigation
