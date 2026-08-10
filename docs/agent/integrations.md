# Integrations — RevFactor Hub

## AirROI

AirROI is the optional public-listing enrichment and pre-launch underwriting source for the Revenue Brief Builder.

- API base: `https://api.airroi.com`.
- Auth: `X-API-KEY` from server-only `AIRROI_API_KEY`; never expose the key to the browser.
- Client: `lib/airroi.server.ts`; pure response validation, Airbnb ID parsing, and deterministic draft mapping live in `lib/airroi.ts` and `lib/airroi-estimate.ts`.
- Hub route: authenticated `POST /api/revenue-briefs/airroi`, gated by `pipeline:view`, calls `GET /listings?listing_id=...&currency=native` once per explicit user request and returns a private/no-store draft.
- Pre-launch route: authenticated `POST /api/revenue-briefs/airroi/estimate`, also `pipeline:view`, calls `GET /calculator/estimate` with an address, 1–10 mile radius, `entire_home`, bedrooms, baths, and guests. The adapter accepts both documented AirROI response variants (nested OpenAPI comparables/monthly shares and flat tutorial comparables/monthly currency values) and normalizes them.
- Inputs: prospect name, exact property address, Airbnb listing URL, owner goals, and optional known constraints. Only `airbnb.com/rooms/<numeric-id>` URLs are accepted; the Hub extracts the ID instead of forwarding a user-controlled URL.
- Drafted facts: listing name/location, specs, rating/reviews, host/trust signals, visible amenities, booking settings, and owner-safe initial opportunity language. Demand drivers and RevFactor benchmarks remain manual analyst-review fields.
- Evidence boundary: existing-listing TTM revenue, ADR, occupancy, and RevPAR are internal third-party modeled estimates. For a not-yet-launched property, the PDF may present AirROI P25 as conservative, P50 as base, and P75 as strong execution, always labeled as market-informed scenarios rather than guaranteed income. AirROI returns up to 25 comps; the PDF shows at most five and requires analyst review.
- Persistence: no AirROI payload, proposal intake, or generated PDF is stored. Reusable partner brand profiles are the exception: normalized colors/co-brand mode/footer plus private logo and brand-manual assets persist in Supabase. Missing AirROI configuration disables research while preserving the manual existing-listing builder.

## Assembly CRM

Assembly is the client communication platform for CRM, messaging, and contracts.

- API base: `https://api.assembly.com/v1`.
- Auth: `X-API-KEY` header from server-only `ASSEMBLY_API_KEY`.
- API client: `lib/assembly.ts`; keep all Assembly calls server-side.
- Sync strategy: on-demand only; no webhooks, cron, background sync, or cache.
- Graceful degradation: if `ASSEMBLY_API_KEY` is missing, hide Assembly UI.
- Error handling: `assemblyFetch` reads response bodies on errors and logs details.

Client linking:

- Clients link to Assembly by email via `searchAssemblyClientByEmail`.
- Store `assembly_client_id` always and `assembly_company_id` if the client belongs to a company.
- Generate `assembly_link` based on company vs individual context.
- Server actions: `linkAssemblyClientAction`, `unlinkAssemblyClientAction` in settings clients actions.

Pipeline integration:

- `createAssemblyClientForLead(leadId)` finds or creates an Assembly client, sends portal invite, saves `assembly_client_id`, and creates a Hub client with status `onboarding`.
- `sendContractToAssembly(leadId, contractTemplateId)` creates a contract from a selected template, sends a welcome chat message, and marks `contract_sent`.
- **Both require `pipeline:control`, checked in code** (migration 041): they act outside RLS — the first inserts into `clients` with the admin client and emails a portal invite, the second sends a legal contract to the prospect. `pipeline:edit` alone must not reach them (the `marketing` role does not have `control`).
- Contract templates are fetched server-side and passed to lead detail for selection (skipped entirely when the user lacks `pipeline:control`).
- `full_name` splits into `givenName` and `familyName`; single-word names repeat for both fields.

Deep links:

- Individual chat: `https://dashboard.assembly.com/clients/users/details/{assembly_client_id}/messages`
- Company chat: `https://dashboard.assembly.com/companies/{assembly_company_id}/messages`
- Company chat is primary when a company exists; keep a separate Direct Chat link.

Pending Assembly work:

- Inline message reads, reusable message/contact components, Integrations settings tab, send-message dialog, bulk link, contract status polling, optional sent-message audit log.

Client onboarding Custom App contract:

