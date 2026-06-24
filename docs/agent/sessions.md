# Sessions — RevFactor Hub

Short rolling summaries of substantive agent work. Keep entries compact and delete or condense stale detail when this file grows.

## 2026-06-24 — Monthly Pacing Chart

- Added a monthly stacked-column pacing chart to the dashboard home, mirroring the daily Pacing chart but built on `report_metrics` (Report Builder monthly grid).
- New files: `lib/monthly-pacing.ts` (fetch + aggregate), `components/dashboard/monthly-pacing-chart.tsx`. Wired through `app/(authenticated)/page.tsx` → `dashboard-view.tsx`.
- Bar height = `adjusted_occupancy_pct`, stacked by booking recency using `occupancy_pickup_7d / 8_14d / 15_30d` (already non-overlapping) + a derived `older` residual; stack sums to occupancy. See `integrations.md` → Monthly Pacing.
- Verified: typecheck passes; occupancy values render and match SQL against the latest completed run.
- Fixed two follow-on bugs found while populating the chart:
  1. **Empty pickup metrics** — `METRIC_FIELD_MAP` in `lib/report-builder/schema.ts` mapped the 10 new 036 metrics to invented friendly labels (`Occupancy Pickup (7 Days)`) instead of the actual terse payload keys (`Occupancy Pickup 7`, `Num Booked Pickup 7`, `Market Penetration Index`, …). Wrong key → silent null → all-zero columns. Corrected the names and backfilled both completed runs from their stored `raw_envelope` via SQL (no PriceLabs re-call).
  2. **Only 5 of 12 months rendering** — `getMonthlyPacingSource` read `report_metrics` in one request; the project's PostgREST `db-max-rows = 1000` capped it to the earliest ~5 months. Switched to `.range()` pagination (`fetchAllMetrics`). See `decisions.md` (2026-06-24).
- Verified end-to-end in the browser: all 12 months render with booking-recency layering; pickup concentrated on near-future months as expected.
- Removed the old mock **daily** Pacing chart from the dashboard home (it only ever ran on `getMockPacingSource`): deleted `components/dashboard/pacing-chart.tsx` + `lib/pacing-mock.ts`, unwired from `page.tsx`/`dashboard-view.tsx`. Kept `lib/pacing.ts` (real reservations data layer, dormant, no UI) + migration 023 + seed script. Monthly Pacing is now the dashboard's only pacing chart.

## 2026-06-23 — PriceLabs Report Builder Integration

- New integration ingesting the PriceLabs Report Builder monthly grid (234 listings × 12 months, 20 listing + 35 month fields) into native Supabase tables, surfaced on each listing's detail page.
- Migration `035_report_builder.sql`: `report_runs` (state machine + observability + pruned `raw_envelope`), `report_listings` (`listing_id` text PK), `report_metrics` (grain listing × month × run, unique `listing_id+period+report_run_id`), `report_group_overrides`; adds `idx_listings_listing_id`; RLS = authenticated SELECT, writes via admin client.
- `lib/report-builder/`: `client.ts` (3-call API, poll keeps `/v1/` + `X-API-Key`), `schema.ts` (rename + 20/35 split + `Year Month`→period), `ingest.ts` (client resolution by Listing ID → Group Name override → name; chunked upsert; prune to last 30 envelopes), `runner.ts` (`advanceReportBuilder` idempotent state machine: reap/resume/trigger + ~45s inline poll), `queries.ts` (`getListingReport`).
- Orchestration: **chained onto the existing `sync-pricelabs` cron** (08:00 UTC) — runs `advanceReportBuilder` after the `pl_*` sync with the remaining function budget (`inlineDeadlineMs`); no new cron job (stays at 2, Hobby cap). Manual **Sync Report Builder** button (same logic via `syncReportBuilderAction`); `/api/cron/report-builder` kept as an unscheduled on-demand endpoint. Group-override management UI in Settings → Listings. Template pinned via `PRICELABS_REPORT_TEMPLATE_ID` (12127), else resolved by name.
- Display: `listings/[id]` Overview "Monthly Revenue" now uses real `rental_revenue`+YoY; new **Year Review** tab (Revenue/STLY/YoY, RevPAR vs market, RevPAR Index, occupancy, booking window). Degrades to empty/mock when no completed run matches.
- Verified: `pnpm typecheck` clean; `pnpm lint` clean for all new/changed files (pre-existing errors elsewhere untouched). NOT yet verified in-browser: needs migration `035` applied to Supabase + one sync run (live API). Confirmed by user: same `PRICELABS_API_KEY`, template id `12127`.
- NOTE: an early version wrote files to the main repo path instead of the worktree; corrected — all changes now live on branch `claude/vibrant-montalcini-b959fb`, main restored (its pre-existing `.gitignore` change left intact).

## 2026-06-22 — Reassign a Listing's Subscription

