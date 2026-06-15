# Integrations — RevFactor Hub

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
- Contract templates are fetched server-side and passed to lead detail for selection.
- `full_name` splits into `givenName` and `familyName`; single-word names repeat for both fields.

Deep links:

- Individual chat: `https://dashboard.assembly.com/clients/users/details/{assembly_client_id}/messages`
- Company chat: `https://dashboard.assembly.com/companies/{assembly_company_id}/messages`
- Company chat is primary when a company exists; keep a separate Direct Chat link.

Pending Assembly work:

- Inline message reads, reusable message/contact components, Integrations settings tab, send-message dialog, bulk link, contract status polling, optional sent-message audit log.

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

## Stripe and Financials

- API client: `lib/stripe.ts`.
- Secret key: server-only `STRIPE_SECRET_KEY`.
- Financials page is server-side gated to `super_admin`.
- Client to Stripe customer links use the `client_stripe_customers` junction table as the source of truth; do not rely on `clients.stripe_customer_id`.
- Client Billing is derived from the sum of current monthly Stripe subscriptions for every Stripe customer linked through `client_stripe_customers`; the legacy `clients.billing_amount` value is not used for client list/detail reporting.
- Client detail pages let `super_admin` users create or reuse a Stripe customer from `client_stripe_customers`, choose a subscription type deduced from existing Stripe subscriptions, and generate a Checkout Session in `subscription` mode.
- Listings can link to subscriptions via `stripe_subscription_id`. The "Link Listings to Subscription" dialog (`link-subscription-dialog.tsx`) also has a quick-add form that creates a new active listing already associated to the subscription's linked client (`createListingForClient` action) and auto-selects it — for new clients with no listings yet.
- Daily Stripe sync uses API version `2026-05-27.preview` and mirrors subscriptions, invoices, payouts, and reconciled payout balance transactions. Automatic payouts are reconciled only after Stripe reports `reconciliation_status = completed`.
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

## Pacing Chart

Dashboard home has a forward-looking stacked bar chart of portfolio pacing.

- Component: `components/dashboard/pacing-chart.tsx`.
- Data layer: `lib/pacing.ts`.
- Mock data: `lib/pacing-mock.ts`.
- Current state: `023_reservations.sql` and `scripts/seed-reservations.ts` exist but are not yet applied to the dev Supabase project.
- Dashboard currently uses `getMockPacingSource`; after reservations are applied, add a `getPacingSource()` sibling returning the same `PacingSource` shape.

Bucket rules:

```text
last_3d:  booked_date in [today-3, today]
last_7d:  booked_date in [today-7, today-3)
last_14d: booked_date in [today-14, today-7)
older:    booked_date < today-14
```

Data conventions:

- Use UTC anchors everywhere for `today`, `stay_date`, bucket math, and tick labels.
- Window is 60 days forward inclusive of today.
- SQL filters: `booking_status = 'booked'`, `check_in < windowEnd`, `check_out > today`, `.limit(5000)`.
- Cancellation is handled per stay date in the loop; do not filter it only in SQL.
- Denominator is static count of all listings, not per-day active availability.
- `booked_pct` is `booked_total / total_listings * 100`, clamped to 100 and rounded to 1 decimal.

Chart conventions:

- Header controls: multi-select Listings, Clients, States plus range dropdown.
- Default range: 6 months; other presets are 3 months, 1 year, current year.
- Stack order bottom to top: `older`, `last_14d`, `last_7d`, `last_3d`.
- No bar animation; filter re-renders should not flicker.
- Empty states distinguish no matching listings from no reservations in range.

Pending pacing work:

- Single-listing rendering mode, column width tuning, monthly pacing dashboard, reservations table linked from bars.
- Out of scope for MVP: group selector, STLY comparison, real blocked-night denominator, historical pace curves, PMS sync.

## Landing Page to Pipeline Webhook

See `docs/webhook-pipeline-integration.md` for the detailed implementation reference.

Expected Hub endpoint:

- `POST /api/webhooks/new-lead`
- Auth via `x-webhook-secret` matched against server-only `WEBHOOK_SECRET`.
- Use admin client because the request is server-to-server and has no Supabase user session.
- Insert a `leads` row with stage `inquiry`, `sort_order` as max inquiry order + 1, `service_type: null`, `created_by: null`, and submitted contact/scheduling fields.
- Return 201 with `{ success: true, lead_id }`, 400 for validation, 401 for secret mismatch, 500 for unexpected insert errors.
- Do not use `revalidatePath`; Hub users see new leads after reload/navigation.

Landing page caller:

- Make the fetch server-side and never expose `WEBHOOK_SECRET` in the browser.
- Use a 5-second timeout.
- Log failures but do not block the user scheduling flow.
