# Sessions — RevFactor Hub

Short rolling summaries of substantive agent work. Keep entries compact and delete or condense stale detail when this file grows.

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
