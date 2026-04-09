"use client"

import { useState } from "react"
import { Search, Plus, Check, X, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { Expense, ExpenseCategory } from "@/lib/types"
import { ExpenseDialog } from "./expense-dialog"
import { deleteExpense, markExpensePaid, markExpenseUnpaid } from "./actions"

export function ExpensesTable({
  expenses,
  categories,
}: {
  expenses: Expense[]
  categories: ExpenseCategory[]
}) {
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [paidFilter, setPaidFilter] = useState<string>("all")
  const [monthFilter, setMonthFilter] = useState<string>("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Get unique months from expenses for filter
  const months = [...new Set(expenses.map((e) => e.date.substring(0, 7)))].sort().reverse()

  const filtered = expenses.filter((e) => {
    if (typeFilter !== "all" && e.type !== typeFilter) return false
    if (paidFilter === "paid" && !e.is_paid) return false
    if (paidFilter === "unpaid" && e.is_paid) return false
    if (monthFilter !== "all" && !e.date.startsWith(monthFilter)) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        e.description.toLowerCase().includes(q) ||
        (e.expense_categories?.name.toLowerCase().includes(q) ?? false) ||
        (e.notes?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  const totalFiltered = filtered.reduce((sum, e) => sum + Number(e.amount), 0)

  async function handleTogglePaid(expense: Expense) {
    const result = expense.is_paid
      ? await markExpenseUnpaid(expense.id)
      : await markExpensePaid(expense.id)
    if (result.error) {
      toast.error(result.error)
    }
  }

  async function handleDelete() {
    if (!deletingId) return
    const result = await deleteExpense(deletingId)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Expense deleted")
    }
    setDeletingId(null)
  }

  function formatMonth(ym: string): string {
    const [y, m] = ym.split("-")
    const date = new Date(Number(y), Number(m) - 1)
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric" })
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search expenses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={monthFilter} onValueChange={setMonthFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All months" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All months</SelectItem>
            {months.map((m) => (
              <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="fixed">Fixed</SelectItem>
            <SelectItem value="variable">Variable</SelectItem>
          </SelectContent>
        </Select>
        <Select value={paidFilter} onValueChange={setPaidFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="All status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button size="sm" onClick={() => { setEditingExpense(null); setDialogOpen(true) }}>
            <Plus className="mr-1.5 size-3.5" />
            Add Expense
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{filtered.length} expense{filtered.length !== 1 ? "s" : ""}</span>
        <span className="text-muted-foreground/50">|</span>
        <span className="font-mono font-medium text-foreground">${totalFiltered.toLocaleString()}</span>
        <span>total</span>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-center">Paid</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {expenses.length === 0 ? "No expenses yet" : "No matching expenses"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((expense) => (
                <TableRow key={expense.id} className={expense.is_paid ? "opacity-60" : ""}>
                  <TableCell className="text-sm">
                    {new Date(expense.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </TableCell>
                  <TableCell>
                    <div>
                      <span className="font-medium text-sm">{expense.description}</span>
                      {expense.notes && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{expense.notes}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {expense.expense_categories ? (
                      <Badge variant="outline" className="text-xs">{expense.expense_categories.name}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs capitalize">{expense.type}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">
                    ${Number(expense.amount).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => handleTogglePaid(expense)}
                      title={expense.is_paid ? "Mark unpaid" : "Mark paid"}
                    >
                      {expense.is_paid ? (
                        <Check className="size-4 text-emerald-600" />
                      ) : (
                        <X className="size-4 text-muted-foreground" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => { setEditingExpense(expense); setDialogOpen(true) }}
                      >
                        <Pencil className="size-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => setDeletingId(expense.id)}
                      >
                        <Trash2 className="size-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Expense Dialog */}
      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editingExpense}
        categories={categories}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
