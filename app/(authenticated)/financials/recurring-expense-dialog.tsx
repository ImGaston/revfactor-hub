"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { RecurringExpense, ExpenseCategory } from "@/lib/types"
import { createRecurringExpense, updateRecurringExpense } from "./actions"

export function RecurringExpenseDialog({
  open,
  onOpenChange,
  recurring,
  categories,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recurring: RecurringExpense | null
  categories: ExpenseCategory[]
}) {
  const isEdit = !!recurring

  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [type, setType] = useState<"fixed" | "variable">("fixed")
  const [dayOfMonth, setDayOfMonth] = useState("1")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      if (recurring) {
        setDescription(recurring.description)
        setAmount(String(recurring.amount))
        setCategoryId(recurring.category_id ?? "")
        setType(recurring.type)
        setDayOfMonth(String(recurring.day_of_month))
        setStartDate(recurring.start_date ?? "")
        setEndDate(recurring.end_date ?? "")
        setNotes(recurring.notes ?? "")
      } else {
        setDescription("")
        setAmount("")
        setCategoryId("")
        setType("fixed")
        setDayOfMonth("1")
        setStartDate("")
        setEndDate("")
        setNotes("")
      }
    }
  }, [open, recurring])

  // Auto-set type when category changes
  useEffect(() => {
    if (categoryId) {
      const cat = categories.find((c) => c.id === categoryId)
      if (cat) setType(cat.type)
    }
  }, [categoryId, categories])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    if (isEdit) {
      const result = await updateRecurringExpense(recurring.id, {
        description,
        amount: parseFloat(amount),
        category_id: categoryId || null,
        type,
        day_of_month: parseInt(dayOfMonth, 10),
        start_date: startDate || null,
        end_date: endDate || null,
        notes: notes || null,
      })
      setSaving(false)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Recurring expense updated")
        onOpenChange(false)
      }
    } else {
      const formData = new FormData()
      formData.set("description", description)
      formData.set("amount", amount)
      formData.set("category_id", categoryId)
      formData.set("type", type)
      formData.set("day_of_month", dayOfMonth)
      formData.set("start_date", startDate)
      formData.set("end_date", endDate)
      formData.set("notes", notes)

      const result = await createRecurringExpense(formData)
      setSaving(false)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Recurring expense created")
        onOpenChange(false)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Recurring Expense" : "Add Recurring Expense"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rec-description">Description</Label>
            <Input
              id="rec-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Google Workspace, Salary - Federico"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-amount">Amount ($)</Label>
              <Input
                id="rec-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-day">Day of month</Label>
              <Input
                id="rec-day"
                type="number"
                min="1"
                max="31"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">Charged on this day each month</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "fixed" | "variable")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="variable">Variable</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-start">Start date</Label>
              <Input
                id="rec-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Optional</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-end">End date</Label>
              <Input
                id="rec-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Optional</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-notes">Notes</Label>
            <Textarea
              id="rec-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : isEdit ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
