# Integrations — RevFactor Hub

## AirROI

AirROI is the optional public-listing enrichment source for the Revenue Brief Builder.

- API base: `https://api.airroi.com`.
- Auth: `X-API-KEY` from server-only `AIRROI_API_KEY`; never expose the key to the browser.
- Client: `lib/airroi.server.ts`; pure response validation, Airbnb ID parsing, and brief-draft mapping live in `lib/airroi.ts`.
- Hub route: authenticated `POST /api/revenue-briefs/airroi`, gated by `pipeline:view`, calls `GET /listings?listing_id=...&currency=native` once per explicit user request and returns a private/no-store draft.
- Inputs: prospect name, exact property address, Airbnb listing URL, owner goals, and optional known constraints. Only `airbnb.com/rooms/<numeric-id>` URLs are accepted; the Hub extracts the ID instead of forwarding a user-controlled URL.
- Drafted facts: listing name/location, specs, rating/reviews, host/trust signals, visible amenities, booking settings, and owner-safe initial opportunity language. Demand drivers and RevFactor benchmarks remain manual analyst-review fields.
- Evidence boundary: AirROI TTM revenue, ADR, occupancy, and RevPAR are shown internally as third-party modeled estimates. They are not treated as owner-reported actuals, are not inserted into the client PDF as guaranteed projections, and do not replace the approved RevFactor managed-benchmark section.
- Persistence: no AirROI payload, intake, or generated PDF is stored in v1. Missing configuration disables the import button while preserving the manual builder.

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
- Production playbook contract: the future live client-service runtime loads one default `production` playbook. It does not automatically route among the focused sandbox playbooks; pricing, triage, and escalation behavior must be consolidated into the main playbook's workflow before the inbox runtime is attached.

Treat the pricing metadata as a display estimate, not billing truth; update `AGENT_STUDIO_MODELS` when Gateway pricing changes. Embedding price is refreshed hourly from the Gateway catalog with a pinned fallback estimate. Assembly sending remains intentionally absent and requires a separately authorized, human-approved path.

## GoHighLevel onboarding pilot

The onboarding application has an isolated Preview-only pilot at `/start/ghl-pilot` for signup → GHL agreement → Stripe test Checkout → existing Assembly onboarding handoff. It does not replace the production `/start` route or `onboarding.revfactor.io`.

- The signup route freezes standard pricing, creates the Hub signup intent, prepares an Assembly client/company without sending an invite, and upserts the GHL contact.
- GHL workflow `RF PILOT | Signup → GHL Contract` is triggered only by `rf-ghl-pilot` and sends `RevFactor_Service_Agreement` directly.
- GHL workflow `RF PILOT | Contract Signed → Stripe Test Checkout` requires a completed matching template plus a non-empty pilot signup ID before calling the Preview callback.
- The callback requires a per-signup HMAC token derived from a Preview-only secret, cross-checks signup ID/email/token, and refuses any Stripe key that is not `sk_test_`.
- Primary, child, and onboarding charges remain separate Stripe Price line items so the one-time fee is not duplicated by a recurring product setup fee.
- The existing Stripe webhook remains responsible for provisioning the Hub onboarding run and sending the Assembly portal invite after test payment.
- `/api/pilot/ghl/ready` is the non-secret readiness gate; a valid pilot reports test Stripe, configured GHL/Assembly, and `productionSignupChanged: false`.

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
- Agent Studio health separates connection health from listing coverage: a fresh portfolio sync displays `connected`, with named notes for active listings that have a missing ID, have never synced, or are older than the 36-hour freshness target.
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

## Wins Detection (PriceLabs, read-only)

`/wins` is a pure consumer of two existing PriceLabs pipelines; it adds no new external call and no new credential.

- **Pickup** comes from the `pricelabs_reservations_cache` matview via the `wins_pickup_windows(as_of)` RPC. Freshness is bounded by the BigQuery source (daily ~02:20 UTC), not by the hourly pg_cron refresh — the UI reads `source_fetched_at` and the newest complete `booked_date` rather than claiming an accuracy it cannot prove.
- **Period revenue, occupancy, ADR, RevPAR Index and market context** come from the latest **completed** `report_runs` only; mixing runs would double-count because every run is a full snapshot.
- **Assembly is read-only, and no Assembly API call happens at all.** The chat deep link is rebuilt from the stored `clients.assembly_company_id` / `assembly_client_id` by a pure helper in `lib/wins.ts`, so the queue renders without a network round-trip. `lib/assembly.ts` is deliberately never imported by this feature; `lib/__tests__/wins-boundaries.test.ts` fails the build if it ever is.
- The link is only sent to the browser for users holding `wins:control`; everyone else receives `null`. Opening it records `assembly_opened`, which is **not** a delivery signal.
- 57 of 112 clients have no Assembly chat linked, so the disabled-with-reason state is the common case, not an edge case.

## Stripe and Financials

