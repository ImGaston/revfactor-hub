# Project Map — RevFactor Hub

RevFactor Hub is an internal operations hub for a short-term rental revenue management consultancy. Phase 1 is for 2-3 internal users and is not client-facing.

## Stack

- Frontend: Next.js 16 App Router, React 19, shadcn/ui, Tailwind CSS v4
- Backend: Supabase PostgreSQL, Auth, Storage, Edge Functions
- Deployment: Vercel
- Package manager: pnpm

## App Structure

- `app/layout.tsx` — root layout with Sonner toaster and theme provider.
- `app/login/page.tsx` — password and magic-link login.
- `app/auth/callback/route.ts` — magic-link callback handler.
- `proxy.ts` — Next.js 16 middleware replacement for session refresh and auth redirects.
- `app/(authenticated)/layout.tsx` — authenticated shell with sidebar and top bar.
- `app/(authenticated)/page.tsx` and `dashboard-view.tsx` — dashboard home.
- `app/(authenticated)/clients/` — client list, detail pages, credentials server actions.
- `app/(authenticated)/listings/` — listings table and listing detail dashboard.
- `app/(authenticated)/tasks/` — task board, task dialog, task server actions.
- `app/(authenticated)/roadmap/` — ideas, roadmap kanban, votes, comments, post dialogs.
- `app/(authenticated)/pipeline/` — sales pipeline board/table/completed views, lead detail, import/export, Assembly contract actions.
- `app/(authenticated)/onboarding/` — client onboarding cards, resources, step actions.
- `app/(authenticated)/financials/` — super_admin-only payout cash dashboard, Profit First allocations, expenses, subscriptions, saved 12-month planning scenarios, and Relay bank statement import/reconciliation (Bank tab). (The Recurring-expenses tab was removed; costs are managed only through expenses.)
- `app/(authenticated)/settings/` — account, clients, listings, users, roles, boards/tags, onboarding settings.
- `app/(authenticated)/calendar/page.tsx` and `notes/page.tsx` — calendar and notes views.
- `app/(authenticated)/adjustments/` — Adjustments triage queue (open by urgency+age with stale flags and a "client escalation" flag for high-urgency client-origin rows, "awaiting control" mini-queue with inline PriceLabs link + one-click Confirm control + setup verify hint, recently closed collapsed to 3 with Show all), client filter, create/edit dialog (Type + Origin selects with per-type conditional fields from `ADJUSTMENT_TYPE_CONFIG`; `setup` forces single-listing and hides target/dates/booking window; create copies share link + opens the WhatsApp group; edit only while status is in `OPEN_STATUSES`, enforced in `updateAdjustment`), server actions. HostPricing-origin tickets in `open` read "Pending approval" with Approve/Deny labels (same statuses underneath).
- `app/a/[token]/page.tsx` — public adjustment card ("public shell + authed core" on the same URL): serves Open Graph meta and a read-only non-sensitive shell without a session (fetched via admin client by `public_token`; `proxy.ts` exempts `/a/` and `/api/` from the login redirect), and the full interactive card (notes, status transitions, resolver/control trail) when logged in.

## Components and Libraries

