"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { createClientAction, updateClientAction } from "./actions"

type ClientFormData = {
  id?: string
  name: string
  email: string | null
  status: string
  assembly_link: string | null
  onboarding_date: string | null
  ending_date: string | null
  billing_amount: number | null
  autopayment_set_up: boolean
  stripe_dashboard: string | null
}

const EMPTY: ClientFormData = {
  name: "",
  email: null,
  status: "active",
  assembly_link: null,
  onboarding_date: null,
  ending_date: null,
  billing_amount: null,
  autopayment_set_up: false,
  stripe_dashboard: null,
}

export function ClientDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: ClientFormData
}) {
  const isEdit = !!client?.id
  const [form, setForm] = useState<ClientFormData>(client ?? EMPTY)
  const [saving, setSaving] = useState(false)

  function set<K extends keyof ClientFormData>(key: K, value: ClientFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error("Name is required")
      return
    }

    setSaving(true)
    const input = {
      name: form.name.trim(),
      email: form.email?.trim() || null,
      status: form.status,
      assembly_link: form.assembly_link?.trim() || null,
      onboarding_date: form.onboarding_date || null,
      ending_date: form.ending_date || null,
      billing_amount: form.billing_amount,
      autopayment_set_up: form.autopayment_set_up,
      stripe_dashboard: form.stripe_dashboard?.trim() || null,
    }

    const result = isEdit
      ? await updateClientAction(client!.id!, input)
      : await createClientAction(input)

    setSaving(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(isEdit ? "Client updated" : "Client created")
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Client" : "New Client"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Client name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value || null)}
                placeholder="client@email.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="onboarding_date">Onboarding Date</Label>
              <Input
                id="onboarding_date"
                type="date"
                value={form.onboarding_date ?? ""}
                onChange={(e) => set("onboarding_date", e.target.value || null)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ending_date">Ending Date</Label>
              <Input
                id="ending_date"
                type="date"
                value={form.ending_date ?? ""}
                onChange={(e) => set("ending_date", e.target.value || null)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billing_amount">Billing ($/mo)</Label>
              <Input
                id="billing_amount"
                type="number"
                step="0.01"
                value={form.billing_amount ?? ""}
                onChange={(e) =>
                  set("billing_amount", e.target.value ? Number(e.target.value) : null)
                }
                placeholder="0.00"
              />
            </div>

            <div className="flex items-center gap-3 pt-6">
              <Switch
                id="autopayment"
                checked={form.autopayment_set_up}
                onCheckedChange={(v) => set("autopayment_set_up", v)}
              />
              <Label htmlFor="autopayment">Autopayment</Label>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="assembly_link">Assembly Link</Label>
              <Input
                id="assembly_link"
                value={form.assembly_link ?? ""}
                onChange={(e) => set("assembly_link", e.target.value || null)}
                placeholder="https://..."
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="stripe_dashboard">Stripe Dashboard</Label>
              <Input
                id="stripe_dashboard"
                value={form.stripe_dashboard ?? ""}
                onChange={(e) => set("stripe_dashboard", e.target.value || null)}
                placeholder="https://dashboard.stripe.com/..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