- API client: `lib/stripe.ts`.
- Secret key: server-only `STRIPE_SECRET_KEY`.
- Financials page is server-side gated to `super_admin`.
- Client to Stripe customer links use the `client_stripe_customers` junction table as the source of truth; do not rely on `clients.stripe_customer_id`.
- Client Billing is derived from the sum of current monthly Stripe subscriptions for every Stripe customer linked through `client_stripe_customers`; the legacy `clients.billing_amount` value is not used for client list/detail reporting.
- Client detail pages let `super_admin` users create or reuse a Stripe customer from `client_stripe_customers`, choose a subscription type deduced from existing Stripe subscriptions, and generate a Checkout Session in `subscription` mode.
- Listings can link to subscriptions via `stripe_subscription_id`. The "Link Listings to Subscription" dialog (`link-subscription-dialog.tsx`) also has a quick-add form that creates a new active listing already associated to the subscription's linked client (`createListingForClient` action) and auto-selects it — for new clients with no listings yet. That dialog now labels a listing already attached to a _different_ subscription with the real customer name + status (e.g. "linked to Jane Ng · active") instead of a generic note.
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

Reservation-level data reaches the Hub through an externally-managed pipeline: BigQuery → Supabase `wrappers` FDW foreign table `pricelabs_bq.pricelabs_reservations` → external view `public.pricelabs_reservations_bq` (joins hub `listings`/`clients`; do not modify either). **The foreign table is only queryable by `postgres`** — the FDW resolves its BigQuery credentials from `vault` as the _calling_ role, so authenticated/service_role fail with "permission denied for schema vault", and every query is a live BigQuery round-trip. The app therefore reads only the local matview `pricelabs_reservations_cache` (migration 054), refreshed hourly by pg_cron as postgres (migration 055); the BQ source itself refreshes daily ~02:20 UTC. Data layer: `lib/reservations.ts`; UI: `/reservations` + `RecentReservationsCard` on client/listing detail. The older `pricelabs_reservations_airbnb` table is a separate legacy ingest — do not use it (user decision, 2026-07-31). See project-map.md → Database Tables for the cache details.

The future Airbnb seasonal-cancellation skill must discover gaps from `pricelabs_reservations_cache`, never Airbnb scraping, and must prove the corresponding pg_cron refresh has a successful `cron.job_run_details` row within 90 minutes before acting. `source_fetched_at` is upstream BigQuery freshness and does not prove the local matview refresh. The remaining targeting/substitution/Adjustment decisions are frozen in `docs/airbnb-seasonal-cancellation-foundation.md`; migration 091 implements data fields and invariants only, with no Airbnb/Slack/cron/Adjustment write path.

## Pacing Chart

The dashboard home's pacing visual is the **Monthly Pacing** chart (real Report Builder data) — see the Monthly Pacing section below.

The earlier **daily** pacing chart that ran on mock data was removed from the home on 2026-06-24 ("no nos sirve"): deleted `components/dashboard/pacing-chart.tsx` and `lib/pacing-mock.ts`. The reservations-based data layer for a _real_ daily pacing chart remains dormant on disk with no UI consumer:

- Data layer: `lib/pacing.ts` (`getPacingData`) — forward 60-day window, recency buckets `last_3d / last_7d / last_14d / older`, denominator = static listings count.
- Schema: `023_reservations.sql` + `scripts/seed-reservations.ts` — never applied/seeded on the dev Supabase project.
- To revive a daily chart: apply migration 023, seed reservations, build a new client component consuming `getPacingData` (git history has the old `pacing-chart.tsx` for reference). Otherwise these can be deleted as dead code.

### Monthly Pacing (Report Builder)

Sibling chart on the dashboard home: one stacked column per calendar month, built on `report_metrics` (Report Builder monthly grid) instead of daily reservations.

- Component: `components/dashboard/monthly-pacing-chart.tsx`.
- Data layer: `lib/monthly-pacing.ts` (`getMonthlyPacingSource` server fetch + `aggregateMonthlyPacing` pure aggregator). Reads the latest _completed_ `report_runs`; degrades to an empty state on any query error (e.g. missing pickup columns).
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

## GoHighLevel Sales Setup (started 2026-08-01)

GoHighLevel is intended to replace the vibecoded scheduler and own lead capture, booking, reminders, no-show follow-up, nurture, and sales opportunity movement. The Hub should become the internal mirror/reporting layer that receives GHL lifecycle events rather than competing as a second sales CRM.