- `components/ui/` — shadcn/ui components.
- `components/layout/` — sidebar, top bar, breadcrumb context.
- `components/dashboard/monthly-pacing-chart.tsx` — the dashboard's pacing chart: monthly stacked columns (occupancy % by booking recency) built on `report_metrics`; data layer in `lib/monthly-pacing.ts`. (The old mock daily `pacing-chart.tsx` was removed 2026-06-24.)
- `components/clients/` — client cards, tables, detail panels, credentials, add-listing dialog, and the private Pricing Dashboard copy action.
- `components/listings/listing-form-fields.tsx` — shared listing form fields (Name, City, State selector, Airbnb ID, PriceLabs/Listing ID) + helpers, reused by every add/edit-listing surface. `lib/us-states.ts` holds the US state codes.
- `components/kanban/` — generic typed kanban board and cards using `@hello-pangea/dnd`.
- `components/theme-provider.tsx` and `theme-toggle.tsx` — theme support.
- `lib/supabase/client.ts` — browser Supabase client.
- `lib/supabase/server.ts` — server Supabase client with cookies.
- `lib/supabase/admin.ts` — service-role admin client.
- `lib/profile.ts`, `lib/permissions.ts`, `lib/permissions.server.ts`, `lib/types.ts`, `lib/utils.ts` — shared profile, permission, type, utility helpers.
- `lib/assembly.ts`, `lib/pricelabs.ts`, `lib/stripe.ts`, `lib/monthly-pacing.ts` — integration and data-layer helpers. (`lib/pacing.ts` is the dormant reservations-based daily-pacing data layer with no UI consumer; see integrations.md.)
- `lib/report-builder/` — PriceLabs Report Builder: `client.ts` (3-call API), `schema.ts` (API→snake_case rename + 20/35 split + period parse), `ingest.ts` (resolve client, chunked upsert, prune), `runner.ts` (`advanceReportBuilder` state machine), `queries.ts` (`getListingReport` for the detail page).
- `lib/financial-planning.ts` — cent-based Profit First allocation, scenario forecast, runway, and allocation validation.
- `lib/client-stripe-billing.ts` — derives each client's current monthly Billing from Stripe customers linked through `client_stripe_customers`.
- `lib/bank-import.ts` — pure, client+server-safe Relay CSV parser, transaction classifier, vendor-category/recurring/payout matchers, and dedupe-hash builder for the bank statement import.
- `lib/adjustments.ts` — client+server-safe Adjustments constants (12 types, origins, statuses, urgencies), `ADJUSTMENT_TYPE_CONFIG` per-type field rules + `validateAdjustmentInput()` shared normalizer (single source of truth for dialog `canSave` and server actions; nulls fields a type doesn't show), status invariants (`NOTE_REQUIRED_STATUSES`, `OPEN_STATUSES`, stale threshold), escalation/proposal helpers (`isEscalated`, `adjustmentStatusLabelFor`, `SETUP_CONTROL_CHECKLIST`), PriceLabs/Airbnb-multicalendar shortcut builders, share-URL and WhatsApp-update message builders. `components/adjustments/client-adjustments-card.tsx` is the per-client changelog block on client detail.

## Database Tables

- Auth/profile: `profiles`, `roles`, `role_permissions`.
- Client/listing ops: `clients`, `listings`, `client_credentials`, `tasks`, `task_listings`. `clients.dashboard_url` stores each client's private Pricing Dashboard link.
- Product planning: `roadmap_items`, ideas/posts tables, comments, votes, boards/tags.
- Onboarding: `onboarding_steps`, onboarding templates/progress/resources/comments.
- Sales pipeline: `leads`, `lead_tags`, `lead_tag_assignments`, `lead_team_assignments`, `lead_notes`.
- Financials: `expenses`, `expense_categories`, `recurring_expenses`, `expense_listing_allocations`, `stripe_subscriptions`, `stripe_invoices`, `stripe_payouts`, `stripe_payout_transactions`, `client_stripe_customers`, `financial_cash_snapshots`, `financial_scenarios`, `financial_scenario_listings`, `financial_scenario_events`, `financial_scenario_event_allocations`.
- Bank reconciliation: `bank_accounts` (seeded internal accounts + Profit First role), `bank_statement_imports` (per-file audit), `bank_transactions` (classified rows; links to `stripe_payouts` and `expenses`). `expenses.bank_transaction_id` links bank-created expenses. UI: Financials **Bank** tab → `bank-section.tsx`, `bank-import-dialog.tsx`, shared `bank-flow.ts`.
- Calendar/notes: `calendar_events`, `notes`.
- Adjustments (migrations `037_adjustments.sql`, `039_adjustments_types_origin.sql`): `adjustments` (change requests; `public_token` UUID drives the public share URL `/a/<token>`; two-step closure via `resolver_id/resolved_at` + `reviewer_id/controlled_at`; status TEXT CHECK `open|in_progress|resolved|controlled|issue|rejected`; `type` TEXT CHECK with 12 values `setup|min_stay|price|min_price|max_price|target_payout|checkin_checkout|discount|markup_fees|availability|review|other` — renamed from `tag` in 039; `origin` TEXT CHECK `client|internal|hostpricing` default `internal`, never exposed on the public shell) and `adjustment_comments` (task_comments-shaped notes). Permission resource `adjustments` with actions incl. the custom `control`; 037 also widened the `role_permissions.action` CHECK to add `publish` and `control`.
- Pacing/PMS foundation: `reservations` is defined in migration `023_reservations.sql` but not yet applied to the dev Supabase project.
- SEO metrics (created directly in Supabase, no migration): base table `seo_metrics_raw` is a near 1:1 dump of the Rankbreeze `listing-metrics` CSV (only Tags dropped) — cols `id` (PK), `download_date`, `airbnb_id`, `rankbreeze_id`, `listing_name`, `city`, `state`, `country`, `metric` (raw label), `guest_count`, `side` (`my listing`/`similar listing`), `period`, `value`. The read-side **VIEW** `seo_metrics` derives `metric_key` slugs (`city_rank`, `first_page_impressions`, `ctr`, `views`, `wishlists`, `booking_rate`, `overall_conversion`, `occupancy`, `adr`), normalizes `side` → `my`/`similar`, `NULLIF`s empty `period`, and LEFT JOINs `listings` on `airbnb_id` for `hub_listing_id`/`hub_client_id`+`listing_name`. **Write to `seo_metrics_raw`, never the view.** Loaded via Settings → Listings **SEO Metrics Upload** card (`seo-metrics-upload.tsx`): client parses with `lib/seo-metrics.ts` (`parseSeoMetricsCsv` → raw rows) then streams 2000-row chunks through `insertSeoMetricsChunkAction`; `clearSeoMetricsForUploadAction` first deletes rows scoped to the file's download date(s) **and** its Airbnb IDs (plus null-ID rows when the file has them), so re-uploading replaces rather than duplicates and partial/single-listing Rankbreeze exports refresh only their own listings without wiping the rest of that date's snapshot. Migration `040_seo_metrics_read_policy.sql` added a SELECT policy (`has_permission('listings','view')`); writes stay admin-client only. The listing detail page uses it to build the **Rankbreeze link** (`https://app.rankbreeze.com/rankings/<rankbreeze_id>`) by matching `airbnb_id` against both `listings.listing_id` and the numeric ID inside `airbnb_link` — beware: many `listings.listing_id` values are PriceLabs IDs or UUIDs, not Airbnb IDs, so `airbnb_link` is the more reliable join key (19 vs 210 of 251 listings matched, 2026-07-08).
- Report Builder (migration `035_report_builder.sql`): `report_runs` (ingestion state machine + observability + pruned `raw_envelope`), `report_listings` (listing attrs, `listing_id` text PK), `report_metrics` (monthly metrics, grain listing × month × run), `report_group_overrides` (Group Name → client fallback). Adds `idx_listings_listing_id`.
- RLS hardening (migration `038_rls_hardening.sql`, 2026-07-03): all SELECT/write policies are permission-based via `has_permission` (see `conventions.md` and `decisions.md`); adds the `clients_basic` view and the `profiles_role_guard` trigger.

## Storage, Views, and Scripts

- Supabase Storage: public `avatars` bucket organized by `{user_id}/`.
- Key views: `client_portfolio_summary`, `onboarding_progress`, and analytics/count views used by roadmap/knowledge features. `post_with_counts`, `knowledge_category_article_counts`, and `seo_metrics` are `security_invoker` (RLS of the querying user applies). `clients_basic` (`id, name, status`) is deliberately SECURITY DEFINER so Adjustments can show client names to roles without `clients:view`.
- Cron: `app/api/cron/sync-pricelabs/route.ts` (daily 8:00 UTC) also chains the Report Builder ingestion (`advanceReportBuilder`) after the `pl_*` sync, and `app/api/cron/sync-stripe/route.ts` (8:30 UTC). All authed with `CRON_SECRET`. `app/api/cron/report-builder/route.ts` stays as an on-demand endpoint (no scheduled cron) — same logic, also exposed via the manual button.
- Scripts: `scripts/migrate-airtable.ts`, `scripts/migrate-credentials.ts`, `scripts/check-missing-listings.ts`, `scripts/seed-reservations.ts`.

## Domain Terms

- ADR: Average Daily Rate, revenue divided by nights sold.
- RevPAR: Revenue Per Available Room, revenue divided by total available nights.
- Occupancy: percent of available nights booked.
- Pacing: how bookings track versus a comparison period or booking window.
- PMS: property management system, such as Hostaway or Hospitable.
- PriceLabs: dynamic pricing tool; listings have unique PriceLabs IDs.
- MPI: Market Performance Index, listing occupancy divided by market occupancy.
