export type Payout = {
  id: string
  amount_cents: number
  currency: string
  status: string
  arrival_date: string
}
export type Account = {
  id: string
  label: string
  role: string
  account_number: string
  is_internal: boolean
}
export type BankRow = {
  id: string
  account_id: string
  txn_date: string
  payee: string | null
  amount_cents: number
  currency: string
  direction: string
  flow_class: string
  matched_payout_id: string | null
  expense_id: string | null
  counterparty_account: string | null
  income_treatment: string
  income_reviewed_at: string | null
}
export type ExpenseRow = {
  id: string
  description: string
  amount: number
  date: string
  is_paid: boolean
  paid_at: string | null
  category_id: string | null
  bank_transaction_id: string | null
  financial_treatment: string
  financial_reviewed_at: string | null
}
export type Balance = {
  id: string
  account_id: string
  effective_date: string
  amount_cents: number
  created_at: string
}
export type MrrDetail = {
  subscription_id: string
  customer_id: string
  client_id: string | null
  status: string
  mrr_cents: number | null
  reason: string | null
}
export type MrrSnapshot = {
  id: string
  observed_at: string
  calculation_version: string
  valid: boolean
  error: string | null
  mrr_cents: number | null
  past_due_cents: number | null
  paying_clients: number | null
  details: MrrDetail[]
}
export type ScorecardData = {
  revision: number
  payouts: Payout[]
  bank: BankRow[]
  expenses: ExpenseRow[]
  accounts: Account[]
  categories: { id: string; name: string }[]
  balances: Balance[]
  reviews: { month: string; reviewed_at: string }[]
  snapshots: MrrSnapshot[]
  activeClients: number
  activeListings: number
  loadedAt: string
}