- The client-facing app validates Assembly's encrypted session token on its own server with `@assembly-js/node-sdk`; never send `ASSEMBLY_API_KEY` to the browser.
- Resolve the Hub client by `assembly_company_id` first, then `assembly_client_id`. An internal Assembly identity may open the client surface, but `/internal` requires `internalUserId`.
- Migration `042_client_onboarding_runs.sql` is additive and run-based. It preserves the existing client-level checklist while supporting initial and additional-property runs, child listings, per-listing pricing, shared events/comps, knowledge notes, client/team task states, and Assembly file IDs.
- Stripe is authoritative for the run's primary/child listing entitlements. The app must not let clients edit those counts. After migration 042 is applied, enable the guarded daily entitlement provisioner with `ONBOARDING_ENTITLEMENT_SYNC_ENABLED=true`.
- Entitlement metadata is explicit, never inferred from price names. Either set subscription metadata `revfactor_primary_listings` and `revfactor_child_listings`, or set `revfactor_entitlement=primary_listing|child_listing` on each Stripe Price/Product and use line-item quantity. The sync aggregates every active subscription linked through `client_stripe_customers`.
- First payment creates one deterministic initial run. Later increases create an additional-property run only after prior runs are submitted. Decreases, child-only additions, and changes while a draft is active are reported for manual review instead of silently resizing client data.
- Upsert retries are idempotent through `onboarding_runs (client_id, external_key)`. Use optimistic concurrency through `revision`; a save updates only when the submitted revision matches, then increments it.
- The migration is a contract only until it is applied and the app's Supabase adapter is enabled. Keep the hosted app in explicit preview mode until then.

## Agent Studio and Vercel AI Gateway

The authenticated `/agent-studio` route is the internal pre-production environment for the RevFactor client-service agent.

- Runtime: Vercel AI SDK `ToolLoopAgent`, server-side only, using AI Gateway model IDs. The runtime requires an explicit five-field JSON result and applies a tested per-model reasoning level; do not assume one reasoning setting is portable across Gateway providers.
- Default model: `openai/gpt-5-nano`. Selectable low-cost comparisons are Gemini 2.5 Flash Lite, Qwen 3.5 Flash, and GPT-5 Mini; GPT-5.4 Mini, GPT-5.6 Luna, and Claude Sonnet 5 remain higher-cost benchmarks.
- Local auth: server-only `AI_GATEWAY_API_KEY`. Vercel deployments can authenticate Gateway via OIDC.
- Access: `agent_studio:view` (migration `049_agent_studio_permission.sql`); client options additionally respect `clients:view`.
- Client context: a synthetic fixture by default, or a deliberately limited real-client projection read through the current user's RLS. It includes operational identity/status, listing metrics, and open tasks; it excludes contact, financial, credential, note, and private-link fields.
- Knowledge: only published, client-safe, approved, agent-enabled Knowledge articles are searchable. Approved articles are section-aware chunked and embedded with `openai/text-embedding-3-small` through AI Gateway; the index is version-bound to `knowledge_articles.updated_at` and becomes stale after governed content changes. Hybrid retrieval combines Postgres full-text and cosine similarity, while exact keyword search remains a safe automatic fallback.
- Safety: immutable runtime instructions sit outside the session-editable draft instructions. The agent cannot write Supabase data or call Assembly, and the UI never presents a send action.
- Persistence: conversations, messages, runs, governed source snapshots, tool traces, and feedback are durable; browser-only draft edits reset with the session.
- Observability: each run exposes structured disposition/confidence, reviewer notes, exact retrieved passages, keyword/semantic/hybrid ranks, requested/effective retrieval mode, fallback reason, tool calls, duration, generation and embedding token usage, cost estimates using Gateway pricing snapshots, and a persistent failure reason when a provider run fails. `compare` mode supplies hybrid results to the responder while retaining both ranking paths for retrieval evaluation; it does not pay for a second response generation.
- Studio Coach: a separate structured review agent (`google/gemini-3.5-flash-lite`) examines one completed run and up to four recent runs from the same playbook, then returns grounded observations, teaching, a draft instruction patch, and an editable process workflow. It receives only the already-governed run snapshots, cannot call tools or modify production, persists its own token/cost ledger, and can create only a draft playbook version through the existing permissioned action.

Treat the pricing metadata as a display estimate, not billing truth; update `AGENT_STUDIO_MODELS` when Gateway pricing changes. Embedding price is refreshed hourly from the Gateway catalog with a pinned fallback estimate. Assembly sending remains intentionally absent and requires a separately authorized, human-approved path.

## PriceLabs

PriceLabs is the dynamic pricing tool.

