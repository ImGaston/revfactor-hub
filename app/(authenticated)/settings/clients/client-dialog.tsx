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
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { CLIENT_CHURN_REASONS } from "@/lib/clients"
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
  ending_reason_tags?: string[] | null
  ending_note?: string | null
}

const EMPTY: ClientFormData = {
  name: "",
  email: null,
  status: "active",
  assembly_link: null,
  onboarding_date: new Date().toISOString().split("T")[0],
  ending_date: null,
  billing_amount: null,
  autopayment_set_up: false,
  stripe_dashboard: null,
  ending_reason_tags: [],
  ending_note: null,
}

export function ClientDialog({
  open,
  onOpenChange,
  client,
  isSuperAdmin = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: ClientFormData
  isSuperAdmin?: boolean
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
      // Only super_admin sees/edits churn fields; omit the keys otherwise so
      // a non-super_admin save never wipes existing values.
      ...(isSuperAdmin
        ? {
            ending_reason_tags: form.ending_reason_tags ?? [],
            ending_note: form.ending_note?.trim() || null,
          }
        : {}),
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
              <Select
                value={form.status}
                onValueChange={(v) => {
                  setForm((prev) => ({
                    ...prev,
                    status: v,
                    // Marking inactive: default the ending date to today (editable).
                    ending_date:
                      v === "inactive" && !prev.ending_date
                        ? new Date().toISOString().split("T")[0]
                        : prev.ending_date,
                  }))
                }}
              >
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

            {isSuperAdmin && form.status === "inactive" && (
              <>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Churn Reason</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {CLIENT_CHURN_REASONS.map((reason) => {
                      const selected =
                        form.ending_reason_tags?.includes(reason.value) ?? false
                      return (
                        <Badge
                          key={reason.value}
                          variant={selected ? "default" : "outline"}
                          className="cursor-pointer select-none"
                          onClick={() =>
                            set(
                              "ending_reason_tags",
                              selected
                                ? (form.ending_reason_tags ?? []).filter(
                                    (t) => t !== reason.value
                                  )
                                : [...(form.ending_reason_tags ?? []), reason.value]
                            )
                          }
                        >
                          {reason.label}
                        </Badge>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="ending_note">Churn Note</Label>
                  <Textarea
                    id="ending_note"
                    value={form.ending_note ?? ""}
                    onChange={(e) => set("ending_note", e.target.value || null)}
                    placeholder="Optional context about why the client left..."
                    rows={3}
                  />
                </div>
              </>
            )}

            {isSuperAdmin && (
              <>
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
              </>
            )}

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="assembly_link">Assembly Link</Label>
              <Input
                id="assembly_link"
                value={form.assembly_link ?? ""}
                onChange={(e) => set("assembly_link", e.target.value || null)}
                placeholder="https://..."
              />
            </div>

            {isSuperAdmin && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="stripe_dashboard">Stripe Dashboard</Label>
                <Input
                  id="stripe_dashboard"
                  value={form.stripe_dashboard ?? ""}
                  onChange={(e) => set("stripe_dashboard", e.target.value || null)}
                  placeholder="https://dashboard.stripe.com/..."
                />
              </div>
            )}
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
