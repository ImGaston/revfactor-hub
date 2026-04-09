"use client"

import { useState } from "react"
import {
  Plus,
  Pencil,
  Trash2,
  Play,
  Pause,
  CalendarClock,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { RecurringExpense, ExpenseCategory } from "@/lib/types"
import { RecurringExpenseDialog } from "./recurring-expense-dialog"
import {
  deleteRecurringExpense,
  toggleRecurringExpenseActive,
  generateMonthExpenses,
} from "./actions"

function getMonthOptions(): { value: string; label: string }[] {
  const now = new Date()
  const options: { value: string; label: string }[] = []
  for (let i = 0; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    options.push({ value, label })
  }
  return options
}

function ordinalDay(day: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = day % 100
  return day + (s[(v - 20) % 10] || s[v] || s[0])
}

export function RecurringExpensesTable({
  recurring,
  categories,
  generatedMonths,
}: {
  recurring: RecurringExpense[]
  categories: ExpenseCategory[]
  generatedMonths: Set<string> // which months already have generated entries
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRecurring, setEditingRecurring] = useState<RecurringExpense | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  })

  const monthOptions = getMonthOptions()
  const activeCount = recurring.filter((r) => r.is_active).length
  const totalMonthly = recurring
    .filter((r) => r.is_active)
    .reduce((sum, r) => sum + Number(r.amount), 0)

  async function handleToggleActive(rec: RecurringExpense) {
    const result = await toggleRecurringExpenseActive(rec.id, !rec.is_active)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(rec.is_active ? "Paused" : "Activated")
    }
  }

  async function handleDelete() {
    if (!deletingId) return
    const result = await deleteRecurringExpense(deletingId)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Recurring expense deleted")
    }
    setDeletingId(null)
  }

  async function handleGenerate() {
    setGenerating(true)
    const result = await generateMonthExpenses(selectedMonth)
    setGenerating(false)
    if (result.error) {
      toast.error(result.error)
    } else if (result.generated === 0 && result.skipped > 0) {
      toast.info(`All ${result.skipped} recurring expenses already generated for this month`)
    } else {
      toast.success(
        `Generated ${result.generated} expense${result.generated !== 1 ? "s" : ""}` +
        (result.skipped > 0 ? ` (${result.skipped} already existed)` : "")
      )
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary + Generate */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <CalendarClock className="size-4 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{activeCount}</p>
                <p className="text-xs text-muted-foreground">Active recurring</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-500/10 p-2">
                <Sparkles className="size-4 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold font-mono">${totalMonthly.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Monthly total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-medium">Generate Expenses</p>
            <div className="flex items-center gap-2">
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="h-8 text-sm flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? "Generating..." : "Generate"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {recurring.length} recurring expense{recurring.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={() => { setEditingRecurring(null); setDialogOpen(true) }}>
          <Plus className="mr-1.5 size-3.5" />
          Add Recurring
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Day</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {recurring.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No recurring expenses yet. Add one to get started.
                </TableCell>
              </TableRow>
            ) : (
              recurring.map((rec) => (
                <TableRow key={rec.id} className={!rec.is_active ? "opacity-50" : ""}>
                  <TableCell>
                    <div>
                      <span className="font-medium text-sm">{rec.description}</span>
                      {rec.notes && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{rec.notes}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {rec.expense_categories ? (
                      <Badge variant="outline" className="text-xs">{rec.expense_categories.name}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs capitalize">{rec.type}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">
                    ${Number(rec.amount).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ordinalDay(rec.day_of_month)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={rec.is_active
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
                      }
                    >
                      {rec.is_active ? "Active" : "Paused"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {rec.start_date && (
                      <span>From {new Date(rec.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" })}</span>
                    )}
                    {rec.start_date && rec.end_date && " — "}
                    {rec.end_date && (
                      <span>Until {new Date(rec.end_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" })}</span>
                    )}
                    {!rec.start_date && !rec.end_date && "Ongoing"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => handleToggleActive(rec)}
                        title={rec.is_active ? "Pause" : "Activate"}
                      >
                        {rec.is_active
                          ? <Pause className="size-3.5 text-muted-foreground" />
                          : <Play className="size-3.5 text-emerald-600" />
                        }
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => { setEditingRecurring(rec); setDialogOpen(true) }}
                      >
                        <Pencil className="size-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => setDeletingId(rec.id)}
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

      {/* Dialog */}
      <RecurringExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        recurring={editingRecurring}
        categories={categories}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete recurring expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the template. Already generated expenses will not be affected.
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
