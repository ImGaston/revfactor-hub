"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertCircle, FileSpreadsheet, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import {
  accountNumberFromFilename,
  classifyRows,
  isRelayHeader,
  parseRelayCsv,
  type ClassifiedBankRow,
} from "@/lib/bank-import"
import type {
  BankAccount,
  ExpenseCategory,
  RecurringExpense,
  StripePayout,
} from "@/lib/types"
import { commitBankImport } from "./actions"
import { FLOW_LABELS, flowBadgeVariant } from "./bank-flow"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: BankAccount[]
  categories: ExpenseCategory[]
  recurring: RecurringExpense[]
  payouts: StripePayout[]
}

function currency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

export function BankImportDialog({
  open,
  onOpenChange,
  accounts,
  categories,
  recurring,
  payouts,
}: Props) {
  const [fileName, setFileName] = useState("")
  const [accountId, setAccountId] = useState("")
  const [rows, setRows] = useState<ClassifiedBankRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function reset() {
    setFileName("")
    setAccountId("")
    setRows([])
    setError(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  function reclassify(raw: ReturnType<typeof parseRelayCsv>, id: string) {
    const account = accounts.find((a) => a.id === id)
    return classifyRows(raw, {
      accountNumber: account?.account_number ?? "",
      accounts,
      categories,
      recurring,
      payouts,
    })
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError(null)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? ""
      const firstLine = text.split(/\r?\n/)[0] ?? ""
      if (!isRelayHeader(firstLine)) {
        setError("This does not look like a Relay statement export.")
        setRows([])
        return
      }
      const raw = parseRelayCsv(text)
      if (raw.length === 0) {
        setError("No transactions found in this file.")
        setRows([])
        return
      }
      const detected = accountNumberFromFilename(file.name)
      const match = detected
        ? accounts.find((a) => a.account_number === detected)
        : undefined
      const id = match?.id ?? accountId
      setAccountId(id)
      setRows(reclassify(raw, id))
    }
    reader.readAsText(file)
  }

  function handleAccountChange(id: string) {
    setAccountId(id)
    // Re-derive classification + dedupe hashes for the newly selected account.
    setRows((prev) => reclassify(prev, id))
  }

  function updateRow(index: number, patch: Partial<ClassifiedBankRow>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    )
  }

  async function handleImport() {
    if (!accountId) {
      setError("Select which account this statement belongs to.")
      return
    }
    setImporting(true)
    const result = await commitBankImport({
      accountId,
      filename: fileName,
      periodStart: null,
      periodEnd: null,
      rows,
    })
    setImporting(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(
      `Imported ${result.imported} transaction${result.imported === 1 ? "" : "s"}` +
        (result.expensesCreated
          ? `, ${result.expensesCreated} expense${result.expensesCreated === 1 ? "" : "s"} created`
          : "") +
        (result.skipped ? `, ${result.skipped} skipped` : "")
    )
    reset()
    onOpenChange(false)
    router.refresh()
  }

  const expenseRows = rows.filter(
    (row) => row.flowClass === "external_expense" && row.createExpense
  )
  const matchedDeposits = rows.filter(
    (row) => row.flowClass === "external_income" && row.matchedPayoutId
  )
  const transfers = rows.filter(
    (row) =>
      row.flowClass === "internal_transfer" || row.flowClass === "profit_first"
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import bank statement</DialogTitle>
          <DialogDescription>
            Upload a Relay CSV export. Transfers are detected and excluded;
            spends become linked expenses.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 && (
          <div
            className="cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Click to upload a Relay CSV</p>
            <p className="mt-1 text-xs text-muted-foreground">.csv files only</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFile}
            />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {error}
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">{fileName}</span>
                <Badge variant="secondary" className="text-xs">
                  {rows.length} rows
                </Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>
                Change file
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bank-account">Account</Label>
              <Select value={accountId} onValueChange={handleAccountChange}>
                <SelectTrigger id="bank-account" className="w-72">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.label} · #{account.account_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {matchedDeposits.length} Stripe deposits matched
              </Badge>
              <Badge variant="outline">
                {expenseRows.length} expenses ·{" "}
                {currency(
                  expenseRows.reduce((s, r) => s + Math.abs(r.amountCents), 0)
                )}
              </Badge>
              <Badge variant="outline">
                {transfers.length} transfers excluded
              </Badge>
            </div>

            <ScrollArea className="h-[360px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Payee</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-center">Expense</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => {
                    const isExpense = row.flowClass === "external_expense"
                    return (
                      <TableRow key={index}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {row.isoDate}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.payee || "—"}
                          {row.matchedPayoutId && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ✓ payout
                            </span>
                          )}
                          {row.matchedRecurringId && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ↺ recurring
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={flowBadgeVariant(row.flowClass)}
                            className="text-xs"
                          >
                            {FLOW_LABELS[row.flowClass]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {currency(row.amountCents)}
                        </TableCell>
                        <TableCell>
                          {isExpense ? (
                            <Select
                              value={row.suggestedCategoryId ?? "none"}
                              onValueChange={(value) =>
                                updateRow(index, {
                                  suggestedCategoryId:
                                    value === "none" ? null : value,
                                })
                              }
                            >
                              <SelectTrigger size="sm" className="w-44">
                                <SelectValue placeholder="Uncategorized" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">
                                  Uncategorized
                                </SelectItem>
                                {categories.map((category) => (
                                  <SelectItem
                                    key={category.id}
                                    value={category.id}
                                  >
                                    {category.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {isExpense ? (
                            <Checkbox
                              checked={row.createExpense}
                              onCheckedChange={(checked) =>
                                updateRow(index, {
                                  createExpense: checked === true,
                                })
                              }
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </ScrollArea>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  reset()
                  onOpenChange(false)
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={importing || !accountId}>
                {importing ? "Importing..." : `Import ${rows.length} rows`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
