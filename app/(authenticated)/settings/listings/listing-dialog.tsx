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
import { createListingAction, updateListingAction } from "./actions"

type ListingFormData = {
  id?: string
  client_id: string
  name: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
}

type ClientOption = { id: string; name: string }

const EMPTY: ListingFormData = {
  client_id: "",
  name: "",
  listing_id: null,
  pricelabs_link: null,
  airbnb_link: null,
  city: null,
  state: null,
}

export function ListingDialog({
  open,
  onOpenChange,
  listing,
  clients,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  listing?: ListingFormData
  clients: ClientOption[]
}) {
  const isEdit = !!listing?.id
  const [form, setForm] = useState<ListingFormData>(listing ?? EMPTY)
  const [saving, setSaving] = useState(false)

  function set<K extends keyof ListingFormData>(key: K, value: ListingFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error("Name is required")
      return
    }
    if (!form.client_id) {
      toast.error("Client is required")
      return
    }

    setSaving(true)
    const input = {
      client_id: form.client_id,
      name: form.name.trim(),
      listing_id: form.listing_id?.trim() || null,
      pricelabs_link: form.pricelabs_link?.trim() || null,
      airbnb_link: form.airbnb_link?.trim() || null,
      city: form.city?.trim() || null,
      state: form.state?.trim() || null,
    }

    const result = isEdit
      ? await updateListingAction(listing!.id!, input)
      : await createListingAction(input)

    setSaving(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(isEdit ? "Listing updated" : "Listing created")
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Listing" : "New Listing"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="listing-name">Name *</Label>
              <Input
                id="listing-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Listing name"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="listing-client">Client *</Label>
              <Select value={form.client_id} onValueChange={(v) => set("client_id", v)}>
                <SelectTrigger id="listing-client">
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="listing-city">City</Label>
              <Input
                id="listing-city"
                value={form.city ?? ""}
                onChange={(e) => set("city", e.target.value || null)}
                placeholder="Austin"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="listing-state">State</Label>
              <Input
                id="listing-state"
                value={form.state ?? ""}
                onChange={(e) => set("state", e.target.value || null)}
                placeholder="TX"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="listing-id">Listing ID</Label>
              <Input
                id="listing-id"
                value={form.listing_id ?? ""}
                onChange={(e) => set("listing_id", e.target.value || null)}
                placeholder="External listing ID"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="listing-airbnb">Airbnb Link</Label>
              <Input
                id="listing-airbnb"
                value={form.airbnb_link ?? ""}
                onChange={(e) => set("airbnb_link", e.target.value || null)}
                placeholder="https://www.airbnb.com/rooms/..."
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="listing-pricelabs">PriceLabs Link</Label>
              <Input
                id="listing-pricelabs"
                value={form.pricelabs_link ?? ""}
                onChange={(e) => set("pricelabs_link", e.target.value || null)}
                placeholder="https://app.pricelabs.co/..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Listing"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