- API base: `https://api.pricelabs.co/v1`.
- Auth: `X-API-Key` from server-only `PRICELABS_API_KEY`.
- API client: `lib/pricelabs.ts`.
- Shared sync service: `lib/pricelabs-sync.ts`; both the manual action and cron must use it.
- Sync strategy: Vercel cron at `/api/cron/sync-pricelabs` daily 8:00 UTC plus manual Settings > Listings sync.
- Matching: PriceLabs listing `id` matches `listings.listing_id`.
- Storage: synced metrics live as `pl_*` columns on `listings`.
- Occupancy values may arrive as strings like `"100 %"` and must be parsed with `parseOccupancy()`.
- Optional numeric fields may arrive as strings such as `"Unavailable"` and date fields may arrive as `"-"`; normalize these values to `null` before writing to Supabase.
- 30+ day occupancy fields use adjusted API prefixes, not plain `occupancy_*`.
- Sync results are tracked per Hub listing as `synced`, `not_found`, or `failed`; never discard Supabase update errors.
- Duplicate PriceLabs IDs update every matching Hub listing and emit a structured warning for cleanup.

Synced fields include base/min/max/recommended price, cleaning fees, bedrooms, 7/30/90-day occupancy and market occupancy, MPI 30/60, last booked date, weekend occupancy, push enabled, refreshed and synced timestamps.

Display:

- Listing detail shows real PriceLabs data with a green synced banner, or amber Preview when not synced.
- Listing cards on client detail pages use real Occ(7N), Occ(30N), MPI(30N), Last Booked.
- Settings > Listings shows the last successful PriceLabs sync and the current manual-run result for each listing.
- Reservations, pricing calendar, and pacing tabs still depend on PMS/reservations work.

### PriceLabs Report Builder

Net-new integration (migration `035_report_builder.sql`, `lib/report-builder/`) that ingests a **monthly** listing × month grid for the whole portfolio in a single API call — distinct from the daily `pl_*` current-state snapshot on `listings`.

- API base: `https://api.pricelabs.co/v1/report_builder`. Auth: `X-API-Key` from `PRICELABS_API_KEY` (same key as `lib/pricelabs.ts`). Client: `lib/report-builder/client.ts`.
- Three calls: `GET /templates` → `POST /data {template_id}` (inline data **or** `{request_id, status: IN_PROGRESS}`) → `POST /poll {request_id}` until `status: completed`. The poll endpoint **does** carry the `/v1/` prefix and **does** require `X-API-Key` (SwaggerHub omitted both → 404/401). The generation session expires **30 min** after `request_id` is issued.
- Always use the bounded **`rm-listings`** template (resolved by name, or pin via `PRICELABS_REPORT_TEMPLATE_ID`). Wide templates balloon to ~100 MB; the bounded one is ~4.4 MB for the whole portfolio.
- Payload shape (validated): envelope `{ data: { report_data[], report_currency }, request_id, error_reason }`; 234 listings × 12 months, 65 fields per row = 20 listing-level + 45 month-level (migration `036` added 10: market penetration index + booked-nights / occupancy / rental-revenue pickup windows). `Listing ID` is a heterogeneous STRING (huge Airbnb ints that overflow bigint AND UUIDs) → all keys are `text`. Period derives from `Year Month` (`"2026-01.Jan"` → `2026-01-01`), **not** the standalone `Year`. `report_currency` is per-run (USD today), only in the envelope.
- Tables: `report_runs` (async state machine + observability + pruned `raw_envelope`), `report_listings` (20 attrs, upsert by `listing_id` per run), `report_metrics` (45 typed metrics, grain listing × month × run, unique `listing_id+period+report_run_id`), `report_group_overrides` (Group Name → client fallback). No jsonb for live data.
- Rename API→snake_case lives **only** in `lib/report-builder/schema.ts` (`METRIC_FIELD_MAP`). `RevPar`→`rental_revpar`, `Average Market RevPar`→`market_revpar`, `Market Penetration RevPar Index`→`revpar_index`, `Occupancy`→`adjusted_occupancy_pct`, `ADR`→`rental_adr`, `Booking Window`→`median_booking_window`, `Available and Bookable dates Recommended Potential Revenue`→`potential_revenue_open_inventory`; STLY/LY/YoY follow the same pattern.
- **Field names are exact and sometimes terse — verify against `raw_envelope`, do not guess from the friendly column label.** The pickup/penetration metrics ship as `Occupancy Pickup 7`, `Occupancy Pickup 8 14`, `Occupancy Pickup 15 30`, `Num Booked Pickup 7/14/30`, `Rental Revenue Pickup 7/8 14/15 30`, `Market Penetration Index` — NOT `Occupancy Pickup (7 Days)` etc. A wrong key yields silent null (no error), so the column ingests as all-zero. The original 036 mapping guessed friendly labels and shipped all-zero until corrected 2026-06-24.
- Client resolution (`lib/report-builder/ingest.ts`): match `Listing ID` → `listings.listing_id` (hard key) → `client_id`; else Group Name via `report_group_overrides`, then exact `clients.name`; unresolved listings keep `group_name` as a label and are counted in `report_runs.unresolved_count`.
- Orchestration (Hobby-safe, no extra cron): the ingestion is **chained onto the existing daily `sync-pricelabs` cron** (08:00 UTC) — after the `pl_*` sync, `sync-pricelabs/route.ts` calls `advanceReportBuilder` with the time left in the function budget (`inlineDeadlineMs`, headroom under `maxDuration 60`). The state machine reaps expired polling runs, resumes an in-window one, else triggers + bounded inline polls. A manual **Sync Report Builder** button in Settings → Listings (`syncReportBuilderAction`) runs the same logic so a human can close out a slow report within the 30-min window. `app/api/cron/report-builder/route.ts` remains as an on-demand HTTP endpoint (CRON_SECRET) but has no schedule. If reports regularly exceed the inline window, add a Pro per-minute resume cron.
- Retention: `raw_envelope` kept only for the last 30 completed runs (pruned in `ingest.ts`); metadata of all runs is retained.
- Display: `listings/[id]` Overview "Monthly Revenue" uses real `rental_revenue` (with YoY) when a completed run exists; a new **Year Review** tab shows the monthly table (Revenue/STLY/YoY, RevPAR vs market, RevPAR Index, occupancy, booking window). Degrades to the mock/empty state when there's no matching run (`getListingReport` returns null; queries swallow missing-table errors).
- Snapshots (future): `report_runs.raw_envelope` of the last 30 runs is the intended source; not built yet.

