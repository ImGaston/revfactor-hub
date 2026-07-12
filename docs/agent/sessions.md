# Sessions — RevFactor Hub

Short rolling summaries of substantive agent work. Keep entries compact and delete or condense stale detail when this file grows.

## 2026-07-12 — Lead outcome + attribution UI (migration 044)

- Aaron confirmed the landing's real payload and offered to send JSON matching our schema, so attribution needed almost no code — just the field contract (his `landing` → our `landing_page`) and a new `msclkid` column. His two API asks (stage timestamps, queryable gclid) were already live from 043.
- Migration 044 (**applied to prod**): `lost_at`, `lost_reason`, `msclkid` (+ index) on `leads`. New `markLeadLost` action (archives + records reason) and `unarchiveLead` clears the lost fields on reactivate; `LEAD_LOST_REASONS`/`leadOutcome` in `lib/leads.ts`. `msclkid` added to `ATTRIBUTION_FIELDS`.
- API `/api/v1/leads`: new `outcome` = won→lost→open (won precedence), `is_won` kept as alias, `lost_reason` top-level, `msclkid` in `attribution`, `lost_at` in `timeline`.
- Lead detail (`lead-detail.tsx`): "Mark as Lost" action w/ reason select (hidden once won/lost), Lost banner, conditional Attribution block, Qualification block from `attribution_extra` ("PM · 12 properties"), and the stage-history timeline from `lead_stage_events` (fetched in `[id]/page.tsx`). CSV export gains outcome + attribution columns.
- **Verified**: typecheck clean; webhook with Aaron's real shape populates utm/gclid/msclkid columns and drops qualifier + `page`/`gbraid` into `attribution_extra`; API returns `outcome` lost/won/open with correct precedence and no `assembly_client_id` leak; security advisor shows no new findings. Browser UI check pending a logged-in session (dev server requires auth; didn't log in). Test data cleaned. **Pending: deploy.**

## 2026-07-10 — Assembly onboarding app production contract

- Audited the deployed RevFactor onboarding app against Hub's existing client, listing, Assembly, Stripe, and legacy onboarding models.
- Added additive migration `042_client_onboarding_runs.sql` for multi-run onboarding, child listing parentage, normalized per-listing pricing, run-scoped shared events/comps, questionnaire/readiness answers, client/team tasks, and Assembly file metadata.
- Added Hub TypeScript contracts for the new run records and documented the Assembly identity, Stripe entitlement, optimistic concurrency, and preview-to-production boundaries.
- Tightened migration 042 from blanket authenticated access to the existing onboarding permission model. Added separate exact draft/submitted JSON snapshots and a service-role-only, revision-checked autosave RPC so incomplete client drafts remain resumable without forcing partial data into analytical tables.
- Added guarded Stripe entitlement provisioning from explicit subscription or Price/Product metadata. It aggregates all billable subscriptions linked to a Hub client, creates deterministic initial/additional-property runs, and sends ambiguous decreases, active-draft changes, or child-only additions to manual review.
- Added Assembly attachment metadata and a submission-notification delivery outbox to migration 042. Files remain in Assembly Files; notification delivery is tracked per internal recipient and can fail/retry without changing the submitted run.
- Added a service-role-only internal verification RPC. It records the Assembly internal reviewer, verifies only client-submitted tasks, and atomically advances run status to `in_review` or `ready_for_launch` when all tasks are complete.
- The migration was authored and type-checked but not applied to a Supabase project; the current Hub onboarding UI remains on the legacy checklist tables.
## 2026-07-10 — Leads Read API + Full-Funnel Attribution (migration 043)