- Root cause of "can't see/change a listing's subscription": the Stripe sync listed subscriptions without `status: "all"`, so canceled subs never entered the `stripe_subscriptions` mirror and a listing linked to a since-canceled sub became invisible in Financials.
- Fixed the sync (`lib/stripe-sync.ts`) to mirror canceled subs, excluding `canceled`/`incomplete_expired` from the single-subscription payout-attribution fallback maps so reconciliation is unchanged.
- Added `setListingSubscription(listingId, subscriptionId|null)` action (only touches that listing; does not clear sub-mates like `linkSubscriptionToListings`).
- Listing detail page (`listings/[id]`) now shows a `super_admin`-only Subscription card + `change-listing-subscription-dialog.tsx` to view/reassign/clear the listing's subscription (current sub shown even if canceled/orphaned).
- `link-subscription-dialog.tsx` now names the *other* subscription a listing is attached to (customer + status) instead of a generic note; `subscriptions` array passed from the table and new-subscriptions section.
- Verified end-to-end in the running app: typecheck clean; the orphaned canceled link rendered as "Not found in Stripe / canceled"; reassigned the real case (Beach Rd | FL | Trey → `sub_1TjiRc…` K Properties) and confirmed in DB; Financials dialog showed "linked to Jane Ng · active".

## 2026-06-15 — Quick-add Listing inside Link-Subscription Dialog

