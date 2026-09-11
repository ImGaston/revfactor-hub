import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ScorecardData } from "./types"

import { allRows } from "./pagination"
export { allRows } from "./pagination"

export async function loadScorecard(
  db: SupabaseClient
): Promise<ScorecardData> {
  const { data: revision, error: revisionError } = await db
    .from("financial_ledger_revision")
    .select("revision")
    .eq("id", 1)
    .single()
  if (revisionError) throw new Error(revisionError.message)
  const [
    payouts,
    bank,
    expenses,
    accounts,
    categories,
    balances,
    reviews,
    snapshots,
    clients,
    listings,
  ] = await Promise.all([
    allRows<ScorecardData["payouts"][number]>(
      db,
      "stripe_payouts",
      "id,amount_cents,currency,status,arrival_date"
    ),
    allRows<ScorecardData["bank"][number]>(
      db,
      "bank_transactions",
      "id,account_id,txn_date,payee,amount_cents,currency,direction,flow_class,matched_payout_id,expense_id,counterparty_account,income_treatment,income_reviewed_at"
    ),
    allRows<ScorecardData["expenses"][number]>(
      db,
      "expenses",
      "id,description,amount,date,is_paid,paid_at,category_id,bank_transaction_id,financial_treatment,financial_reviewed_at"
    ),
    allRows<ScorecardData["accounts"][number]>(db, "bank_accounts"),
    allRows<ScorecardData["categories"][number]>(
      db,
      "expense_categories",
      "id,name"
    ),
    allRows<ScorecardData["balances"][number]>(
      db,
      "financial_account_balances"
    ),
    allRows<ScorecardData["reviews"][number]>(db, "financial_month_reviews"),
    allRows<ScorecardData["snapshots"][number]>(db, "financial_mrr_snapshots"),
    allRows<{ id: string; status: string }>(db, "clients", "id,status"),
    allRows<{ id: string; status: string }>(db, "listings", "id,status"),
  ])
  return {
    revision: Number(revision.revision),
    payouts,
    bank,
    expenses,
    accounts,
    categories,
    balances,
    reviews,
    snapshots,
    activeClients: clients.filter((c) => c.status === "active").length,
    activeListings: listings.filter((l) => l.status === "active").length,
    loadedAt: new Date().toISOString(),
  }
}