- Marketing asked for a read endpoint to tie lead source → booked call → closed deal. The blocker was data, not the endpoint: no UTMs, no stage history, no conversion timestamp. Migration 043 adds nine attribution columns + `attribution_extra` jsonb, `converted_at`, `lead_stage_events` (written by a `SECURITY DEFINER` trigger so admin-client writes are captured), the first `updated_at` trigger on `leads`, and the `api_keys` table. Won = `assembly_client_id IS NOT NULL`.
- New: `GET /api/v1/leads` (keyset pagination, `updated_since`, per-lead `attribution` + `timeline`), `lib/api-auth.server.ts` (Bearer `rvf_live_…` → sha256 lookup → scope check), `lib/lead-attribution.ts`, `scripts/create-api-key.ts` / `revoke-api-key.ts`. `new-lead` webhook extended backward-compatibly; `createAssemblyClientForLead` now stamps `converted_at`.
- **Applied to production and verified end-to-end.** 139/139 leads backfilled with one synthetic event, 15 `converted_at`. Trigger tested: stage changes recorded, non-stage updates and same-stage writes produce none, a regression + re-entry keeps the first milestone, `changed_by` captures `auth.uid()` for UI users and stays null for webhook writes. API tested: 401/403/400/200, keyset walk covers 139 unique across 3 pages, `is_won` = 15, and the projection leaks none of `description`/`project_name`/`assembly_client_id`. Webhook tested: old email-only body still 201, dedupe backfills attribution first-touch-only, top-level overrides nested, unknown keys land in `attribution_extra`. Test rows and temp keys deleted.
- Supabase security advisor surfaced two issues introduced here, both fixed in a follow-up migration and re-verified: `set_updated_at` had a mutable `search_path`, and both trigger functions were exposed as PostgREST RPCs (`REVOKE EXECUTE`; Postgres checks EXECUTE at `CREATE TRIGGER` time, not at fire time, so the triggers still fire — confirmed under `role authenticated`).
- Behavior note: the `updated_at` trigger means kanban reordering (`sort_order` writes) now bumps `updated_at`, so reordered leads reappear in marketing's incremental sync. Harmless — their sync is an upsert.
- Docs: `project-map.md`, `conventions.md`, `integrations.md`, `decisions.md`, and a full rewrite of `docs/webhook-pipeline-integration.md` (which had documented `project_name`/`full_name` as required — the code never enforced that). That file is the contract to hand to marketing.
- **Pending:** deploy, then issue marketing's key with `scripts/create-api-key.ts`. Deferred: a Settings → API Keys UI.

## 2026-07-09 — Lead Webhooks: Verified Scheduler, Implemented new-lead

- Audited scheduler → pipeline flow end-to-end: `revfactor-scheduler` already forwards bookings (`src/app/api/book/route.ts`), Hub `/api/webhooks/scheduler` verified live in production (test POST created a Meeting lead, then deleted). Secrets match between both `.env.local`s. Open item: cannot verify `HUB_WEBHOOK_URL`/`HUB_WEBHOOK_SECRET` exist in the scheduler's Vercel production env (team `federico-zimermans-projects`); zero `lead_source='scheduler'` leads in prod DB.
- Implemented `app/api/webhooks/new-lead/route.ts` for generic landing-page leads (home email capture): email-only required, email dedupe against active leads, stage `inquiry`. `WEBHOOK_SECRET` generated in `.env.local`; **pending: add to Vercel + deploy**. Tested locally (401/400/201/200-deduped). `pnpm typecheck` clean. Docs: `docs/agent/integrations.md` rewritten for both webhooks.

## 2026-07-08 — SEO Metrics Upload: Partial/Single-Listing Exports

- Settings → Listings SEO upload now replaces rows scoped by download date **and** the Airbnb IDs in the file (`clearSeoMetricsForUploadAction`, ID list chunked ×200 for PostgREST URL limits; null-ID rows cleared only when the file has them). Single-listing Rankbreeze exports refresh just that listing instead of wiping the date's snapshot.
- Same uploader/UI handles full and partial files (the preview badge already shows listing count); card description updated. `pnpm typecheck` clean.

## 2026-07-08 — Rankbreeze Link on Listing Detail

- Listing detail header (`listings/[id]/listing-detail.tsx`) gains a Rankbreeze button next to Airbnb/PriceLabs: outline button to `app.rankbreeze.com/rankings/<rankbreeze_id>` when the association exists; amber alert variant (AlertTriangle, tooltip → Settings → Listings SEO upload) linking to the rankings home when it doesn't.
- `listings/[id]/page.tsx` derives `rankbreezeId` from `seo_metrics_raw` in parallel with `getListingReport`, matching `airbnb_id` against `listing_id` and the numeric ID in `airbnb_link` (newest row wins; `idx_seo_raw_airbnb` already existed).
- Migration `040_seo_metrics_read_policy.sql` applied to prod: SELECT policy on `seo_metrics_raw` via `has_permission('listings','view')`.
- Verified both states in the browser; `pnpm typecheck` clean.

