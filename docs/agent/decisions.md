# Decisions — RevFactor Hub

Keep dated decisions here when they should shape future work. Include enough rationale to avoid relitigating the same choice.

## 2026-07-06 — Adjustments Types & Origin (spec v0.1, migration 039)

Implements the "Adjustments — Types & Fields Spec v0.1" (derived from the Hostpricing WhatsApp audit). Decisions confirmed with Gastón:

- **Column `tag` renamed to `type`** and widened from 7 to 12 CHECK values (`setup`, `min_stay`, `price`, `min_price`, `max_price`, `target_payout`, `checkin_checkout`, `discount`, `markup_fees`, `availability`, `review`, `other`). The old 7 values map 1:1 — no backfill. Rename chosen over keeping `tag` so code matches the spec vocabulary; `type` is non-reserved in Postgres and safe in PostgREST selects.
- **New `origin` column** (`client` / `internal` / `hostpricing`, NOT NULL default `internal`). `requested_by` stays as complementary free text. Origin analytics deliberately out of scope for v1 — capture now, exploit later.
- **Conditional field requirements are app-level only** (columns stay nullable): the shared `validateAdjustmentInput()` + `ADJUSTMENT_TYPE_CONFIG` in `lib/adjustments.ts` are the single source of truth for the dialog's `canSave` and the server actions, and the server normalizer nulls fields a type doesn't show. `setup` forces `single_listing` scope and requires the listing to exist in the Hub (data hygiene: Hub record first, then the setup ticket).
- **`origin=hostpricing` does NOT invert the two-step close** — no new states or permissions. `open` = proposal pending internal approval; internal moves it to `in_progress` (approve) or `rejected` (deny, note required); India applies and marks `resolved`; internal confirms `controlled`. Pure UI/labels layer ("Pending approval" badge, "Approve proposal"/"Deny" actions). HostPricing tickets are created by internal users on India's behalf; contractor keeps no `adjustments:create`.
- **Setup reviewer = anyone with `adjustments:control`** (no fixed-person rule, no new permission). The control step for `setup` shows a static, non-persisted checklist hint (markup, min/base price, LOS, promos, sync, access); persisted checklist deferred to v2 if the hint falls short.
- **`origin` is NOT exposed on the public shell** at `/a/<token>` — same sensitivity class as `requested_by` (leaks internal/contractor workflow to anyone holding the link). Authed card shows it.
- **Deploy ordering:** old code selects `tag`, new code selects `type`; migration 039 and the Vercel deploy must go out back-to-back (transient breakage window accepted for a 2–3-user internal tool; a two-phase zero-downtime migration was judged not worth it).

## 2026-07-03 — RLS Hardened to Permission-Based Policies (038); India Accounts Unblocked

Closes the commitment below. Migration `038_rls_hardening.sql` (applied to prod the same day) migrated every `TO authenticated USING (true)` SELECT — and the leftover `USING (true)` writes on tasks/leads/roadmap/knowledge/onboarding-progress — to `public.has_permission(<resource>, <action>)`. Resource mapping: `client_credentials`→`clients`, `stripe_*`/`bank_*`/`expenses`/`expense_categories`/`recurring_expenses`/`client_stripe_customers`/`dismissed_payment_issues`→`financials`, `leads`/`lead_*`→`pipeline`, `report_*`→`listings`, everything else to its own module resource. Also fixed in 038: (a) **privilege escalation** — any user could `UPDATE` their own `profiles.role` via REST; now blocked by the `profiles_role_guard` trigger unless super_admin (admin client exempt via `auth.uid() IS NULL`); (b) `post_with_counts`, `knowledge_category_article_counts`, and `seo_metrics` were definer views bypassing RLS — now `security_invoker = true`.

