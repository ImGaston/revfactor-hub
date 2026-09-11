import type { Account, Balance, BankRow, ScorecardData } from "./types"

export function monthsEnding(month: string, count = 12) {
  const [y, m] = month.split("-").map(Number)
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(y, m - count + i, 1)).toISOString().slice(0, 7)
  )
}
export function isStripeDeposit(row: BankRow) {
  return Boolean(row.matched_payout_id) || /stripe/i.test(row.payee ?? "")
}
export function monthlyResult(data: ScorecardData, month: string) {
  const bank = data.bank.filter((t) => t.txn_date.startsWith(month))
  const paid = data.expenses.filter(
    (e) => e.is_paid && e.paid_at?.startsWith(month)
  )
  const operating = paid.filter((e) => e.financial_treatment === "operating")
  const stripe = data.payouts
    .filter(
      (p) =>
        p.status === "paid" &&
        p.currency === "usd" &&
        p.arrival_date.startsWith(month)
    )
    .reduce((s, p) => s + Number(p.amount_cents), 0)
  const other = bank
    .filter(
      (t) =>
        t.currency === "usd" &&
        t.direction === "in" &&
        t.flow_class === "external_income" &&
        !isStripeDeposit(t) &&
        t.income_treatment === "operating" &&
        t.income_reviewed_at
    )
    .reduce((s, t) => s + Number(t.amount_cents), 0)
  const expenses = operating.reduce(
    (s, e) => s + Math.round(Number(e.amount) * 100),
    0
  )
  const pending = data.expenses
    .filter((e) => !e.is_paid && e.date.startsWith(month))
    .reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0)
  const incomePending = bank.filter(
    (t) =>
      t.direction === "in" &&
      t.flow_class === "external_income" &&
      !isStripeDeposit(t) &&
      !t.income_reviewed_at
  )
  const partnerIds = new Set(
    data.accounts.filter((a) => a.role === "partner").map((a) => a.id)
  )
  const partnerExpenseIds = new Set(
    data.bank.filter((t) => partnerIds.has(t.account_id)).map((t) => t.id)
  )
  const expensePending = paid.filter(
    (e) =>
      partnerExpenseIds.has(e.bank_transaction_id ?? "") &&
      !e.financial_reviewed_at
  )
  const unlinkedExpenses = bank.filter(
    (t) =>
      t.flow_class === "external_expense" &&
      !partnerIds.has(t.account_id) &&
      !t.expense_id
  )
  const missingPaymentDates = data.expenses.filter(
    (e) => e.is_paid && !e.paid_at && e.date.startsWith(month)
  )
  const unknown = bank.filter(
    (t) => t.flow_class === "unknown" || t.currency !== "usd"
  )
  const reviewed =
    data.reviews.some((r) => r.month === month + "-01") &&
    incomePending.length === 0 &&
    expensePending.length === 0 &&
    unlinkedExpenses.length === 0 &&
    missingPaymentDates.length === 0 &&
    unknown.length === 0
  const revenue = stripe + other
  const result = reviewed || paid.length > 0 ? revenue - expenses : null
  const categories = [...new Set(operating.map((e) => e.category_id))].map(
    (id) => ({
      name: data.categories.find((c) => c.id === id)?.name ?? "Sin categoría",
      cents: operating
        .filter((e) => e.category_id === id)
        .reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0),
    })
  )
  const withdrawals = bank
    .filter(
      (t) =>
        partnerIds.has(t.account_id) &&
        t.direction === "out" &&
        t.flow_class === "external_expense" &&
        !data.expenses.some(
          (e) =>
            e.bank_transaction_id === t.id &&
            e.financial_treatment === "operating"
        )
    )
    .reduce((s, t) => s + Math.abs(Number(t.amount_cents)), 0)
  return {
    month,
    stripe,
    other,
    revenue,
    expenses,
    pending,
    result,
    margin: result !== null && revenue > 0 ? (result / revenue) * 100 : null,
    reviewed,
    categories,
    incomePending,
    expensePending,
    unlinkedExpenses,
    missingPaymentDates,
    unknown,
    withdrawals,
  }
}
export function confirmedBalances(
  accounts: Account[],
  balances: Balance[],
  asOf: string
) {
  const rows = accounts
    .filter((a) => a.is_internal)
    .map((account) => ({
      account,
      balance:
        balances
          .filter(
            (b) => b.account_id === account.id && b.effective_date <= asOf
          )
          .sort(
            (a, b) =>
              b.effective_date.localeCompare(a.effective_date) ||
              b.created_at.localeCompare(a.created_at)
          )[0] ?? null,
    }))
  const sum = (selected: typeof rows) =>
    selected.length > 0 &&
    selected.every((r) => r.balance) &&
    new Set(selected.map((r) => r.balance!.effective_date)).size === 1
      ? selected.reduce((s, r) => s + Number(r.balance!.amount_cents), 0)
      : null
  return {
    rows,
    total: sum(rows),
    operating: sum(
      rows.filter((r) => ["income", "opex"].includes(r.account.role))
    ),
  }
}