## Stripe and Financials

- API client: `lib/stripe.ts`.
- Secret key: server-only `STRIPE_SECRET_KEY`.
- Financials page is server-side gated to `super_admin`.
- Client to Stripe customer links use the `client_stripe_customers` junction table as the source of truth; do not rely on `clients.stripe_customer_id`.
- Client Billing is derived from the sum of current monthly Stripe subscriptions for every Stripe customer linked through `client_stripe_customers`; the legacy `clients.billing_amount` value is not used for client list/detail reporting.
- Client detail pages let `super_admin` users create or reuse a Stripe customer from `client_stripe_customers`, choose a subscription type deduced from existing Stripe subscriptions, and generate a Checkout Session in `subscription` mode.
- Listings can link to subscriptions via `stripe_subscription_id`. The "Link Listings to Subscription" dialog (`link-subscription-dialog.tsx`) also has a quick-add form that creates a new active listing already associated to the subscription's linked client (`createListingForClient` action) and auto-selects it — for new clients with no listings yet. That dialog now labels a listing already attached to a *different* subscription with the real customer name + status (e.g. "linked to Jane Ng · active") instead of a generic note.
- A listing's subscription can also be viewed/reassigned from the **listing detail page** (`super_admin` only): `listings/[id]/page.tsx` passes the mirrored subscriptions + the client's Stripe customer ids, and `change-listing-subscription-dialog.tsx` lets you pick another subscription or clear it via the `setListingSubscription(listingId, subscriptionId|null)` action. Unlike `linkSubscriptionToListings` (which clears every listing of the target sub first), `setListingSubscription` touches only that one listing — correct when several listings share a subscription. If the listing's current `stripe_subscription_id` is not in the mirror, the card shows the raw id with a "Not found in Stripe / canceled" note.
- Daily Stripe sync uses API version `2026-05-27.preview` and mirrors subscriptions, invoices, payouts, and reconciled payout balance transactions. The subscription list uses `status: "all"` so **canceled subscriptions are mirrored too** (Stripe's default list omits them), keeping a listing's link to a since-canceled subscription visible in Financials. This does not affect Client Billing (filtered by `BILLABLE_SUBSCRIPTION_STATUSES`) or the "New subscriptions" card (filtered to active/trialing/past_due). The single-subscription payout-attribution fallback (`subCountByCustomer`/`subByCustomer` in `lib/stripe-sync.ts`) deliberately **excludes** `canceled` and `incomplete_expired` so adding canceled rows does not change reconciliation. Automatic payouts are reconciled only after Stripe reports `reconciliation_status = completed`.
- Stripe caps `expand` at 4 property levels, and on list endpoints the `data.` prefix counts as a level — `data.items.data.price.product` (5 levels) on `subscriptions.list` fails the whole request with "You cannot expand more than 4 levels of a property", aborting the entire sync (2026-07: this blocked all mirroring in production). The sync therefore expands only `data.customer` and fetches products separately (`products.list({ ids })` on the unique product ids), stitching each `Stripe.Product` into `sub.items.data[].price.product` before the subs upsert and entitlement detection (which reads `product.metadata.revfactor_entitlement` as a fallback to price metadata).
- When `ONBOARDING_ENTITLEMENT_SYNC_ENABLED=true`, the same daily sync runs `syncOnboardingEntitlements`. It provisions idempotent onboarding runs from explicit Stripe metadata and returns warnings alongside normal sync results; it is disabled by default so Hub can deploy safely before migration 042 is applied.
- Completed payouts are reconciled incrementally: mirrored transactions are reused when their net sum matches the Stripe payout amount, avoiding a full historical transaction download on every sync.
- Preview API object shapes: an invoice's subscription is at `invoice.parent.subscription_details.subscription` (the legacy top-level `invoice.subscription` is gone), and charges no longer expose `charge.invoice`. To link payout balance transactions to subscriptions, the sync builds a `payment_intent → subscription` map from each invoice's `payments[].payment.payment_intent` (list invoices with `expand: ['data.payments']`), then resolves each transaction's `subscription_id` from its charge `payment_intent`, falling back to a single-subscription `customer`. Without this, every `stripe_payout_transactions.subscription_id` is null and the Overview "Listing unit economics" table cannot attribute payout cash to listings (its empty state is not a linking problem).
- Financial Overview treats paid payouts grouped by `arrival_date` as cash received. Paid invoices remain available for subscription context but are not labeled as cash revenue.
- Profit First is calculated per payout in integer cents: 30% Partner A, 30% Partner B, 15% TAX, and the exact remainder to OPEX (target 25%).
- Stripe payouts are accumulated settlement batches across subscriptions. A payout that cannot be distributed directly to listings is not treated as an alert or accounting issue.
- Variable expenses can be assigned to one listing or split by exact cent amounts through `expense_listing_allocations`. Selecting split defaults to all active listings and divides the amount evenly, with exact cent reconciliation; users can then customize the allocation.
- Listing unit economics in the Overview is an aggregate (not per-listing rows): total cash, total variable expenses, total contribution + margin %, and per-listing averages. The listing count and the per-listing divisor are the **total active listings** (`listings.length`, constant across months) — there is no history of when each listing was added, so the current active set is applied to every month. Every current-month variable expense lowers the total margin even when it has no `expense_listing_allocations` (unallocated variable cost is absorbed at the portfolio level); allocation only affects per-listing attribution, not whether the cost counts.
- Below the aggregate there is a month-by-month evolution chart (January of the current year → current month) plus a "Ver detalle" modal with the full monthly table. It plots three series: total contribution ($, bar), margin % (contribution/attributed cash, line), and **OPEX restante %** = `(opexBudget − allMonthExpenses) / opexBudget`, where `opexBudget = allocateProfitFirst(monthIncome).opexCents` (25% Profit First) and `allMonthExpenses` is every expense dated that month (fixed + variable). OPEX restante % can go negative when monthly costs exceed the 25% OPEX budget. Cash attribution per month reuses the same payout-transaction→subscription→listing logic; months whose payouts are not yet reconciled show low/empty cash.
- Financial Planning stores editable 12-month scenarios. Capital contributions increase cash but are excluded from Profit First; fixed, variable, and growth investment events consume OPEX cash.
- Non-super_admin users may create/edit clients if permitted, but must not see or modify billing fields.
- The Overview tab shows a "Cobros pendientes o fallidos" alert card (`payment-issues-section.tsx`, classification in the pure `payment-issues.ts`) built from unpaid mirrored invoices (`stripe_invoices` with `status in (open, uncollectible)` and `amount_due > amount_paid`), refined by the related subscription status: **incompleto** = sub `incomplete`/`incomplete_expired`; **erróneo** = invoice `uncollectible` or sub `past_due`/`unpaid`; **pendiente** = the rest (open, awaiting payment). When the invoice's Stripe customer resolves to a Hub client via `client_stripe_customers`, a single button copies a client-facing English message (one template per state) and opens that client's `assembly_link` in a new tab; unlinked invoices show "Sin cliente".

### Bank statement integration (Relay CSV)

Implemented in migration `033_bank_statements.sql`, `lib/bank-import.ts`, the Financials **Bank** tab, and `commitBankImport` in financials `actions.ts`. Stripe stays the source of truth for subscriptions and payouts; bank data confirms settled cash and supplies actual OPEX spending.

- Input: Relay statement CSV exports (header `Date, Payee, Account #, Transaction Type, Description, Reference, Status, Amount, Currency, Balance`). CSV only for now; reuse the quote-aware parser in `lib/bank-import.ts`. Do not request or store online-banking credentials; do not commit statement values to repo docs.
- Classifier: Relay's `Transaction Type` is deterministic — `Receive` = external income, `Spend` = real expense, `*-transfer` = internal movement. A transfer whose counterparty `Account #` maps to a `partner`/`tax` `bank_accounts.role` is `profit_first`, otherwise `internal_transfer`. Transfers are excluded from income and expense.
- Tables: `bank_accounts` (seeded with the known Relay accounts + role: income/opex/tax/partner), `bank_statement_imports` (per-file audit), `bank_transactions` (normalized rows, signed `amount_cents`, `flow_class`, `matched_payout_id`, `expense_id`). `expenses.bank_transaction_id` links auto-created expenses.
- Auto-create expenses: each `external_expense` row inserts a linked `expenses` row (`is_paid=true`, `paid_at`=txn date, category from a vendor keyword map, `recurring_expense_id` from a payee-token + amount-tolerance match, `bank_transaction_id`). One unified ledger reusing categories, allocations, and recurring links.
- Post-import, the Bank tab shows an "Add to expenses" action on any transaction without a linked expense (server action `addBankTransactionToExpense`). It creates the same kind of linked expense (recomputing category/recurring suggestions) and works for any row — useful for rows that were unchecked at import or misclassified as transfer/income. Deleting the expense resets `bank_transactions.expense_id` to null (FK `ON DELETE SET NULL`), so the action becomes available again.
- Deduplication: `dedupe_hash` = `account_number|isoDate|amount_cents|balance_cents|normalizedPayee|txn_type` (running balance disambiguates same-day rows), `UNIQUE`. Re-importing a file skips existing rows; `idx_expenses_bank_transaction` prevents duplicate expenses.
- Payout reconciliation: `Receive` rows whose payee contains "stripe" match `stripe_payouts` by exact `amount_cents` and `arrival_date` within ±3 days. Non-Stripe income (e.g. bonuses) stays unmatched income and is not added to Stripe revenue.
- RLS follows the financials pattern: `SELECT` to authenticated, writes `super_admin` only (the route is also `super_admin` gated).

## PriceLabs Reservations (BigQuery wrapper)

Reservation-level data reaches the Hub through an externally-managed pipeline: BigQuery → Supabase `wrappers` FDW foreign table `pricelabs_bq.pricelabs_reservations` → external view `public.pricelabs_reservations_bq` (joins hub `listings`/`clients`; do not modify either). **The foreign table is only queryable by `postgres`** — the FDW resolves its BigQuery credentials from `vault` as the *calling* role, so authenticated/service_role fail with "permission denied for schema vault", and every query is a live BigQuery round-trip. The app therefore reads only the local matview `pricelabs_reservations_cache` (migration 054), refreshed hourly by pg_cron as postgres (migration 055); the BQ source itself refreshes daily ~02:20 UTC. Data layer: `lib/reservations.ts`; UI: `/reservations` + `RecentReservationsCard` on client/listing detail. The older `pricelabs_reservations_airbnb` table is a separate legacy ingest — do not use it (user decision, 2026-07-31). See project-map.md → Database Tables for the cache details.

## Pacing Chart

The dashboard home's pacing visual is the **Monthly Pacing** chart (real Report Builder data) — see the Monthly Pacing section below.

The earlier **daily** pacing chart that ran on mock data was removed from the home on 2026-06-24 ("no nos sirve"): deleted `components/dashboard/pacing-chart.tsx` and `lib/pacing-mock.ts`. The reservations-based data layer for a *real* daily pacing chart remains dormant on disk with no UI consumer:

- Data layer: `lib/pacing.ts` (`getPacingData`) — forward 60-day window, recency buckets `last_3d / last_7d / last_14d / older`, denominator = static listings count.
- Schema: `023_reservations.sql` + `scripts/seed-reservations.ts` — never applied/seeded on the dev Supabase project.
- To revive a daily chart: apply migration 023, seed reservations, build a new client component consuming `getPacingData` (git history has the old `pacing-chart.tsx` for reference). Otherwise these can be deleted as dead code.

### Monthly Pacing (Report Builder)

Sibling chart on the dashboard home: one stacked column per calendar month, built on `report_metrics` (Report Builder monthly grid) instead of daily reservations.

- Component: `components/dashboard/monthly-pacing-chart.tsx`.
- Data layer: `lib/monthly-pacing.ts` (`getMonthlyPacingSource` server fetch + `aggregateMonthlyPacing` pure aggregator). Reads the latest *completed* `report_runs`; degrades to an empty state on any query error (e.g. missing pickup columns).
- Bar height = month's `adjusted_occupancy_pct`, decomposed by booking recency (all in occupancy percentage points, so the stack sums to occupancy):

```text
pickup_7d     = occupancy_pickup_7d        (booked last 7 days)
pickup_8_14d  = occupancy_pickup_8_14d     (booked 8–14 days ago)
pickup_15_30d = occupancy_pickup_15_30d    (booked 15–30 days ago)
older         = adjusted_occupancy_pct − (the three pickups)   (30+ days ago)
```

- Uses `occupancy_pickup_*` (already non-overlapping), NOT `booked_nights_pickup_*` (which are cumulative 7d⊆14d⊆30d and in nights). Pickups are clamped at 0; net-negative recency folds into `older`.
- Portfolio value per month = simple average across selected listings (no available-nights column to weight by; documented in the footer).
- Filters: Listings, Clients (via `report_listings.hub_client_id` → `clients.name`, fallback `group_name`), Cities (`report_listings.city`). No range dropdown — renders all months in the run.
- **Row-cap pagination:** one run is listing × month (~2.8k rows) and this project enforces PostgREST `db-max-rows = 1000`, so `getMonthlyPacingSource` pages `report_metrics` with `.range()` (1000/page, stable `period, listing_id` order). A single unbounded select silently drops the latest months — exactly where pickup lives. See `decisions.md` (2026-06-24).

## Airbnb OG Image (Adjustments share card)

The public share page `/a/[token]` uses the Airbnb listing photo as its `og:image` for single-listing adjustments (WhatsApp previews). Implementation: `lib/airbnb-og.server.ts` + `airbnbRoomUrl()` in `lib/adjustments.ts`, wired in `generateMetadata` of `app/a/[token]/page.tsx`.

- Airbnb serves OG tags only to browser user agents — the fetch must send a Chrome-like `User-Agent`; a default server UA gets a bot wall.
- The room page HTML (~700 KB) is cached via Next data cache (`next: { revalidate: 86400 }`, under Vercel's 2 MB per-entry limit); the extracted URL is not persisted in the DB.
- The scrape races a 4s timer (no AbortSignal, to keep the fetch cacheable) and returns `null` on any failure; callers fall back to the RevFactor logo (also used for portfolio-scope adjustments).
- The `a0.muscache.com` image URLs are hotlinkable — WhatsApp fetches them directly, no proxying needed.
- Residual risk: Airbnb may block Vercel datacenter IPs. If that happens, next step is caching the URL in a `listings` column.

## Scheduler to Pipeline Webhook (implemented)

The revfactor-scheduler app (`schedule.revfactor.io`, separate repo at `../revfactor-scheduler`, Vercel team `federico-zimermans-projects`) forwards each confirmed booking to the Hub as a lead.

- Hub endpoint: `POST /api/webhooks/scheduler` (`app/api/webhooks/scheduler/route.ts`), reachable without a session (`proxy.ts` skips `/api/`).
- Auth: `Authorization: Bearer <SCHEDULER_WEBHOOK_SECRET>` (env var on the Hub; verified configured in Vercel production as of 2026-07-09 — endpoint returns 401 without it, 200 with the correct secret).
- Required payload fields: `visitorName`, `visitorEmail`, `date` (YYYY-MM-DD), `startTime` (HH:mm). Optional extras are concatenated into `description`.
- Inserts a `leads` row with stage `meeting`, `lead_source: "scheduler"`, `external_ref: "scheduler:<bookingId>"` for idempotent dedupe.
- Scheduler side: `src/app/api/book/route.ts` fires the forward after saving the booking (fire-and-forget, silently skipped if `HUB_WEBHOOK_URL`/`HUB_WEBHOOK_SECRET` are unset — confirm both exist in the scheduler's Vercel production env; they cannot be verified from this repo).

## Landing Page to Pipeline Webhook (implemented 2026-07-09)

Generic lead intake for landing-page forms (e.g. the home email-capture field). External contract: `docs/webhook-pipeline-integration.md` (rewritten 2026-07-10; the old version documented `project_name`/`full_name` as required, which the code never enforced).

- `POST /api/webhooks/new-lead` (`app/api/webhooks/new-lead/route.ts`), reachable without a session.
- Auth via `x-webhook-secret` header matched against server-only `WEBHOOK_SECRET` (in `.env.local`; must also be set in Vercel).
- Only `email` is required (validated). `full_name`, `project_name`, `phone`, `lead_source` (default `landing_page`), `scheduled_date` (ISO 8601), `timezone`, `location`, `description`, `external_ref` are optional. `project_name` (NOT NULL in DB) falls back to `full_name`, then `email`.
- Attribution (added 2026-07-10, migration 043; `msclkid` added 2026-07-12, migration 044): an optional `attribution` object, or the same keys flat at the top level (top level wins), carrying `utm_source|utm_medium|utm_campaign|utm_content|utm_term|gclid|msclkid|fbclid|referrer|landing_page`. Parsed by the pure helper `lib/lead-attribution.ts`; unknown keys (incl. the landing's qualifier answers `has_property|is_pm|properties|portfolio` and `gbraid`/`wbraid`) land in `leads.attribution_extra` (jsonb) so marketing can add a tracking param without a Hub deploy, and the qualifier keys render as a Qualification block on the lead detail. All optional — existing callers are unaffected. The landing (Aaron) matches this schema in JSON; the only rename is his `landing` → our `landing_page`.
- Idempotency: an active (non-archived, non-completed) lead with the same email (case-insensitive) is reused — returns 200 with `deduped: true` instead of inserting. On dedupe, attribution is backfilled only when the existing lead has no `utm_source`: first touch wins, but only if there *was* a first touch (the first request of a double-submit may have carried no UTMs).
- Inserts stage `inquiry`, `sort_order` = max inquiry order + 1, `service_type: null`, `created_by: null`, via admin client.
- Responses: 201 `{ success: true, lead_id }`, 200 deduped, 400 validation, 401 secret mismatch, 500 insert error. No `revalidatePath`; Hub users see new leads after reload/navigation.

Caller requirements (any external page):

- Make the fetch server-side and never expose `WEBHOOK_SECRET` in the browser.
- Use a short timeout (~5s), log failures, and never block the visitor's flow — lead creation is best-effort.

## Agent Studio Integrations (2026-07-29)

- AI runs use Vercel AI Gateway through AI SDK 7. Pricing refreshes hourly and is snapshotted per run for same-token model comparisons.
- Assembly history is fetched read-only from the linked active client's latest channel. Contact details and URLs are redacted before model use or storage. Shadow cases never send drafts.
- PriceLabs context is read-only and has two complementary sources: synced listing snapshots provide exact forward 7/30/90-day occupancy and market occupancy, while the latest completed Report Builder run provides monthly current, market, same-time-last-year (STLY), and final-last-year (LY) comparisons. The legacy `pl_occupancy_past_90` / `pl_market_occupancy_past_90` columns actually store PriceLabs' `adjusted_occupancy_next_90` values; Agent Studio exposes them with accurate forward-looking names. Monthly portfolio occupancy is a simple listing average and revenue is summed; it is not used as a substitute for the exact 90-day snapshot. Per-listing monthly detail is bounded to 10 listings in model context while portfolio aggregates cover up to 50 matched listings. Studio has no PriceLabs write path.
- Local health requires `ASSEMBLY_API_KEY` and `PRICELABS_API_KEY` in `.env.local`; production uses the same server-only Vercel variables.

## Leads Read API (outbound, implemented 2026-07-10)

The Hub's only outbound API. Consumer: the external marketing team's tracking stack, closing the loop from lead source to booked call to closed deal. External contract: `docs/webhook-pipeline-integration.md` §2.

- `GET /api/v1/leads` (`app/api/v1/leads/route.ts`), no session; `proxy.ts` already exempts `/api/`.
- Auth: `Authorization: Bearer rvf_live_…` against `api_keys`, scope `leads:read`. See `conventions.md` for the scheme and `scripts/create-api-key.ts` / `revoke-api-key.ts` for the lifecycle (plaintext shown once; revocation is immediate and needs no redeploy).
- Incremental sync: `updated_since` + keyset `cursor` (ordered `updated_at, id`), `limit` default 100 / max 500, `include=events` for the raw stage transitions. Depends on the `updated_at` trigger added in 043 — before it, `updated_at` was set by hand in every server action and a missed write would have silently dropped a lead out of the consumer's sync.
- Returns full PII (`email`, `full_name`, `phone`) by explicit decision — marketing already sees it under `pipeline:view`. **`description` is excluded**: the scheduler webhook flattens third-party contact details into it. So are `project_name`, `assembly_client_id` (surfaced only as `is_won`), notes, tags, and team assignments.
- `timeline` per lead: `booked_call_at` (first entry into stage `meeting` — *not* `scheduled_date`, which is when the call is scheduled to happen), `proposal_sent_at`, `proposal_signed_at`, `retainer_paid_at`, `converted_at`, `lost_at`. Milestones are the **first** entry into a stage, since leads can move backwards and re-enter. History only exists from the 043 deploy onward; earlier leads carry one synthetic event at their current stage.
- Outcome (migration 044): `outcome` = `won` (`assembly_client_id` set) → `lost` (`lost_at` set) → `open`, won taking precedence. `is_won` kept as a back-compat alias; `lost_reason` exposed at top level; `msclkid` inside `attribution`. Won timestamped by `converted_at` (written by `createAssemblyClientForLead`); lost by `lost_at`/`lost_reason` (written by `markLeadLost`).
- Rate limiting is an in-memory token bucket (60 req/min per key) returning 429 + `Retry-After`. It is per serverless instance and resets on cold start — a courtesy guard, not a hard global limit.