For the contractor's Adjustments flow: `adjustments`/`adjustment_comments` SELECT requires `adjustments:view`; `listings` SELECT allows `listings:view` OR `adjustments:view` (operational data, needed for card shortcuts); `clients` SELECT requires `clients:view`, and the queue/card queries join the new **`clients_basic` definer view (`id, name, status` only)** so contractors get client names without `billing_amount`, `stripe_dashboard`, `autopayment_set_up`, `dashboard_token`, or emails. Decided over (1) accepting the residual (leaks billing + dashboard_token) and (2) splitting financial columns into a `client_billing` table (bigger refactor for the same result). The Supabase linter flags `clients_basic` as a SECURITY DEFINER view — intentional, accepted.

Accepted residuals, documented on purpose: `profiles` (names/emails of the 2-3 internal users) and `roles`/`role_permissions` stay readable by any session (the layout needs them); **admin** can still read `financials`-mapped tables and `clients` financial columns via REST because admin has `clients:view` + `financials:view = true` in `role_permissions` — if that should tighten, flip admin's `financials:view` off in Settings → Roles (the `/financials` page is hardcoded super_admin regardless). Verified end-to-end with a temp user (deleted after): super_admin UI unchanged (all routes, billing, credentials, card); contractor REST returns `[]` for every sensitive table, role self-promotion raises, writes to tasks/leads violate RLS, sidebar shows only Dashboard/Adjustments/Settings, and the contractor can resolve + note an adjustment on `/a/<token>`.

## 2026-07-03 — Adjustments v1: UI-only Gating for the Future `contractor` Role; Harden RLS Before Creating India Accounts

Most tables' RLS SELECT policies are `TO authenticated USING (true)` — including `client_credentials` and `stripe_payouts` — so any hub account (including a future `contractor` role for the India team) can read them through the Supabase REST API regardless of what the UI hides. Decision (Gastón): ship Adjustments v1 with UI-only gating (permission-filtered sidebar + `adjustments:view` page checks) and **harden RLS before creating any contractor accounts** — migrate sensitive-table SELECT policies to `public.has_permission(resource, 'view')` following the `019_permission_based_rls.sql` pattern. Do not create India accounts until that migration lands. The `contractor` role exists (created 2026-07-03 via Settings → Roles) with exactly `adjustments:view` + `adjustments:edit` — NOT `control`/`delete`/`create`: `edit` is required to mark resolved/issue (RLS gates the UPDATE), while withholding `control` preserves the two-step closure (India cannot self-control its own work).

## 2026-07-03 — Adjustments: Custom `control` Permission Action; OG Preview Shows Client + Listing

The two-step closure (`resolved → controlled`, internal-only) is gated by a custom permission action `adjustments:control` rather than a hardcoded role list, per the "permission, not role" rule. Migration `037_adjustments.sql` widened the `role_permissions.action` CHECK to `('view','create','edit','delete','publish','control')` — this also fixed a latent drift: `publish` existed in `lib/permissions.ts` since the knowledge module but was never added to the DB constraint (role creation with a publish row would have violated it). The WhatsApp Open Graph preview intentionally shows full client + listing names (Gastón accepted the forward-outside-the-group leak risk in exchange for at-a-glance context in the chat). The public shell must never include `requested_by`, `origin_message`, notes, or people — those render only behind a session.

## 2026-07-03 — `proxy.ts` Exempts `/a/` and `/api/` From the Login Redirect

