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
import type { Expense, ExpenseCategory } from "@/lib/types"
import { createExpense, updateExpense } from "./actions"

export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  categories,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expense: Expense | null
  categories: ExpenseCategory[]
}) {
  const isEdit = !!expense

  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [type, setType] = useState<"fixed" | "variable">("variable")
  const [date, setDate] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  // Reset form when dialog opens or expense changes
  useEffect(() => {
    if (open) {
      if (expense) {
        setDescription(expense.description)
        setAmount(String(expense.amount))
        setCategoryId(expense.category_id ?? "")
        setType(expense.type)
        setDate(expense.date)
        setNotes(expense.notes ?? "")
      } else {
        setDescription("")
        setAmount("")
        setCategoryId("")
        setType("variable")
        setDate(new Date().toISOString().split("T")[0])
        setNotes("")
      }
    }
  }, [open, expense])

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
      const result = await updateExpense(expense.id, {
        description,
        amount: parseFloat(amount),
        category_id: categoryId || null,
        type,
        date,
        notes: notes || null,
      })
      setSaving(false)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Expense updated")
        onOpenChange(false)
      }
    } else {
      const formData = new FormData()
      formData.set("description", description)
      formData.set("amount", amount)
      formData.set("category_id", categoryId)
      formData.set("type", type)
      formData.set("date", date)
      formData.set("notes", notes)

      const result = await createExpense(formData)
      setSaving(false)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Expense created")
        onOpenChange(false)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Expense" : "Add Expense"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., PriceLabs monthly subscription"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount ($)</Label>
              <Input
                id="amount"
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
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
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

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
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