## 2026-07-06 — Adjustments Types & Origin (spec v0.1)

- Migration `039_adjustments_types_origin.sql` (written, **not yet applied**): renames `adjustments.tag` → `type`, widens the CHECK to 12 values, adds `origin` (`client`/`internal`/`hostpricing`, default `internal`). Must be applied back-to-back with the deploy (old code selects `tag`).
- `lib/adjustments.ts`: `ADJUSTMENT_TYPES` (12 spec labels), `ADJUSTMENT_ORIGINS`, `ADJUSTMENT_TYPE_CONFIG` per-type field config (shows/requires target, dates, booking window + dynamic placeholder), shared `validateAdjustmentInput()` normalizer used by both the dialog and the server actions, `isEscalated()`, `adjustmentStatusLabelFor()` ("Pending approval" for hostpricing+open), `SETUP_CONTROL_CHECKLIST`.
- Dialog: Type + Origin selects, conditional fields per type, setup mode (forced single_listing, hidden target/dates/booking window), owner-message hint when `origin=client`, values preserved on type switch (server nulls hidden fields on save).
- Queue: "client escalation" flag (high urgency + client origin, sorts first within high), origin badge for non-internal, hostpricing approve/deny labels, setup verify hint in Awaiting control. Card: origin line, escalation badge, "Approve proposal"/"Deny" for proposals, static setup checklist before Confirm control. Public shell exposes `type` but **not** `origin`.
- `pnpm typecheck` clean; decisions recorded in `decisions.md` (2026-07-06).

## 2026-07-03 — Adjustments Queue UX (filter, edit, inline control, collapsed closed)

- `/adjustments` gains: client filter (Select over clients present in the data, filters all three sections), Edit menu item + edit mode in `AdjustmentDialog` (only while status ∈ `OPEN_STATUSES`; `updateAdjustment` server action re-checks status server-side), inline "PriceLabs" link + "Confirm control" button on Awaiting-control rows (control still permission-gated via `canControl`), and Recently closed collapsed to 3 rows with a Show all/Show less toggle (`collapsedLimit` prop on `QueueSection`).
- `AdjustmentDialog` save is wrapped in try/finally so a thrown server action doesn't leave the button stuck on "Saving…". The listing auto-pick effect now preserves a prefilled listing that belongs to the selected client.
- Verified E2E in the local app with temp SQL rows (deleted after): edit prefill+save persisted, Confirm control set `reviewer_id`/`controlled_at`, filter and collapse behaved; `pnpm typecheck` clean. Note: newly added server actions 500 under Turbopack HMR (`reading 'apply'`) until the dev server restarts.

## 2026-07-03 — Airbnb OG Image on Adjustments Share Card

- `/a/[token]` `generateMetadata` now scrapes the Airbnb room page's `og:image` for single-listing adjustments so WhatsApp previews show the listing photo; portfolio scope / scrape failure falls back to the RevFactor logo.
- New `lib/airbnb-og.server.ts` (browser UA required, 24h Next data cache, 4s race timeout, no DB persistence) and `airbnbRoomUrl()` in `lib/adjustments.ts`. Details in `integrations.md`.
- Verified locally: curl of the share page returns the `a0.muscache.com` image in the meta tag; `pnpm typecheck` clean.

## 2026-07-03 — RLS Hardening (038) Before India Contractor Accounts

