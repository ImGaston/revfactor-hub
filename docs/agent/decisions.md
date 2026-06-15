# Decisions — RevFactor Hub

Keep dated decisions here when they should shape future work. Include enough rationale to avoid relitigating the same choice.

## 2026-04-18 — No Page-Level ISR on Authenticated Routes

Authenticated route data should not use `export const revalidate = N`. The app has a tiny internal user base where stale data is noticeable, and auth-cookie cache segmentation limits hit rate. If a query later proves expensive and stable, use targeted cache tags instead.

## 2026-04-18 — Trim List Queries Instead of Adding Client Portfolio SQL View

For `/clients` and `/listings`, list payload trimming is preferred over adding `client_portfolio_summary` as a new SQL dependency. Current scale is small enough, and the view would add RLS/type maintenance surface.

## 2026-04-18 — Lazy-Fetch Dialog Lookup Data

Dialog-only lookup lists, such as clients in listing dialogs, should load when the dialog opens instead of during page load. This keeps common route loads lean while preserving full dialog behavior.

## 2026-04-18 — Keep Detail Pages Unsplintered Unless a Specific Fetch Gets Slow

Do not refactor large interactive detail pages into streamed server shells by default. The complexity is not justified for current dataset sizes.

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
