# Performance Memory — RevFactor Hub

## Authenticated Route Patterns

These notes cover list/detail routes under `app/(authenticated)/`, especially `/clients` and `/listings`. Reuse the patterns when adding new list views.

## Query Trimming for List Views

List `page.tsx` queries should select only columns the table/card renders.

- Joined arrays should expose only the minimum fields needed for counts, filters, and badges, such as `{id, status}`.
- Rich detail shapes belong on detail pages, not list pages.
- Define dedicated `XListItem` types for lists; do not reuse detail-page types when they force wide selects.
- Existing example: `clients/page.tsx` uses a narrower `ClientListItem` instead of the full `Client` shape.

## Lazy Dialog Data

Lookup data needed only inside dialogs should be fetched when the dialog opens.

- This replaced eager client-list queries on `/listings/page.tsx` and `/settings/listings/page.tsx`.
- Example pattern: `getClientOptionsAction()` in settings listings actions, then `useEffect` gated on `open && !clients`.
- Disable selects while loading with a clear placeholder such as "Loading clients...".
- Reuse for client lists, tag lists, user lists, template lists, and similar lookup data.
- Do not apply lazy fetch to data the table itself needs to render.

## loading.tsx Skeletons

Every new list/detail route under `app/(authenticated)/` should ship with a sibling `loading.tsx`.

- Existing examples: clients list/detail, listings list/detail, financials routes.
- Skeletons should match the real page layout: header, filters, table/card structure, and roughly 10-12 placeholder rows for list views.
- Reuse `components/ui/skeleton.tsx`.

## Caching Decisions

- Do not add page-level ISR (`export const revalidate = N`) on authenticated pages.
- Staleness is visible for 2-3 concurrent internal users, and auth-cookie cache segmentation has low hit rate.
- If a specific query is expensive and stable, prefer `unstable_cache` with tags and targeted invalidation.
- Do not refactor detail pages into Suspense/streaming unless a specific slow fetch justifies it.
- Do not add `client_portfolio_summary` just for current clients/listings list counts; the trimmed payload is small enough for current scale.
- `/financials` loads payout summary, current expense attribution, and the latest cash snapshot with the page. Saved planning scenarios and their child rows load only when the `Planning` tab mounts.
- Stripe payout reconciliation belongs in the daily cron and Supabase mirror, never in the Financials page request.

## Indexes

Migration `030_perf_indexes_clients_listings.sql` is scoped to `/clients` and `/listings`:

- `idx_clients_name` — sort on `/clients`.
- `idx_listings_name` — sort on `/listings`.
- `idx_tasks_client_status` — open-task count aggregation.

Other performance work should get its own migration. Known candidates from `docs/performance-baseline.md` include:

- `listings.listing_id` for PriceLabs sync lookups.
- `tasks(sort_order, created_at DESC)` for task board ordering.
- `onboarding_progress.client_id` and `onboarding_progress.template_id`.
- Migration 091 adds `idx_listings_active_airbnb_foundation_missing`, a partial UUID index only for active rows missing policy or timezone, plus `idx_adjustments_listing_id` for the cross-table ownership check. The deterministic inventory scans active listings only; do not join reservations into it.

## Market Signals Ingestion

Event Intelligence ingestion/performance decisions live in [revfactor-rm](https://github.com/federzimer/revfactor-rm/blob/main/docs/event-intelligence-migration.md). Hub's PriceLabs and Stripe crons no longer enqueue or drain Market Signals jobs; the RM cutover is owner-controlled after this Hub retirement deploys.

## Verification Checklist

When touching authenticated list/detail routes:

1. Run `pnpm typecheck`.
2. Navigate to the route logged in and confirm counts, filters, sort, row actions, and detail navigation.
3. For `ListingDialog`, open create/edit and confirm the Client Select populates after the expected loading state.
4. Check browser/dev output for failed requests after navigation.

## Churn tracker reporting (2026-10-06)

The tracker uses paginated 500-row projections for every cohort and the cancellation RPC, with stable ID ordering, so PostgREST row caps cannot truncate totals. Filters and summaries operate on the same complete cohorts. Markets derive from listing city/state; a client can match any of its markets and still counts once. Monthly counts cover twelve calendar months through the business date; missing exit dates are excluded from monthly/date-filter counts and disclosed, and unknown tenure never falls back to today. No authenticated page ISR or live Stripe API reads. Client/listing Settings mutations and onboarding client-status changes invalidate `/churn`.
