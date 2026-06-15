"use client"

import { useState } from "react"
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

function splitEvenly(
  listings: { id: string }[],
  amountCents: number
): { listingId: string; amountCents: number }[] {
  if (listings.length === 0) return []

  const baseAmount = Math.trunc(amountCents / listings.length)
  let remainder = amountCents - baseAmount * listings.length

  return listings.map((listing) => {
    const extraCent = remainder > 0 ? 1 : 0
    remainder -= extraCent
    return {
      listingId: listing.id,
      amountCents: baseAmount + extraCent,
    }
  })
}

export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  categories,
  listings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expense: Expense | null
  categories: ExpenseCategory[]
  listings: { id: string; name: string }[]
}) {
  const isEdit = !!expense
  const initialAllocations = (expense?.expense_listing_allocations ?? []).map(
    (allocation) => ({
      listingId: allocation.listing_id,
      amountCents: Number(allocation.amount_cents),
    })
  )

  const [description, setDescription] = useState(expense?.description ?? "")
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "")
  const [categoryId, setCategoryId] = useState(expense?.category_id ?? "")
  const [type, setType] = useState<"fixed" | "variable">(
    expense?.type ?? "variable"
  )
  const [date, setDate] = useState(
    expense?.date ?? new Date().toISOString().split("T")[0]
  )
  const [notes, setNotes] = useState(expense?.notes ?? "")
  const [saving, setSaving] = useState(false)
  const [allocationMode, setAllocationMode] = useState<
    "none" | "single" | "split"
  >(
    initialAllocations.length === 0
      ? "none"
      : initialAllocations.length === 1
        ? "single"
        : "split"
  )
  const [singleListingId, setSingleListingId] = useState(
    initialAllocations.length === 1 ? initialAllocations[0].listingId : ""
  )
  const [splitListingId, setSplitListingId] = useState("")
  const [allocations, setAllocations] =
    useState<{ listingId: string; amountCents: number }[]>(initialAllocations)
  const [automaticSplit, setAutomaticSplit] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const amountCents = Math.round(parseFloat(amount) * 100)
    const submittedAllocations =
      type !== "variable" || allocationMode === "none"
        ? []
        : allocationMode === "single"
          ? singleListingId
            ? [{ listingId: singleListingId, amountCents }]
            : []
          : allocations

    if (
      type === "variable" &&
      allocationMode !== "none" &&
      submittedAllocations.reduce(
        (sum, allocation) => sum + allocation.amountCents,
        0
      ) !== amountCents
    ) {
      setSaving(false)
      toast.error("Listing allocations must equal the expense total")
      return
    }

    if (isEdit) {
      const result = await updateExpense(expense.id, {
        description,
        amount: parseFloat(amount),
        category_id: categoryId || null,
        type,
        date,
        notes: notes || null,
        allocations: submittedAllocations,
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
      formData.set("allocations", JSON.stringify(submittedAllocations))

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
      <DialogContent className="sm:max-w-xl">
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
                onChange={(e) => {
                  const nextAmount = e.target.value
                  setAmount(nextAmount)
                  if (allocationMode === "split" && automaticSplit) {
                    setAllocations(
                      splitEvenly(
                        listings,
                        Math.max(
                          0,
                          Math.round(Number(nextAmount || 0) * 100)
                        )
                      )
                    )
                  }
                }}
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
              <Select
                value={categoryId}
                onValueChange={(value) => {
                  setCategoryId(value)
                  const category = categories.find((item) => item.id === value)
                  if (category) setType(category.type)
                }}
              >
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
              <Select
                value={type}
                onValueChange={(v) => setType(v as "fixed" | "variable")}
              >
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

          {type === "variable" && (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-1.5">
                <Label>Listing allocation</Label>
                <Select
                  value={allocationMode}
                  onValueChange={(value) => {
                    const nextMode = value as "none" | "single" | "split"
                    setAllocationMode(nextMode)
                    if (nextMode === "split") {
                      setAutomaticSplit(true)
                      setAllocations(
                        splitEvenly(
                          listings,
                          Math.max(
                            0,
                            Math.round(Number(amount || 0) * 100)
                          )
                        )
                      )
                    } else {
                      setAutomaticSplit(false)
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    <SelectItem value="single">One listing</SelectItem>
                    <SelectItem value="split">
                      Split between listings
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {allocationMode === "single" && (
                <div className="flex flex-col gap-1.5">
                  <Label>Listing</Label>
                  <Select
                    value={singleListingId}
                    onValueChange={setSingleListingId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select listing" />
                    </SelectTrigger>
                    <SelectContent>
                      {listings.map((listing) => (
                        <SelectItem key={listing.id} value={listing.id}>
                          {listing.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {allocationMode === "split" && (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <Select
                      value={splitListingId}
                      onValueChange={setSplitListingId}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Add a listing" />
                      </SelectTrigger>
                      <SelectContent>
                        {listings
                          .filter(
                            (listing) =>
                              !allocations.some(
                                (allocation) =>
                                  allocation.listingId === listing.id
                              )
                          )
                          .map((listing) => (
                            <SelectItem key={listing.id} value={listing.id}>
                              {listing.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (!splitListingId) return
                        setAutomaticSplit(false)
                        setAllocations((current) => [
                          ...current,
                          { listingId: splitListingId, amountCents: 0 },
                        ])
                        setSplitListingId("")
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {allocations.map((allocation) => (
                      <div
                        key={allocation.listingId}
                        className="flex items-center gap-2"
                      >
                        <span className="flex-1 text-sm">
                          {listings.find(
                            (listing) => listing.id === allocation.listingId
                          )?.name ?? "Listing"}
                        </span>
                        <Input
                          className="w-32"
                          type="number"
                          min="0"
                          step="0.01"
                          value={(allocation.amountCents / 100).toString()}
                          onChange={(event) => {
                            setAutomaticSplit(false)
                            const amountCents = Math.round(
                              Number(event.target.value || 0) * 100
                            )
                            setAllocations((current) =>
                              current.map((item) =>
                                item.listingId === allocation.listingId
                                  ? { ...item, amountCents }
                                  : item
                              )
                            )
                          }}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setAutomaticSplit(false)
                            setAllocations((current) =>
                              current.filter(
                                (item) => item.listingId !== allocation.listingId
                              )
                            )
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {allocations.length} listings selected. Allocated $
                    {(
                      allocations.reduce(
                        (sum, allocation) => sum + allocation.amountCents,
                        0
                      ) / 100
                    ).toLocaleString()}{" "}
                    of ${Number(amount || 0).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          )}

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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
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