- Local credentials live only in `.env.local` as `HIGHLEVEL_API_KEY` and `HIGHLEVEL_LOCATION_ID`; do not commit them.
- API base: `https://services.leadconnectorhq.com`; use the location-level Private Integration Token with the `locationId`.
- Existing setup created in the RevFactor location:
  - Pipeline `RevFactor Sales` with stages: `New Lead`, `Booked Call`, `No-Show Follow-Up`, `Completed Call`, `Proposal Sent`, `Negotiation`, `Won`, `Lost / Not a Fit`.
  - Reusable email template `Sales - Post-call - Start onboarding` (template ID `6a7a1f448dcff31cf0c34137`) for qualified leads after a completed sales call. It links to `https://onboarding.revfactor.io/start` with campaign UTMs and explains the agreement, payment, portal, and future-service-start flow. Keep this manual/selectable rather than firing on every completed call because not-fit and question-follow-up outcomes share that stage.
  - Standard-onboarding product catalog (referral pricing is intentionally excluded and will use a separate future pipeline):
    - `RevFactor - Primary Listing`: $350/month per primary listing. This is the renamed original `RevFactor Subscription` product.
    - `RevFactor - Child Listing`: $50/month per child listing.
    - `RevFactor - Onboarding Fee`: $150 one time; the checkout omits or zeroes this charge when waived.
    - GHL's product `Available QTY` is inventory availability, not the purchased listing count. Primary and child quantities must come from the signup data and be applied explicitly to the contract/Stripe checkout.
  - Contact custom fields:
    - `contact.rf_hub_lead_id` (`RF Hub Lead ID`)
    - `contact.rf_scheduler_booking_id` (`RF Scheduler Booking ID`) for legacy scheduler migration/dedupe
    - `contact.rf_airbnb_listing_url` (`RF Airbnb Listing URL`)
    - `contact.rf_property_address` (`RF Property Address`)
    - `contact.rf_heard_about_us` (`RF Heard About Us`)
    - `contact.rf_referral_name` (`RF Referral Name`)
    - `contact.rf_scheduled_call_time` (`RF Scheduled Call Time`)
    - `contact.rf_host_rep` (`RF Host Rep`)
    - `contact.rf_meet_link` (`RF Meet Link`)
    - `contact.rf_notes_to_prepare` (`RF Notes To Prepare`)
    - Standard-onboarding fields in the `RevFactor Standard Onboarding` folder:
      - `contact.rf_primary_listing_quantity` (`RF Primary Listing Quantity`, Number)
      - `contact.rf_child_listing_quantity` (`RF Child Listing Quantity`, Number)
      - `contact.rf_onboarding_fee` (`RF Onboarding Fee`, Number; USD amount, 150 or 0)
      - `contact.rf_monthly_service_fee` (`RF Monthly Service Fee`, Number; calculated USD amount)
      - `contact.rf_initial_checkout_total` (`RF Initial Checkout Total`, Number; calculated USD amount)
      - `contact.rf_stripe_checkout_url` (`RF Stripe Checkout URL`, Text)
      - `contact.rf_stripe_checkout_session_id` (`RF Stripe Checkout Session ID`, Text)
      - `contact.rf_client_legal_name` (`RF Client Legal Name`, Text)
      - `contact.rf_pricing_program` (`RF Pricing Program`, Text)
      - `contact.rf_service_start_mode` (`RF Service Start Mode`, Text; `immediate` or `scheduled`)
      - `contact.rf_service_start_date` (`RF Service Start Date`, Text; ISO date when scheduled)
- The revised PDF is uploaded to the GHL Documents & Contracts template `RevFactor_Service_Agreement`. The template has required contact and RevFactor sender signature/name/date fields plus sender-completed pricing fields for the program, primary/child quantities and rates, monthly fee, onboarding fee, and initial total. The native product-list block was removed because it overlapped the fixed PDF and could not safely represent the dynamic quantities. During testing, the primary product also displayed a $150 setup fee; do not combine that native setup fee with the separate onboarding product or the client could be charged twice.
- Standard onboarding is split into two **Draft** workflows; neither is active:
  - `RF Standard | Signup → Contract → Stripe`: tag trigger `rf-standard-contract-ready` → internal review notification → create `RevFactor_Service_Agreement` as a draft, with Federico as sender. The trigger tag must be added only after signup quantities and totals are validated.
  - `RF Standard | Contract Signed → Stripe Checkout`: completed `RevFactor_Service_Agreement` trigger → premium custom webhook POST to `https://hub.revfactor.io/api/webhooks/highlevel/onboarding-checkout` → email the generated `contact.rf_stripe_checkout_url` to the client.
- `POST /api/webhooks/highlevel/onboarding-signup` is the server-to-server bridge for the existing `onboarding.revfactor.io/start` experience. It validates the standard (non-referral) applicant, 1–5 primary and 0–5 child quantities, and immediate/scheduled service start; calculates the $350/$50 monthly pricing and $150 onboarding fee; upserts the GHL contact without overwriting tags; writes the contract/pricing fields; and adds `rf-standard-contract-ready`. Authenticate it with `HIGHLEVEL_SIGNUP_WEBHOOK_SECRET`. The current onboarding-app checkout still points to Assembly and must not be switched until the Hub route is deployed and the draft flow passes end-to-end testing.
- `POST /api/webhooks/highlevel/onboarding-checkout` validates the signed-document payload, creates or reuses the Stripe customer, creates an idempotent subscription Checkout Session with primary and child quantities plus an optional $150 onboarding product, writes the Checkout URL/session ID back to GHL, and adds `rf-standard-checkout-ready`. Immediate starts charge the monthly subscription plus onboarding at checkout; scheduled starts use Stripe `trial_end` so checkout charges onboarding now and recurring billing begins on the agreed date. It requires `STRIPE_PRIMARY_LISTING_PRICE_ID`, `STRIPE_CHILD_LISTING_PRICE_ID`, `STRIPE_ONBOARDING_FEE_PRICE_ID`, `ONBOARDING_CHECKOUT_SUCCESS_URL`, `ONBOARDING_CHECKOUT_CANCEL_URL`, `HIGHLEVEL_API_KEY`, and `HIGHLEVEL_ONBOARDING_WEBHOOK_SECRET` in the deployed Hub environment.
- Before activating either workflow: deploy both endpoints, configure `HIGHLEVEL_SIGNUP_WEBHOOK_SECRET`, replace the GHL key-vault credential `RF_Onboarding_Webhook` placeholder with the same value as `HIGHLEVEL_ONBOARDING_WEBHOOK_SECRET`, switch the existing signup server route from Assembly to the Hub signup bridge, and pass the quantity/fee/service-start test matrix. GHL marks the custom-webhook action as premium, so each live execution may incur a workflow charge.
- GHL currently syncs newly created products to the connected live Stripe catalog. Creating a product does not charge a customer, but do not send a document, publish a payment link, or activate a workflow until quantities and totals pass the standard test matrix.
- Calendar setup is not complete yet. GHL currently has no calendars configured; add the needed RevFactor reps/users and connect their Google calendars in GHL before replacing the website scheduler embed.
- Next Hub work: add a new `POST /api/webhooks/highlevel` receiver for appointment/opportunity lifecycle events, then mirror GHL contacts/opportunities into the Hub pipeline without using the scheduler route.

