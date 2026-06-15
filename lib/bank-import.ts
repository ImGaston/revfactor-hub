// Pure, client- and server-safe helpers for importing Relay bank statements.
// No `next/headers` or Supabase imports here so the import dialog can classify
// rows for preview and the server action can reuse the exact same logic.

import type {
  BankAccount,
  ExpenseCategory,
  RecurringExpense,
  StripePayout,
} from "@/lib/types"

export type BankFlowClass =
  | "external_income"
  | "external_expense"
  | "internal_transfer"
  | "profit_first"
  | "unknown"

export type RawBankRow = {
  isoDate: string // YYYY-MM-DD
  payee: string
  counterpartyAccount: string
  txnType: string
  description: string
  reference: string
  status: string
  amountCents: number // signed
  currency: string
  balanceCents: number | null
}

export type ClassifiedBankRow = RawBankRow & {
  direction: "in" | "out"
  flowClass: BankFlowClass
  suggestedCategoryId: string | null
  matchedRecurringId: string | null
  matchedPayoutId: string | null
  createExpense: boolean
  dedupeHash: string
}

const RELAY_HEADERS = [
  "Date",
  "Payee",
  "Account #",
  "Transaction Type",
  "Description",
  "Reference",
  "Status",
  "Amount",
  "Currency",
  "Balance",
]

// Quote-aware single CSV line splitter (mirrors the pipeline lead importer).
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      result.push(current)
      current = ""
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

// Convert a Relay date like "5/29/2026" to ISO "2026-05-29".
function toIsoDate(value: string): string {
  const trimmed = value.trim()
  const parts = trimmed.split("/")
  if (parts.length === 3) {
    const [month, day, year] = parts
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
  }
  return trimmed
}

// Parse a signed money string ("+308.03", "-92.41", "1,396.80") to cents.
export function toCents(value: string): number {
  const cleaned = value.replace(/[$,\s]/g, "")
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return 0
  const amount = Number(cleaned)
  if (Number.isNaN(amount)) return 0
  return Math.round(amount * 100)
}

export function isRelayHeader(headerLine: string): boolean {
  const cells = parseCsvLine(headerLine).map((c) => c.trim().toLowerCase())
  return RELAY_HEADERS.every((h) => cells.includes(h.toLowerCase()))
}

export function parseRelayCsv(text: string): RawBankRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")
  if (lines.length === 0) return []

  const header = parseCsvLine(lines[0]).map((c) =>
    c.trim().toLowerCase().replace(/\s+/g, " ")
  )
  const col = (name: string) => header.indexOf(name.toLowerCase())
  const idx = {
    date: col("date"),
    payee: col("payee"),
    account: col("account #"),
    type: col("transaction type"),
    description: col("description"),
    reference: col("reference"),
    status: col("status"),
    amount: col("amount"),
    currency: col("currency"),
    balance: col("balance"),
  }

  const rows: RawBankRow[] = []
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line)
    const get = (i: number) => (i >= 0 ? (cells[i]?.trim() ?? "") : "")
    const rawDate = get(idx.date)
    const rawAmount = get(idx.amount)
    if (!rawDate || rawAmount === "") continue
    const balanceRaw = get(idx.balance)
    rows.push({
      isoDate: toIsoDate(rawDate),
      payee: get(idx.payee),
      counterpartyAccount: get(idx.account),
      txnType: get(idx.type),
      description: get(idx.description),
      reference: get(idx.reference),
      status: get(idx.status),
      amountCents: toCents(rawAmount),
      currency: (get(idx.currency) || "usd").toLowerCase(),
      balanceCents: balanceRaw ? toCents(balanceRaw) : null,
    })
  }
  return rows
}

