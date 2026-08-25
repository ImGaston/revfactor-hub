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

## Market Signals Ingestion

- PredictHQ beta reads are bounded to 300 candidates per market and a 90-day horizon. Do not restore the earlier 1,000-event cap without measuring function duration and queue value.
- Ticketmaster reads are bounded to 300 candidates per market over 180 days and run at most every 180 minutes; NWS reads are bounded to 200 active alerts at the market point and run every 15 minutes. A scheduled market job fetches only sources whose own cadence is due. Manual/recovery jobs may force all configured sources.
- Generate Signal Briefs only after deterministic scoring selects `review_now`. Cache on the stable snapshot hash, prompt version, and model so route renders never invoke the model. Generate at concurrency 3 after sync/backfill; a failed brief does not mark the event provider unhealthy.
- The authenticated route reads the latest brief per impact in the repository query. Do not add page-level ISR; new evidence and reviewer actions use normal server revalidation.
- Persist event candidates in small concurrent batches (currently six), while retaining idempotent provider IDs, canonical fingerprints, immutable versions/evidence, and source high-water marks.
- The first Tucson sequential baseline took four minutes for 329 events; scheduled ingestion must use the batched path and incremental high-water polling.
- Unknown PriceLabs booking vulnerability fails closed to Watchlist. Do not fill the human Needs Review queue from materiality alone.
- The PriceLabs vulnerability pass pages approved membership in 500-row windows and chunks listing/report lookups to 100 IDs. It reads at most 1,000 active future impacts per market, but performs the expensive listing join only for verified materiality-65+ candidates. Full-market coverage and scores remain deterministic in memory; stale non-candidates are reset to Watch.
- Persist only the top 25 exposed listings for each of the at-most-five selected review signals. `replace_market_signal_scoring` atomically replaces derived exposure rows and impact summaries in one set-based RPC. The full evaluated/exposed counts and top-three evidence snapshot remain on the impact; do not restore the event × listing evidence table as an exhaustive calculation log.
- The 1,000-listing scale harness (`pnpm benchmark:market-signals`) evaluates 300 impacts / 300,000 listing-event pairs, then persists at most 125 rows. The 2026-08-21 baseline completed in 49 ms with 52.9 MB heap and a 99.96% row reduction. Treat this as a regression harness, not a production latency SLA.
- The live five-market compaction reduced listing-exposure rows from 6,537 to 101 (98.45%) while preserving 18 Needs Review signals. Recheck this ratio when review-family or per-impact evidence caps change.
- The operator queue is capped at five distinct event families per market per scoring pass; the repository loads review/unwind rows before watch rows and the UI renders only the first 60 watch items. This is an operator attention budget, while immutable event/version/evidence history and aggregate scoring facts remain available.
- The Vercel scheduler wakes once per minute to drain one leased market job by default; source-level `cadence_minutes` (PredictHQ 60, Ticketmaster 180, NWS 15) prevents extra provider calls. Provider persistence runs sequentially to avoid cross-source canonical-fingerprint races; row persistence remains batched at six. Vulnerability and Signal Brief derivation run once after all healthy sources, not once per source. Increase `MARKET_SIGNALS_JOBS_PER_RUN` only after measuring worst-case provider duration inside the 300-second route budget. Inventory refresh jobs do not require an event provider and averaged 1.079 seconds across the five live pilot markets.

## Verification Checklist

When touching authenticated list/detail routes:

1. Run `pnpm typecheck`.
2. Navigate to the route logged in and confirm counts, filters, sort, row actions, and detail navigation.
3. For `ListingDialog`, open create/edit and confirm the Client Select populates after the expected loading state.
4. Check browser/dev output for failed requests after navigation.