### GHL-native onboarding draft (2026-08-21)

- Client-visible target: GHL funnel/form → GHL `RevFactor_Service_Agreement` → GHL direct monthly payment → Assembly invitation. The client should not visit the Vercel pilot; only the final provisioning webhook remains outside GHL and is invisible to the client.
- Draft GHL assets:
  - Funnel `RevFactor Client Onboarding`, step `Start Onboarding` (`start`), page-builder ID `YCl1q29Evuh1Qd97PIxe`. Saved but not published and no domain is attached.
  - Form `RevFactor Client Onboarding Signup` (ID `k9ViLjaX5lbxJe38KxuV`) captures name/email, optional phone, listing count, optional child-listing count, legal name, and optional scheduled start. The funnel URL must retain `rf_primary_listing_quantity=1` so GHL prefills one listing; a native disqualification rule rejects values below 1. `Add child listing` and `Start service at a later date` are unchecked by default and reveal their dependent fields only when selected. Their help text explains child listings and that an unchecked service-start option means immediate service. The confirmation tells the client to check email for the GHL agreement and explains that payment and Assembly follow.
  - Workflow `RF NATIVE | Signup → GHL Agreement`: Draft; only the native form submission can enroll a contact. The obsolete `rf-ghl-pilot` trigger was removed. It maps the new form controls into the established `RF Service Start Mode` and `RF Service Start Date` fields, routes scheduled versus immediate starts, and sends the same internal notification and `RevFactor_Service_Agreement` directly by email on both branches.
  - Workflow `RF NATIVE | Payment → Assembly Handoff`: Draft; a successful payment containing `RevFactor - Primary Listing` first calls the protected preview provisioning webhook, then applies `rf-ghl-native-paid` and creates an in-app alert. The webhook action has bearer authentication plus Vercel's preview-protection bypass header; secret values are stored only in the external systems.
- The native onboarding funnel and form reuse the visual system from the existing six-step GHL funnel `Revfactor` (`affiliate.revfactor.io`), rather than the Hub application's green token. GHL design tokens are forest `#142D26`/`#13342D`, warm stone `#DDDAD3`/`#E8E6E1`, sage `#5D6D59`/`#7A8B76`, rust `#76574C`, Cormorant Garamond display headings, and Inter/Helvetica interface copy. Page tracking CSS and form-level custom CSS are saved; the CTA is dark forest with warm-stone uppercase text. The final shell uses the public-site `revfactor` text wordmark, high-contrast intro copy, a compact `details → agreement → payment → onboarding` progress cue, targeted section spacing, a two-column desktop/one-column mobile form grid, checkbox cards, 16px mobile inputs, and no horizontal overflow. The funnel remains unpublished.
- GHL's form-level “Save progress for forms” prompt is disabled so the onboarding preview opens without the misleading unfinished-submission modal. The review URL must include both defaults: `rf_primary_listing_quantity=1&rf_child_listing_quantity=0`. GHL's Number component has no reliable persisted visible default; the query keys supply the visible `1`/`0`, while the existing native rule still rejects a primary count below one. A fresh public preview confirmed primary `1`, hidden child `0`, both optional checkboxes off, no save-progress prompt, no horizontal overflow, and correct child/date reveals without submitting the form.
- GHL Conversation AI now contains an inactive primary agent `RevFactor Onboarding Guide` (agent ID `deaf1E2RKOD7VntOByd2`) with status **Off**, conversation summaries enabled, and no live channel automation. Its dedicated `RevFactor Onboarding Bible` knowledge base (ID `dl4RP5U9dqh8cWZ6MdqO`) contains the trained rich-text source `RevFactor Client Onboarding — Canonical Guide`, covering the standard flow, $350/$50/$150 pricing, listing definitions, agreement/payment/Assembly sequence, Airbnb/PMS/PriceLabs access, credential safety, correction behavior, troubleshooting, and human-escalation boundaries. The bot routes all onboarding topics to this KB. An internal trial correctly interpreted `Hospitabel` as a likely `Hospitable` typo and converted a host/editor URL containing room ID `1329788633582491000` to the public room URL while asking the client to confirm both. Before activation, select the human-handover owner/scenarios and explicitly approve its live channels/status.
- The primary recurring product's $150 setup fee was removed. `RevFactor - Onboarding Fee` remains the only one-time $150 product; primary is $350/month and child is $50/month.
- The form submit button is below all quantity/legal/start fields. The agreement now has a native product list on a separate page: primary is required with signer-editable quantity 1–5, child is optional/default-off with signer-editable quantity 1–5, and the one-time onboarding fee is required. Payment settings are recurring monthly, first invoice at signing, direct payment, invoice email, autopay, and no stop date. The template remains Draft.
- `POST /api/webhooks/ghl/native-payment` is deployed to a protected Vercel Preview and is wired into the Draft payment workflow. It accepts a bounded snake-case payload authenticated by `GHL_NATIVE_ONBOARDING_WEBHOOK_SECRET`, validates the actual first-payment total, derives the signed primary/child quantities from the approved $350/$50/$150 price matrix, creates/reuses the Assembly identity and Hub run idempotently by GHL transaction ID, and sends the Assembly invitation. Authentication and invalid-payload behavior have been checked without provisioning a client.
- Remaining release gates: reconcile/remove the agreement PDF's older sender-completed pricing schedule; explicitly confirm the invoice and invoice-autopay channels use Stripe Test for the pilot (GHL has both Stripe live and test connections, while its provider screen currently opens on Live); generate and review one internal test document; complete one GHL test payment; verify exactly one Hub run and Assembly invitation; repeat the same webhook to prove idempotency; then move the endpoint to a stable production URL and approve the separate signup cutover. Neither native workflow nor the funnel is published.