- Added a "New listing for {client}" quick-add form inside `link-subscription-dialog.tsx` (shown when the subscription's customer maps to a Hub client). It calls the new `createListingForClient` action (inserts an active listing for the client, returns the id), auto-selects it, and `router.refresh()` so it appears in the list. Speeds up onboarding new clients with no listings.
- Verified typecheck clean / page renders; could not open the dialog via the automated preview (an environment quirk blocks opening dialogs in the New-subscriptions section — the untouched "Link existing" button also fails to open there), so visual confirmation is pending a real-browser click.

## 2026-06-15 — Removed Recurring Tab; Outlook Uses Real Expenses

- Removed the Financials Recurring tab and everything behind it (`recurring-expenses-table.tsx`, `recurring-expense-dialog.tsx`, and the 5 recurring server actions). Costs are managed only through `expenses`.
- "Operating outlook" forecast and its displayed monthly-expenses figure now use the trailing 3-month average of real expenses instead of the recurring-expense template. `recurring_expenses` table kept (bank import match + planning seeding remain but dormant). Verified live: tabs are Overview/Planning/Subscriptions/Expenses/Bank, outlook shows "Monthly expenses (avg. 3m) $5,273".

## 2026-06-15 — Unit Economics Monthly Evolution

- Added a month-by-month evolution (Jan of current year → current month) below the aggregate unit-economics card: a `ComposedChart` (contribution bars + margin % and OPEX restante % lines, dual axis) with the full monthly detail table rendered inline directly below the chart (no modal). Bumped `stripe_payout_transactions` fetch in `page.tsx` to `.limit(5000)` so the full year resolves.
- New index **OPEX restante %** = (25%-of-monthly-income OPEX budget − all month expenses) / budget; goes negative when costs exceed the Profit First OPEX bucket (e.g. April showed -27%). Extracted `buildListingCash(payoutIds)` helper reused by current-month and per-month series.
- Verified: typecheck clean; modal table shows correct Jan–Jun figures (e.g. May income $43,255 / contribution $38,092 / margin 98% / OPEX restante 68%). The recharts chart could not be visually confirmed — the preview viewport collapsed to ~1px this session, leaving all charts (including the pre-existing Cash trend) at 0 width; the chart reuses the existing proven ChartContainer pattern.

## 2026-06-15 — "Add to Expenses" Action on Bank Transactions

- Added `addBankTransactionToExpense` and a per-row "Add to expenses" button in the Bank tab for transactions without a linked expense (any flow class), so rows unchecked at import or misclassified can be pushed to Expenses post-import. Reuses the importer's category/recurring suggestion logic and links via `bank_transaction_id`. Verified live (creates linked expense; FK SET NULL restores the button on delete).

## 2026-06-15 — Unit Economics Aggregated; Unallocated Variable Expenses Hit Margin

- Reworked the Overview "Listing unit economics" from a per-listing table into an aggregate: listing count (with attributed cash), total cash / variable expenses / contribution + margin %, and per-listing averages.
- Variable expenses now reduce the total margin whether or not they are allocated to a listing (sum of all current-month variable expenses), so bank-imported variable spends impact margin without manual allocation. Removed the "variable expense has no listing allocation" attention alert. Verified live (143 listings, $28,736 cash, 100% margin with no June variable expenses yet).

## 2026-06-15 — Fix Listing Unit Economics (payout→subscription linkage)

- Diagnosed the empty "Listing unit economics" table: all `stripe_payout_transactions.subscription_id` were null because the `2026-05-27.preview` API dropped `charge.invoice` / top-level `invoice.subscription`; the table attributes payout cash to listings only through that field.
- Fixed `lib/stripe-sync.ts` to read `invoice.parent.subscription_details.subscription`, build a `payment_intent → subscription` map from invoice `payments[]`, and resolve transactions by charge `payment_intent` (single-subscription `customer` fallback). Softened the misleading empty-state copy.
- Backfilled existing rows in place (548 resolved; rest are non-subscription entries). Verified live: current-month unit economics now shows 142 rows, ~$28.7k cash attributed. Also changed the Expenses table to show "N listings" instead of listing names.

## 2026-06-15 — Bank Statement Import & Reconciliation

- Added Relay CSV bank statement integration: migration `033_bank_statements.sql` (`bank_accounts` seeded with roles, `bank_statement_imports`, `bank_transactions`, `expenses.bank_transaction_id`), pure `lib/bank-import.ts` (parser/classifier/matchers/dedupe), `commitBankImport` action, and a Financials **Bank** tab (`bank-section.tsx`, `bank-import-dialog.tsx`, `bank-flow.ts`) plus an Overview reconciliation strip.
- Classifier keys off Relay `Transaction Type`; transfers (Profit First + inter-account) are excluded; real spends auto-create deduped linked expenses with suggested categories and recurring matches; Stripe deposits reconcile to `stripe_payouts`. Stripe stays the source for subscriptions/payouts.
- Verified: migration applied to dev project, `pnpm typecheck` clean, engine run against the two real May exports produced exactly the expected split (18 deposits matched, $50 bonus unmatched, 76 transfers excluded, 9 expenses = $3,441.09), `/financials` route compiles/renders the Bank tree with no errors. Browser screenshot of the logged-in Bank tab pending a user login (magic-link signup disabled; did not bypass auth).

## 2026-06-15 — Financial Cash Overview and Planning

- Replaced invoice-based Overview metrics with paid Stripe payout cash, per-payout Profit First allocations, OPEX capacity, runway, reconciliation alerts, and listing unit economics.
- Extended the Stripe mirror and daily cron with payouts and reconciled balance transactions.
- Added exact listing allocation for variable expenses and saved 12-month scenarios with listings, expenses, growth investments, capital contributions, comparison charts, and monthly cash plans.
- Added manual operating/tax cash snapshots and kept all Financials data/actions `super_admin` only.
- Verified the live Supabase preview with 162 Stripe payouts and 1,369 reconciled balance transactions; payout sync now skips complete historical reconciliations and reports payout warnings in the UI.
- Changed Clients Billing to derive current monthly totals from Stripe subscriptions linked through `client_stripe_customers`, including list, detail, and CSV export.
- Removed listing-attribution warnings for accumulated payouts and made split variable expenses default to all active listings with an exact even allocation.
- Next phase: inspect payout-account and OPEX-account statement exports, then design bank transaction import, payout reconciliation, internal transfer detection, and OPEX classification.

## 2026-06-11 — Client Pricing Dashboard Link

- Added a compact Pricing Dashboard copy action to client detail pages using `clients.dashboard_url`.
- Added accessible copy confirmation, unavailable state, Clipboard API error handling, and a legacy copy fallback.
- Removed the client detail dependency on `dashboard_token` and kept private URLs out of logs and error messages.

## 2026-06-09 — PriceLabs Sync Diagnostics

- Centralized manual and cron PriceLabs synchronization in `lib/pricelabs-sync.ts`.
- Normalized non-numeric `"Unavailable"` values and invalid `"-"` dates to `null`.
- Added per-listing `synced`, `not_found`, and `failed` results, structured logs, and Settings sync status visibility.
- Preserved synchronization for duplicate PriceLabs IDs while logging duplicates for cleanup.

## 2026-06-05 — Client Detail Stripe Checkout

- Added a `super_admin`-only Stripe customer + subscription Checkout flow on client detail pages.
- Uses `client_stripe_customers` as the Stripe/client source of truth; `clients.stripe_customer_id` is not required.
- Subscription type options are deduced from existing Stripe subscriptions and active recurring prices.

## 2026-06-04 — Agent Memory Split

- Compared `AGENTS.md`, `CLAUDE.md`, and scoped authenticated docs.
- Synchronized missing Pacing Chart and reservations details into agent-facing documentation.
- Converted root `AGENTS.md` and `CLAUDE.md` into short routing files.
- Added shared durable memory under `docs/agent/` for project map, conventions, integrations, performance, decisions, and sessions.
- Replaced scoped authenticated agent files with pointers to shared performance/convention docs.

## 2026-04-18 — Authenticated Routes Performance Pass

- Documented query trimming for clients/listings list views.
- Established lazy dialog lookup data loading for listing dialogs.
- Added or documented loading skeleton expectations for authenticated list/detail routes.
- Captured rejected caching and streaming approaches for current scale.
