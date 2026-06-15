"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeftRight,
  Landmark,
  PiggyBank,
  Plus,
  Receipt,
  Upload,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  BankAccount,
  BankFlowClass,
  BankTransaction,
  ExpenseCategory,
  RecurringExpense,
  StripePayout,
} from "@/lib/types"
import { BankImportDialog } from "./bank-import-dialog"
import { FLOW_LABELS, flowBadgeVariant } from "./bank-flow"
import { addBankTransactionToExpense } from "./actions"

function currency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export function BankSection({
  accounts,
  transactions,
  categories,
  recurring,
  payouts,
}: {
  accounts: BankAccount[]
  transactions: BankTransaction[]
  categories: ExpenseCategory[]
  recurring: RecurringExpense[]
  payouts: StripePayout[]
}) {
  const [importOpen, setImportOpen] = useState(false)
  const [accountFilter, setAccountFilter] = useState("all")
  const [monthFilter, setMonthFilter] = useState("all")
  const [flowFilter, setFlowFilter] = useState("all")
  const [addingId, setAddingId] = useState<string | null>(null)
  const router = useRouter()

  async function handleAddExpense(id: string) {
    setAddingId(id)
    const result = await addBankTransactionToExpense(id)
    setAddingId(null)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Added to Expenses")
    router.refresh()
  }

  const accountsById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  )

  const months = useMemo(() => {
    const set = new Set(transactions.map((t) => t.txn_date.slice(0, 7)))
    return [...set].sort().reverse()
  }, [transactions])

  const filtered = transactions.filter((t) => {
    if (accountFilter !== "all" && t.account_id !== accountFilter) return false
    if (monthFilter !== "all" && !t.txn_date.startsWith(monthFilter))
      return false
    if (flowFilter !== "all" && t.flow_class !== flowFilter) return false
    return true
  })

  // Reconciliation scope follows the month filter (or all data).
  const scope = transactions.filter(
    (t) => monthFilter === "all" || t.txn_date.startsWith(monthFilter)
  )
  const stripeDeposits = scope.filter(
    (t) =>
      t.flow_class === "external_income" &&
      (t.payee ?? "").toLowerCase().includes("stripe")
  )
  const matchedDeposits = stripeDeposits.filter((t) => t.matched_payout_id)
  const opexFundedCents = scope
    .filter(
      (t) =>
        t.direction === "in" &&
        (t.flow_class === "internal_transfer" ||
          t.flow_class === "profit_first") &&
        accountsById.get(t.account_id)?.role === "opex"
    )
    .reduce((sum, t) => sum + Number(t.amount_cents), 0)
  const opexSpentCents = scope
    .filter((t) => t.flow_class === "external_expense")
    .reduce((sum, t) => sum + Math.abs(Number(t.amount_cents)), 0)
  const transfersExcluded = scope.filter(
    (t) =>
      t.flow_class === "internal_transfer" || t.flow_class === "profit_first"
  ).length

  const empty = transactions.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Bank reconciliation</h2>
          <p className="text-sm text-muted-foreground">
            Relay statements confirm Stripe deposits and actual OPEX spending.
            Internal and Profit First transfers are excluded.
          </p>
        </div>
        <Button onClick={() => setImportOpen(true)}>
          <Upload className="size-4" />
          Import statement
        </Button>
      </div>

      {empty ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No bank statements imported yet. Click{" "}
            <span className="font-medium">Import statement</span> to upload a
            Relay CSV export.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={Landmark}
              label="Stripe deposits matched"
              value={`${matchedDeposits.length}/${stripeDeposits.length}`}
              detail={`${currency(
                matchedDeposits.reduce(
                  (s, t) => s + Number(t.amount_cents),
                  0
                )
              )} reconciled`}
            />
            <MetricCard
              icon={PiggyBank}
              label="OPEX funded"
              value={currency(opexFundedCents)}
              detail="Profit First transfers into OPEX"
            />
            <MetricCard
              icon={Receipt}
              label="OPEX spent"
              value={currency(opexSpentCents)}
              detail="Real expenses from bank"
            />
            <MetricCard
              icon={ArrowLeftRight}
              label="Transfers excluded"
              value={String(transfersExcluded)}
              detail="Not counted as income or expense"
            />
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>Transactions</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Select value={accountFilter} onValueChange={setAccountFilter}>
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All accounts</SelectItem>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={monthFilter} onValueChange={setMonthFilter}>
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All months</SelectItem>
                    {months.map((month) => (
                      <SelectItem key={month} value={month}>
                        {month}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={flowFilter} onValueChange={setFlowFilter}>
                  <SelectTrigger size="sm" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All classes</SelectItem>
                    {(
                      [
                        "external_income",
                        "external_expense",
                        "internal_transfer",
                        "profit_first",
                        "unknown",
                      ] as BankFlowClass[]
                    ).map((flow) => (
                      <SelectItem key={flow} value={flow}>
                        {FLOW_LABELS[flow]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No transactions match these filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {t.txn_date}
                        </TableCell>
                        <TableCell className="text-sm">
                          {accountsById.get(t.account_id)?.label ??
                            t.bank_accounts?.label ??
                            "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {t.payee || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={flowBadgeVariant(t.flow_class)}
                            className="text-xs"
                          >
                            {FLOW_LABELS[t.flow_class]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {currency(Number(t.amount_cents))}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.expense_id ? (
                            "→ expense"
                          ) : (
                            <div className="flex items-center gap-2">
                              {t.matched_payout_id && <span>✓ payout</span>}
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7"
                                disabled={addingId === t.id}
                                onClick={() => handleAddExpense(t.id)}
                              >
                                <Plus className="size-3.5" />
                                {addingId === t.id
                                  ? "Adding..."
                                  : "Add to expenses"}
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <BankImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        accounts={accounts}
        categories={categories}
        recurring={recurring}
        payouts={payouts}
      />
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  detail: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" />
          <CardTitle>{label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-2xl font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}