### Same-tab GHL agreement handoff (2026-08-22)

- The unpublished `RevFactor Client Onboarding` funnel now uses a GHL Custom HTML/Javascript element as its client-visible signup form. The older native form remains in the draft only as a recoverable reference and is hidden at the wrapper/section level; it no longer displays its email-confirmation panel.
- The in-page form calls the isolated Cloudflare Worker `revfactor-ghl-inline-onboarding-staging` at `https://revfactor-ghl-inline-onboarding-staging.federico-241.workers.dev`. The Worker upserts the GHL contact and calculated onboarding fields, creates or reuses an open contact-specific document from template `RevFactor_Service_Agreement`, requests a link-only send (`medium: link`, never email), and returns the branded signer URL.
- Successful submit uses top-window navigation, so the current `links.revfactor.io` tab is replaced by `https://links.revfactor.io/documents/v1/<referenceId>?locale=en-US`. An internal repeated-submit test reused its existing open agreement and verified the whole-tab transition, primary `$350/month`, optional/default-off child `$50/month`, and required `$150` one-time onboarding fee. The agreement was not signed and no payment was attempted.
- Agreement products now branch by the signup's child-listing choice. `RevFactor_Service_Agreement` is the published no-child template (primary + onboarding only); `RevFactor_Service_Agreement_With_Child_Listings` is the published child template (primary + required child + onboarding). The Worker selects the template before creating the signer link, so the child product is absent when the signup checkbox is off instead of appearing as an optional upsell. The child template uses a repaired monthly invoice schedule (22nd, every month) required by GHL's publish validator.
- Contact upsert now also records `contact.rf_agreement_effective_date` as the agreement-creation date. The corresponding GHL contact custom field exists, but the PDF template still needs its page-one legal-name/effective-date overlays linked before those values can render in the agreement.
- Browser CORS is restricted to `https://links.revfactor.io`; the API credential is a Worker secret. The funnel, workflows, and production signup URL remain unpublished/unchanged. Before launch, link the page-one legal-name/effective-date fields, decide whether RevFactor should countersign or use a static authorized-representative block, confirm whether the internal signer blocks the immediate agreement-to-payment transition, then run a Stripe Test payment and idempotent Assembly handoff.

## Landing Page to Pipeline Webhook (implemented 2026-07-09)

Generic lead intake for landing-page forms (e.g. the home email-capture field). External contract: `docs/webhook-pipeline-integration.md` (rewritten 2026-07-10; the old version documented `project_name`/`full_name` as required, which the code never enforced).