`proxy.ts` (Next 16's middleware replacement — note the filename when searching for "middleware") redirected every sessionless request to `/login`, which would have blocked WhatsApp's OG scraper on `/a/<token>` and was also intercepting webhook/cron endpoints that authenticate with their own secrets (`x-webhook-secret`, `CRON_SECRET`). Both prefixes are now exempt; `/a/` pages serve only non-sensitive fields until login, and `/api/` routes keep enforcing their own auth (verified: unauthenticated POST now gets the route's 401, not a 307 to /login).

## 2026-06-24 — Paginate Large `report_metrics` Reads (db-max-rows = 1000)

This Supabase project enforces PostgREST `db-max-rows = 1000`: a single select is capped at 1000 rows even with an explicit `.limit()` higher than that. A full Report Builder run is listing × month (~234 × 12 = 2.8k rows), so any unbounded or single-request read of `report_metrics` silently returns only the earliest ~4–5 months (ordered by `period`). For the Monthly Pacing chart that dropped exactly the near-future months where pickup lives, so the chart looked empty/flat with no error.

Decision: reads that can exceed 1000 rows must page with `.range(from, from+999)` under a stable total order (`period, listing_id`), looping until a short page. Implemented in `lib/monthly-pacing.ts` (`fetchAllMetrics`). If per-listing-month volume grows much larger, move the per-month aggregation into a Postgres RPC that returns ~12 rows instead of shipping the full grid to the client. Applies to any future `report_metrics` consumer (the listing detail report reads a single listing, so it stays under the cap).

## 2026-04-18 — No Page-Level ISR on Authenticated Routes

Authenticated route data should not use `export const revalidate = N`. The app has a tiny internal user base where stale data is noticeable, and auth-cookie cache segmentation limits hit rate. If a query later proves expensive and stable, use targeted cache tags instead.

## 2026-04-18 — Trim List Queries Instead of Adding Client Portfolio SQL View

For `/clients` and `/listings`, list payload trimming is preferred over adding `client_portfolio_summary` as a new SQL dependency. Current scale is small enough, and the view would add RLS/type maintenance surface.

## 2026-04-18 — Lazy-Fetch Dialog Lookup Data

Dialog-only lookup lists, such as clients in listing dialogs, should load when the dialog opens instead of during page load. This keeps common route loads lean while preserving full dialog behavior.

## 2026-04-18 — Keep Detail Pages Unsplintered Unless a Specific Fetch Gets Slow

Do not refactor large interactive detail pages into streamed server shells by default. The complexity is not justified for current dataset sizes.

## 2026-06-23 — Report Builder Lands in Native Supabase Tables, Not BigQuery

The PriceLabs Report Builder monthly grid (234 listings × 12 months = ~2,808 rows/run) goes into three native Supabase tables (`report_listings`, `report_metrics`, `report_runs`) plus a `report_group_overrides` fallback — not BigQuery. STLY/LY/YoY arrive precalculated and the volume is tiny, so a native typed table is simpler and type-safe; BigQuery stays for the daily `pl_*` firehose. `report_metrics` keeps per-run history (unique `listing_id+period+report_run_id`); the dashboard reads the latest completed run. `Listing ID` is `text` (heterogeneous UUIDs + 19-digit ints that overflow bigint). One API call covers the whole portfolio. The rename to snake_case lives only in `lib/report-builder/schema.ts`.

## 2026-06-23 — Report Builder Orchestration: Chained onto the PriceLabs Cron + Manual Resume (Hobby-safe)

The async flow (trigger → 30-min poll window → ingest) must not hang a Vercel function. `advanceReportBuilder` is an idempotent state machine that reaps expired runs, resumes an in-window polling run, or triggers + bounded-inline-polls. It is **chained onto the existing daily `sync-pricelabs` cron** (08:00 UTC) instead of adding a new cron job — keeps us at 2 crons (Hobby cap) and reuses the same `PRICELABS_API_KEY`. The chained call passes `inlineDeadlineMs` = remaining function budget so the combined run stays under `maxDuration 60`. A manual **Sync Report Builder** button runs the same logic so a human can close out a slow report within the 30-min window; `/api/cron/report-builder` stays as an unscheduled on-demand endpoint. `raw_envelope` is kept only for the last 30 completed runs. If reports routinely exceed the inline window, add a Pro per-minute resume cron — do not block a function waiting.

## 2026-06-04 — Shared Agent Memory Lives in `docs/agent/`

Project memory for Codex and Claude is versioned in `docs/agent/`, while root `AGENTS.md` and `CLAUDE.md` stay short routing files. `.claude/` remains local/ignored and is not the shared source of truth.

## 2026-06-04 — Do Not Store Personal Memory in Repo Docs

The repo should store system, technical, product, and workflow memory only. Personal profile facts, private preferences, secrets, tokens, credentials, and customer-sensitive details do not belong in versioned agent memory.

## 2026-06-15 — Financial Overview Is a Cash Operating View

Financial Overview uses paid Stripe payouts by arrival date as cash received. It must not label paid invoices or payout cash as an accrual P&L. Invoice data remains supporting subscription context.

## 2026-06-15 — Profit First Is Applied Per Payout

Each paid payout is allocated in integer cents: 30% to each partner, 15% to TAX, and the exact remaining cents to OPEX. Expenses are compared against OPEX; they are not deducted before partner/TAX allocations.

## 2026-06-15 — Planning Scenarios Are Isolated Snapshots

Saved planning scenarios copy current listings, subscription run rate, and recurring expenses into editable scenario rows. Scenario changes never mutate actual listings, subscriptions, expenses, or Stripe data. Capital contributions affect cash only and stay outside Profit First.

## 2026-06-15 — Bank Statements Will Reconcile Cash, Not Replace Stripe

The next Financials phase will ingest statement exports from the payout-receiving bank account and the OPEX account. Bank data should confirm Stripe deposits, Profit First transfers, internal account movements, and actual OPEX spending. Stripe remains the source for subscriptions and payout batches; bank statements become the source for settled balances and bank-side transactions. Internal transfers must be identified so they are not counted as revenue or expense twice.

## 2026-06-15 — Costs Managed Only Through Expenses (Recurring Tab Removed)

Operating costs are now managed solely through the `expenses` ledger. Removed the Financials **Recurring** tab, `recurring-expenses-table.tsx`, `recurring-expense-dialog.tsx`, and the recurring server actions (`createRecurringExpense`, `updateRecurringExpense`, `deleteRecurringExpense`, `toggleRecurringExpenseActive`, `generateMonthExpenses`). The Overview "Operating outlook" forecast now uses **real expenses** (trailing 3-month average of actual `expenses`) instead of a recurring-expense template. The `recurring_expenses` table is retained (not dropped) and the bank import's vendor/recurring auto-match stays in place but is dormant (no rows will be created); `getPlanningData` still reads the table to seed scenarios. Remove the dormant recurring references later if desired.

## 2026-06-15 — Payout→Subscription Linkage Via payment_intent (Preview API)

Under Stripe API `2026-05-27.preview`, `charge.invoice` and top-level `invoice.subscription` no longer exist, so the payout reconciliation could not set `stripe_payout_transactions.subscription_id` (all 1,369 rows were null), which left the Overview "Listing unit economics" table permanently empty even though 187/215 listings were linked to subscriptions. `lib/stripe-sync.ts` now reads the subscription from `invoice.parent.subscription_details.subscription`, builds a `payment_intent → subscription` map from invoice `payments[]` (`expand: ['data.payments']`), and resolves each balance transaction by its charge `payment_intent` with a single-subscription `customer` fallback. Existing rows were backfilled in place (548 resolved; the rest are non-subscription entries — fees, the payout line, balance holds, refunds). Re-syncing skips already-reconciled payouts, so a one-time backfill is required when this resolution logic changes.

## 2026-06-15 — Bank Import: Relay Transaction Type Is the Classifier; Spends Auto-Create Linked Expenses

Implemented in `033_bank_statements.sql` and `lib/bank-import.ts`. Relay's `Transaction Type` column is the deterministic classifier (`Receive`=income, `Spend`=expense, `*-transfer`=internal/Profit First, excluded). A transfer's destination `Account #` maps to a seeded `bank_accounts.role` to distinguish `profit_first` from `internal_transfer`. Real `Spend` rows auto-create deduped `expenses` linked via `expenses.bank_transaction_id`, reusing the existing categories/allocations/recurring ledger rather than a parallel bank ledger. Idempotent re-import via `bank_transactions.dedupe_hash` (includes running balance). Stripe deposits reconcile to `stripe_payouts` by amount + arrival date (±3 days); Stripe stays the source for subscriptions and payouts. CSV-only for now (no XLSX dependency). Verified against May 2026 Relay exports: 18 Stripe deposits matched, $50 bonus left unmatched, 57+19 transfers excluded, 9 OPEX expenses ($3,441.09) auto-created and categorized.