export function normalizePayee(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

// Try to read the account number from a Relay filename like
// "Relay 2026-05-01 #6878.csv".
export function accountNumberFromFilename(filename: string): string | null {
  const match = filename.match(/#\s*(\d{3,})/)
  return match ? match[1] : null
}

export function classifyRow(
  row: RawBankRow,
  accountsByNumber: Map<string, BankAccount>
): { flowClass: BankFlowClass; direction: "in" | "out" } {
  const direction: "in" | "out" = row.amountCents < 0 ? "out" : "in"
  const type = row.txnType.toLowerCase()

  if (type.includes("transfer")) {
    const counterparty = accountsByNumber.get(row.counterpartyAccount.trim())
    const role = counterparty?.role
    const flowClass: BankFlowClass =
      role === "partner" || role === "tax" ? "profit_first" : "internal_transfer"
    return { flowClass, direction }
  }
  if (type === "receive") return { flowClass: "external_income", direction }
  if (type === "spend") return { flowClass: "external_expense", direction }
  return { flowClass: "unknown", direction }
}

// Vendor keyword → expense category name. Lets known recurring software and
// contractor payees auto-categorize on import.
const CATEGORY_KEYWORDS: { keywords: string[]; categoryName: string }[] = [
  {
    categoryName: "Software & Tools",
    keywords: [
      "claude",
      "anthropic",
      "openai",
      "rankbreeze",
      "airroi",
      "procloser",
      "assembly",
      "copilot",
      "pricelabs",
      "notion",
      "slack",
      "zoom",
      "vercel",
      "supabase",
      "hostaway",
      "hospitable",
    ],
  },
  {
    categoryName: "Contractors",
    keywords: ["andres", "paz ponce", "emily", "marx", "montecinos"],
  },
]

export function suggestCategoryId(
  payee: string,
  categories: ExpenseCategory[]
): string | null {
  const normalized = normalizePayee(payee)
  if (!normalized) return null
  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.keywords.some((kw) => normalized.includes(normalizePayee(kw)))) {
      const category = categories.find((c) => c.name === rule.categoryName)
      if (category) return category.id
    }
  }
  return null
}

// Match a spend to a recurring template by shared leading token + amount within
// a small tolerance (whichever is larger: 2% or $1).
export function matchRecurring(
  row: RawBankRow,
  recurring: RecurringExpense[]
): string | null {
  if (row.amountCents >= 0) return null
  const amount = Math.abs(row.amountCents)
  const payee = normalizePayee(row.payee)
  if (!payee) return null
  const payeeFirst = payee.split(" ")[0]

  for (const template of recurring) {
    if (!template.is_active) continue
    const description = normalizePayee(template.description)
    if (!description) continue
    const sharesToken =
      description.includes(payeeFirst) ||
      payee.includes(description.split(" ")[0])
    if (!sharesToken) continue
    const templateCents = Math.round(Number(template.amount) * 100)
    const tolerance = Math.max(Math.round(templateCents * 0.02), 100)
    if (Math.abs(templateCents - amount) <= tolerance) return template.id
  }
  return null
}

// Match a Stripe deposit to a mirrored payout by exact amount and arrival date
// within ±3 days.
export function matchPayout(
  row: RawBankRow,
  payouts: StripePayout[]
): string | null {
  if (row.amountCents <= 0) return null
  if (!normalizePayee(row.payee).includes("stripe")) return null
  const rowTime = new Date(`${row.isoDate}T00:00:00Z`).getTime()
  const windowMs = 3 * 24 * 60 * 60 * 1000

  for (const payout of payouts) {
    if (Number(payout.amount_cents) !== row.amountCents) continue
    const arrivalTime = new Date(payout.arrival_date).getTime()
    if (Math.abs(arrivalTime - rowTime) <= windowMs) return payout.id
  }
  return null
}

// Idempotent key for a transaction. The running balance distinguishes
// otherwise-identical same-day rows.
export function dedupeHash(accountNumber: string, row: RawBankRow): string {
  return [
    accountNumber,
    row.isoDate,
    row.amountCents,
    row.balanceCents ?? "",
    normalizePayee(row.payee),
    row.txnType.toLowerCase(),
  ].join("|")
}

export type ClassifyContext = {
  accountNumber: string
  accounts: BankAccount[]
  categories: ExpenseCategory[]
  recurring: RecurringExpense[]
  payouts: StripePayout[]
}

export function classifyRows(
  rows: RawBankRow[],
  ctx: ClassifyContext
): ClassifiedBankRow[] {
  const byNumber = new Map(ctx.accounts.map((a) => [a.account_number, a]))
  return rows.map((row) => {
    const { flowClass, direction } = classifyRow(row, byNumber)
    const isExpense = flowClass === "external_expense"
    return {
      ...row,
      direction,
      flowClass,
      suggestedCategoryId: isExpense
        ? suggestCategoryId(row.payee, ctx.categories)
        : null,
      matchedRecurringId: isExpense ? matchRecurring(row, ctx.recurring) : null,
      matchedPayoutId:
        flowClass === "external_income" ? matchPayout(row, ctx.payouts) : null,
      createExpense: isExpense,
      dedupeHash: dedupeHash(ctx.accountNumber, row),
    }
  })
}