- `POST /api/webhooks/new-lead` (`app/api/webhooks/new-lead/route.ts`), reachable without a session.
- Auth via `x-webhook-secret` header matched against server-only `WEBHOOK_SECRET` (in `.env.local`; must also be set in Vercel).
- Only `email` is required (validated). `full_name`, `project_name`, `phone`, `lead_source` (default `landing_page`), `scheduled_date` (ISO 8601), `timezone`, `location`, `description`, `external_ref` are optional. `project_name` (NOT NULL in DB) falls back to `full_name`, then `email`.
- Attribution (added 2026-07-10, migration 043; `msclkid` added 2026-07-12, migration 044): an optional `attribution` object, or the same keys flat at the top level (top level wins), carrying `utm_source|utm_medium|utm_campaign|utm_content|utm_term|gclid|msclkid|fbclid|referrer|landing_page`. Parsed by the pure helper `lib/lead-attribution.ts`; unknown keys (incl. the landing's qualifier answers `has_property|is_pm|properties|portfolio` and `gbraid`/`wbraid`) land in `leads.attribution_extra` (jsonb) so marketing can add a tracking param without a Hub deploy, and the qualifier keys render as a Qualification block on the lead detail. All optional — existing callers are unaffected. The landing (Aaron) matches this schema in JSON; the only rename is his `landing` → our `landing_page`.
- Idempotency: an active (non-archived, non-completed) lead with the same email (case-insensitive) is reused — returns 200 with `deduped: true` instead of inserting. On dedupe, attribution is backfilled only when the existing lead has no `utm_source`: first touch wins, but only if there _was_ a first touch (the first request of a double-submit may have carried no UTMs).
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

## Event Intelligence Source Roadmap

The August 21, 2026 discovery in `docs/event-intelligence-design.md` proposes a replaceable source-adapter layer. PredictHQ, Ticketmaster Discovery, and National Weather Service alerts now share the normalized provider contract; official/news sources remain candidates.

- PredictHQ: the expired trial is retained only as historical reference data. Pending timestamp migration `20260902203000` disables its source rows and exposes `market_event_source_recovery`, an RLS-bound read view that marks each PredictHQ canonical event `pending` until any independent provider record is attached, then `recovered`. Automatic ingestion additionally requires the explicit `PREDICTHQ_INGESTION_ENABLED=true` escape hatch as well as the server-only token; the normal configuration keeps it false. Existing events, provider observations, versions, evidence, impacts, and briefs are preserved.
- Ticketmaster Discovery: implemented structured ticketed-event enrichment. `TICKETMASTER_API_KEY` is server-only even though Ticketmaster requires the key as a query parameter. Reads use reviewed market coordinates/radius, a 180-day horizon, relevant segments, three-hour cadence, and a 300-event cap. Ticketmaster does not expose attendance in Discovery results, so the adapter never invents it; Ticketmaster-only rows begin as Watchlist evidence unless deterministic materiality and booking vulnerability independently justify review.
- SeatGeek: planned as the next independent ticketed-event adapter and PredictHQ recovery source. Reserve server-only `SEATGEEK_CLIENT_ID` and `SEATGEEK_CLIENT_SECRET`; the API permits the client ID alone, but the secret should be stored too when issued. No OAuth callback URL is needed for the read-only Platform API. The adapter is not active until its source type, fixture-tested normalizer, bounded market query, and source rows ship together.
- National Weather Service: implemented authoritative US watches/warnings/advisories through `api.weather.gov/alerts/active?point=...`. NWS has no user account or API key; `NWS_USER_AGENT=(hub.revfactor.io, info@revfactor.io)` identifies the caller. Its source row is eligible every 15 minutes, maps official severity to an auditable materiality floor (Extreme 85, Severe 70, Moderate 50, Minor 25), and uses authority tier 1. The current scheduler wake is daily plus on-demand, so 15-minute operational freshness requires a future compatible scheduler. NWS does not cover non-US listings.
- College Football Data: pending timestamp migration `20260902203100` and `lib/market-signals/cfbd.ts` add `cfbd` to the normalized provider pipeline. `CFBD_API_KEY` is a server-only bearer credential, and ingestion additionally requires the explicit `CFBD_INGESTION_ENABLED=true` runtime flag; the key alone cannot activate a source. Sources require an explicit team/market mapping, default to home games, use a bounded 370-day schedule horizon, and reject located venues outside the reviewed market radius. Venue metadata is cached in-process for six hours. Future games keep attendance null; stadium capacity supplies only an auditable materiality floor, while completed attendance is retained when reported. Tucson/Arizona is the only active-market registration in this package; UConn and Tennessee remain inactive institution-scoped rows until their markets are reviewed. George Washington has no CFBD source.
- University official sources: pending timestamp migration `20260902203200` creates a canonical institution registry keyed to IPEDS UNITID, a market relevance map, and optional institution ownership on `revenue_market_sources`. The pilot is UConn, UT Knoxville, and George Washington. Each has an official Family Weekend page, commencement page, and registrar/academic-calendar cross-check. Only GW maps to the existing Washington market; UConn/UTK remain marketless. Every `official_feed` row is `registry_only` and inactive until an approved collector exists. No API credential is required for the public pages, and no market, listing membership, event, or commercial action is created by the migration.
- University page collection: additive migration `20260902203500` prepares the nine existing registry rows for `lib/market-signals/university-pages.ts` without activating them. The adapter supports bounded iCalendar, Event JSON-LD, HTML, and JSON-wrapped HTML; restricts requests and redirects to the institution's official HTTPS domain; sends the identifying RevFactor user agent; caps response size, horizon, and event volume; requires explicit match rules; and never infers attendance. Execution additionally requires `UNIVERSITY_PAGE_INGESTION_ENABLED=true`. The flag is false by default and is not a secret. The adapter labels canonical and corroborating evidence but does not yet resolve overlapping conflicts; precedence-safe reconciliation is a prerequisite to activation. See `docs/market-signals/university-official-source-audit.md` for source precedence, cadence, and known conflicts.
- Official RSS/Atom/press sources plus GDELT/news discovery remain the broader long-lead announcement layer. News items must be corroborated against authoritative evidence before an action gate; Google News RSS may be tested only as a disposable adapter, not a canonical dependency.
- PriceLabs coordinates are the current market-assignment starting point. Raw city/state labels are not reliable operating-market keys; the case study found missing states, duplicate United States labels, and at least one coordinate/state contradiction.
- Initial product boundary: read-only signal review and optional Adjustment linking. No PriceLabs, PMS, OTA, Assembly, or WhatsApp send/write path.

## Leads Read API (outbound, implemented 2026-07-10)

The Hub's only outbound API. Consumer: the external marketing team's tracking stack, closing the loop from lead source to booked call to closed deal. External contract: `docs/webhook-pipeline-integration.md` §2.

- `GET /api/v1/leads` (`app/api/v1/leads/route.ts`), no session; `proxy.ts` already exempts `/api/`.
- Auth: `Authorization: Bearer rvf_live_…` against `api_keys`, scope `leads:read`. See `conventions.md` for the scheme and `scripts/create-api-key.ts` / `revoke-api-key.ts` for the lifecycle (plaintext shown once; revocation is immediate and needs no redeploy).
- Incremental sync: `updated_since` + keyset `cursor` (ordered `updated_at, id`), `limit` default 100 / max 500, `include=events` for the raw stage transitions. Depends on the `updated_at` trigger added in 043 — before it, `updated_at` was set by hand in every server action and a missed write would have silently dropped a lead out of the consumer's sync.
- Returns full PII (`email`, `full_name`, `phone`) by explicit decision — marketing already sees it under `pipeline:view`. **`description` is excluded**: the scheduler webhook flattens third-party contact details into it. So are `project_name`, `assembly_client_id` (surfaced only as `is_won`), notes, tags, and team assignments.
- `timeline` per lead: `booked_call_at` (first entry into stage `meeting` — _not_ `scheduled_date`, which is when the call is scheduled to happen), `proposal_sent_at`, `proposal_signed_at`, `retainer_paid_at`, `converted_at`, `lost_at`. Milestones are the **first** entry into a stage, since leads can move backwards and re-enter. History only exists from the 043 deploy onward; earlier leads carry one synthetic event at their current stage.
- Outcome (migration 044): `outcome` = `won` (`assembly_client_id` set) → `lost` (`lost_at` set) → `open`, won taking precedence. `is_won` kept as a back-compat alias; `lost_reason` exposed at top level; `msclkid` inside `attribution`. Won timestamped by `converted_at` (written by `createAssemblyClientForLead`); lost by `lost_at`/`lost_reason` (written by `markLeadLost`).
- Rate limiting is an in-memory token bucket (60 req/min per key) returning 429 + `Retry-After`. It is per serverless instance and resets on cold start — a courtesy guard, not a hard global limit.

## Market Map Feed (outbound, implemented 2026-09-04)

- `GET /api/market-map` keeps its Hub-session path (`market_signals:view`) and also accepts a server-side `Authorization: Bearer rvf_live_…` key scoped only to `market-map:read`.
- The external map stores the plaintext key as the server-only `HUB_MARKET_MAP_TOKEN` and calls Hub through its own proxy. The browser never calls Hub directly and never receives the bearer key.
- Hub stores only the key's SHA-256 digest in `api_keys`; revocation is immediate and does not require a Hub redeploy. The bearer path uses the admin client, so the route's explicit listing/market/locality projections are the security boundary.
- The response remains read-only and redacted: opaque map key, city/state/country, coordinates/provenance, and reviewed market/locality labels only. It excludes street addresses, client names, Airbnb URLs, raw listing/provider IDs, and credentials.

# Market Signals

- Migration `076_market_signals_foundation.sql` defines the source registry, normalized events/provider records, immutable versions/evidence, market impacts, and append-only review decisions. It was applied to the linked `revfactorHub` Supabase project on 2026-08-21. Five pilot markets and one disabled PredictHQ Events source per market were seeded; applying the migration made no external request. Migration 077 updates the Smokies registry to the reviewed 10-mile Sevierville / Pigeon Forge / Gatlinburg corridor. Migration 078 makes market and coordinate-membership readiness agent-managed.
- `/market-signals` is permission-gated, but market setup has no human activation step. All five configured pilots are active and all coordinate matches are approved in agent mode: Washington 3, Sevierville/Pigeon Forge/Gatlinburg 40, Tucson 7, Myrtle Beach 1, and Park City 1. The ingestion job automatically enables each registered provider whose server-side runtime configuration exists and disables only that provider when it is absent. One expired or failed beta source does not block healthy sources. Human approval begins at the revenue recommendation/action boundary.
- PredictHQ uses the server-only `PREDICTHQ_ACCESS_TOKEN`. The adapter queries the accommodation impact window, a reviewed market radius, attended-event categories, and a bounded PHQ rank/candidate cap; it separately asks for provider changes from the source high-water mark so cancellations/deletions can update existing records. Pagination URLs are accepted only from `https://api.predicthq.com` and the bearer token is never placed in a URL or stored payload.
- Migration `085_market_signal_ticketmaster_nws_sources.sql` registers disabled Ticketmaster (trust tier 2, 180-minute cadence) and US NWS (trust tier 1, 15-minute cadence) source rows for every configured market. It was applied and recorded in the linked migration ledger on 2026-08-25 (five rows per provider). The agent enables them only when `TICKETMASTER_API_KEY` or `NWS_USER_AGENT` is present. Ticketmaster and NWS were live-smoke-tested with HTTP 200 responses; secrets and raw payloads were not written to the repository.
- Ingestion is idempotent on `(source_id, external_id)` and a source-neutral canonical fingerprint. It appends versions/evidence on changes, preserves provider first-seen timing, derives accommodation impact days, records materiality components, and exposes source health/overflow/errors. Confirmed major events may enter human review; predicted events stay watched unless materially strong; cancellations/postponements always survive filtering for unwind review. No ADR percentage is invented.
- The 90-day beta is capped at 300 provider candidates per market per run and persists in six-event batches. Unknown booking vulnerability always stays on the Watchlist; only attached PriceLabs inventory/pace evidence can promote a material event to Needs Review.
- Migration `081_market_signal_listing_vulnerability.sql` adds `market_event_listing_exposures`, a service-refreshed, permission-gated record of the strongest PriceLabs listing evidence behind selected review signals. Events inside seven or 30 days prefer the corresponding fresh rolling listing snapshot; farther-out events use the matching calendar month from the latest completed Report Builder run, with rolling data as a fallback. Evidence older than 72 hours cannot satisfy the review gate, and at least half of an active market's approved listings must have current evidence. Migration 083 bounds persistence to 25 exposed listings per selected impact while aggregate calculations still evaluate the complete approved market cohort.
- The vulnerability formula is deterministic: remaining inventory (50%), positive market-occupancy gap (25%), same-time-last-year pace gap when available (15%), and booking-window urgency (10%). A score of 45 is exposed. A verified event still needs materiality of at least 65, and each market exposes at most five highest-priority distinct event families in Needs Review per refresh; eligible overflow remains on Watchlist. This ranking never calculates a rate premium or stay rule.
- Migration `082_market_signal_briefs_and_actions.sql` adds a cached/audited `market_signal_briefs` ledger and brief-bound reviews. Eligible `review_now` snapshots are generated through Vercel AI SDK `ToolLoopAgent` and AI Gateway with governed model `openai/gpt-5.6-luna`. Cache identity is impact + deterministic input hash + prompt version + model. Structured output passes a deterministic grounding and commercial-safety validator, with one automatic repair attempt; unsupported dates, uncertainty artifacts, currency amounts, and numeric commercial recommendations fail closed. The model only explains already-computed evidence and cannot own materiality/vulnerability math or claim an action was performed.
- The same migration adds SECURITY INVOKER RPCs for creating a bounded internal recommendation Adjustment or linking an existing open related Adjustment. Both require an authenticated `market_signals:edit` reviewer, `adjustments:create`, a completed current brief, and a still-eligible impact; creation also requires a currently exposed approved listing. The operation appends its review in the same transaction. It never writes PriceLabs, PMS, OTA, rates, minimum stays, or channel restrictions.
- Migrations `083_market_signal_scale_orchestration.sql` and `084_market_signal_due_cadence.sql` add durable per-market jobs, one-active-job-per-market deduplication, atomic lease claiming with expired-lease recovery, bounded retry/dead-letter behavior, 30-day terminal-job retention, service-role-only worker RPCs, and an atomic set-based scoring replacement. Both were applied on 2026-08-21 without applying pending migration 075.
- `GET /api/cron/market-signals` remains a protected standalone worker endpoint requiring `Authorization: Bearer $CRON_SECRET`, but it is not a third Vercel Cron: the connected project rejected the every-minute schedule under its current cron plan. The existing daily Stripe cron now enqueues due provider work and drains up to five market jobs within its 300-second budget; the PriceLabs cron's inventory jobs use lower priority so the later provider refresh can fold in the same new inventory evidence. An editor's Queue refresh action enqueues one high-priority job and immediately drains it with the same lease/retry worker. Higher-frequency production monitoring requires upgrading the Vercel cron allowance or adding an authenticated external scheduler.
- Every privileged cron route fails closed when `CRON_SECRET` is absent as well as when the bearer value is wrong; a missing deployment variable must never turn a sync endpoint into an unauthenticated route.
- The daily PriceLabs cron enqueues `inventory_refresh` for every active managed market after its listing/report work. These jobs recalculate vulnerability and fill cached briefs without calling any event provider, so the 90-day PredictHQ beta can be removed or allowed to expire without disabling inventory-only rescoring.
- GDELT/news and official-feed adapters remain unwired. There is still no external notification, automatic Adjustment mutation, PriceLabs write, PMS write, or OTA write.

## GHL V1 handoff and Granola (not live)

This draft introduces an opt-in scheduled Assembly provisioning path separate from the existing on-demand Assembly UI. Default-disabled feature flags independently gate journey endpoints, Assembly writes, GHL progress writes and Granola reads. Native GHL document `fillableFields` must prove legal name and itemized addresses; exact invoice/Stripe linkage must be configured from real provider evidence. Assembly create/invite intents persist before writes and uncertain outcomes require reconciliation. Portal first login is separate from software verification. Granola keys remain server-side; only summaries are projected into private persistence, not transcripts/private notes or outbound CRM messages. Trusted sales appointment mapping is explicitly required. See the V1 runbook for deployment gates and recovery.

## 2026-09-04 — Live GHL document pagination limit

The authenticated v3 `GET /proposals/document` endpoint returns HTTP 422 for `limit=100` with the message that limit must not exceed 21. A `limit=21` request succeeds. V1 uses 21-record pages, exact bound document-ID matching and a 25-second overall lookup budget. This is a live-provider finding; the public API reference currently lists a numeric limit without the maximum.

## 2026-09-04 — Native GHL host behavior

Both V1 survey scripts are installed; client origin is `https://links.revfactor.io`, backend origin is `https://hub.revfactor.io` (runtime still disabled). The native footer is outside `form#_builder-form`; capture the form parent boundary. Next emits a native tracking POST even when partial contact creation is disabled, so the host blocks native provider writes. Hydration dispatches radio change only for the checked choice. Native email rerender resets visible input, so show authenticated email read-only in the host. No GHL object upsert is used; Hub owns persisted answers. See `docs/ghl/native-v1/INSTALLATION.md`.
