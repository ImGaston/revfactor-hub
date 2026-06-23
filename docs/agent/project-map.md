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

## Components and Libraries

- `components/ui/` — shadcn/ui components.
- `components/layout/` — sidebar, top bar, breadcrumb context.
- `components/dashboard/pacing-chart.tsx` — forward stacked bar pacing chart with recency buckets and KPI highlights.
- `components/clients/` — client cards, tables, detail panels, credentials, add-listing dialog, and the private Pricing Dashboard copy action.
- `components/listings/listing-form-fields.tsx` — shared listing form fields (Name, City, State selector, Airbnb ID, PriceLabs/Listing ID) + helpers, reused by every add/edit-listing surface. `lib/us-states.ts` holds the US state codes.
- `components/kanban/` — generic typed kanban board and cards using `@hello-pangea/dnd`.
- `components/theme-provider.tsx` and `theme-toggle.tsx` — theme support.
- `lib/supabase/client.ts` — browser Supabase client.
- `lib/supabase/server.ts` — server Supabase client with cookies.
- `lib/supabase/admin.ts` — service-role admin client.
- `lib/profile.ts`, `lib/permissions.ts`, `lib/permissions.server.ts`, `lib/types.ts`, `lib/utils.ts` — shared profile, permission, type, utility helpers.
- `lib/assembly.ts`, `lib/pricelabs.ts`, `lib/stripe.ts`, `lib/pacing.ts`, `lib/pacing-mock.ts` — integration and data-layer helpers.
- `lib/report-builder/` — PriceLabs Report Builder: `client.ts` (3-call API), `schema.ts` (API→snake_case rename + 20/35 split + period parse), `ingest.ts` (resolve client, chunked upsert, prune), `runner.ts` (`advanceReportBuilder` state machine), `queries.ts` (`getListingReport` for the detail page).
- `lib/financial-planning.ts` — cent-based Profit First allocation, scenario forecast, runway, and allocation validation.
- `lib/client-stripe-billing.ts` — derives each client's current monthly Billing from Stripe customers linked through `client_stripe_customers`.
- `lib/bank-import.ts` — pure, client+server-safe Relay CSV parser, transaction classifier, vendor-category/recurring/payout matchers, and dedupe-hash builder for the bank statement import.

## Database Tables

- Auth/profile: `profiles`, `roles`, `role_permissions`.
- Client/listing ops: `clients`, `listings`, `client_credentials`, `tasks`, `task_listings`. `clients.dashboard_url` stores each client's private Pricing Dashboard link.
- Product planning: `roadmap_items`, ideas/posts tables, comments, votes, boards/tags.
- Onboarding: `onboarding_steps`, onboarding templates/progress/resources/comments.
- Sales pipeline: `leads`, `lead_tags`, `lead_tag_assignments`, `lead_team_assignments`, `lead_notes`.
- Financials: `expenses`, `expense_categories`, `recurring_expenses`, `expense_listing_allocations`, `stripe_subscriptions`, `stripe_invoices`, `stripe_payouts`, `stripe_payout_transactions`, `client_stripe_customers`, `financial_cash_snapshots`, `financial_scenarios`, `financial_scenario_listings`, `financial_scenario_events`, `financial_scenario_event_allocations`.
- Bank reconciliation: `bank_accounts` (seeded internal accounts + Profit First role), `bank_statement_imports` (per-file audit), `bank_transactions` (classified rows; links to `stripe_payouts` and `expenses`). `expenses.bank_transaction_id` links bank-created expenses. UI: Financials **Bank** tab → `bank-section.tsx`, `bank-import-dialog.tsx`, shared `bank-flow.ts`.
- Calendar/notes: `calendar_events`, `notes`.
- Pacing/PMS foundation: `reservations` is defined in migration `023_reservations.sql` but not yet applied to the dev Supabase project.
- Report Builder (migration `035_report_builder.sql`): `report_runs` (ingestion state machine + observability + pruned `raw_envelope`), `report_listings` (listing attrs, `listing_id` text PK), `report_metrics` (monthly metrics, grain listing × month × run), `report_group_overrides` (Group Name → client fallback). Adds `idx_listings_listing_id`.

## Storage, Views, and Scripts

- Supabase Storage: public `avatars` bucket organized by `{user_id}/`.
- Key views: `client_portfolio_summary`, `onboarding_progress`, and analytics/count views used by roadmap/knowledge features.
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