- Migration `038_rls_hardening.sql` (written + applied to prod via Supabase MCP): all `USING (true)` SELECT policies → `has_permission(resource,'view')` (019 pattern); leftover `USING (true)` writes on tasks/leads/roadmap/knowledge/onboarding-progress → `create`/`edit`/`delete`; author-own comment INSERTs now also require the module's `view`.
- Found and fixed two extra holes while auditing `pg_policies`: users could self-promote via `UPDATE profiles SET role=…` (now blocked by `profiles_role_guard` trigger, super_admin/admin-client exempt), and `post_with_counts`/`knowledge_category_article_counts`/`seo_metrics` were definer views bypassing RLS (now `security_invoker = true`).
- New `clients_basic` definer view (`id, name, status`) + switched the Adjustments queue and `/a/[token]` authed queries from `clients(id, name)` to `clients:clients_basic(id, name)` so contractors resolve client names without reading `clients` (billing, `dashboard_token`, emails stay locked behind `clients:view`). PostgREST embeds the view through the underlying FK without hints.
- `financial_*` and `expense_listing_allocations` were already super_admin-only (`ALL` policies); `notes`/`calendar_events` tables don't exist (resources only); `pricelabs_reservations_airbnb`/`seo_metrics_raw` are RLS-enabled with no policies (deny; admin-client only).
- Verified with a temp SQL-created user (deleted after, no orphan rows): as super_admin — dashboard, clients (+detail with billing/credentials), listings, financials, tasks, pipeline, adjustments, roadmap, knowledge, onboarding, `/a/<token>` all render with data; `pnpm typecheck` clean. As contractor — REST with the user's JWT returns `[]` on 28 sensitive tables and errors on role PATCH / tasks / leads inserts; UI sidebar = Dashboard/Adjustments/Settings, queue + card fully operable (posted note, marked resolved, no control button), `/financials` redirects, dashboard degrades to zeros without crashing.
- Docs updated: decisions.md (closure entry + accepted residuals incl. admin's `financials:view=true`), conventions.md (permission-based RLS rules, `clients_basic`, role-guard trigger, `security_invoker` default), project-map.md (038 + views), CLAUDE.md/AGENTS.md (critical rule, kept identical). **India contractor accounts are now unblocked**; `WHATSAPP_GROUP_INVITE_URL` in Vercel prod still pending.

## 2026-07-03 — Adjustments Module (v1)

- New module converting WhatsApp change requests into atomic, traceable records. Migration `037_adjustments.sql`: `adjustments` + `adjustment_comments` tables, RLS via `has_permission('adjustments', …)`, seeds for super_admin/admin, and a widened `role_permissions.action` CHECK adding `publish` (fixing code/DB drift from the knowledge module) and the new `control` action.
- Flow: create dialog (lazy-fetched client/listing options; single-listing clients auto-select) → on save copies the `/a/<public_token>` share link and opens the WhatsApp group (`WHATSAPP_GROUP_INVITE_URL` env; a single deep-link can't open a group AND pre-fill text) → team opens the card → resolver marks `resolved` → an internal with `adjustments:control` marks `controlled`. `issue`/`rejected` require a note (enforced in the server action, stored as a comment). "Copy WhatsApp update" builds the ✅ close-the-loop message.
- `/a/[token]` is "public shell + authed core" on one URL: `generateMetadata` OG tags (first OG use in the repo; client+listing shown by decision) + non-sensitive read-only shell fetched with the admin client (RLS blocks anon), full card with notes/actions behind a session. `proxy.ts` now exempts `/a/` and `/api/` (see decisions.md — the `/api/` interception was also breaking webhook-style auth).
- Triage queue at `/adjustments`: open items by urgency+age with stale flags (high urgency ≥2 days), "awaiting control" mini-queue, recently closed; `loading.tsx` skeleton. Per-client changelog card appended on `clients/[id]`. Sidebar is now permission-filtered (`resource:view`) with an Adjustments item; backfilled missing `knowledge` rows for admin/super_admin in the live `role_permissions` so nothing disappears.
- Verified: `pnpm typecheck` clean; public shell, OG meta, PriceLabs/Airbnb-multicalendar shortcuts (both the pricelabs_link and airbnb_link-regex paths), 404 on bad token, and webhook 401-not-redirect all confirmed live with a temporary DB row (deleted after). Authed views (queue, create dialog, card actions, client block) compile but need a logged-in visual pass — no credentials in the preview browser.
- Contractor role created same day (`adjustments:view` + `edit` only — `control` deliberately withheld so India can't self-control; an initial all-actions toggle was corrected). Portfolio-scope cards ship without a per-listing shortcut and that's final — the plan's "group URL" open item turned out to be the WhatsApp invite (configured via `WHATSAPP_GROUP_INVITE_URL`), not a PriceLabs group view.
- Pending: RLS hardening BEFORE creating India accounts (decisions.md 2026-07-03); set `WHATSAPP_GROUP_INVITE_URL` in Vercel prod.

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
