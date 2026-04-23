"use client"

import { useEffect, useState } from "react"
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
import { createListingAction, getClientOptionsAction, updateListingAction } from "./actions"

type ListingFormData = {
  id?: string
  client_id: string
  name: string
  status?: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
}

type ClientOption = { id: string; name: string }

const AIRBNB_BASE = "https://www.airbnb.com/rooms/"
const PRICELABS_BASE = "https://app.pricelabs.co/pricing_dashboard?listings="

function extractAirbnbId(value: string): string {
  if (value.includes("airbnb.com/rooms/")) {
    const match = value.match(/airbnb\.com\/rooms\/(\d+)/)
    return match?.[1] ?? value
  }
  return value
}

function extractPricelabsId(value: string): string {
  if (value.includes("pricelabs.co")) {
    const match = value.match(/listings=(\d+)/)
    return match?.[1] ?? value
  }
  return value
}

function airbnbIdFromLink(link: string | null): string {
  if (!link) return ""
  return extractAirbnbId(link)
}

function pricelabsIdFromLink(link: string | null): string {
  if (!link) return ""
  return extractPricelabsId(link)
}

function pricelabsIdFromListing(listing?: ListingFormData): string {
  if (listing?.listing_id) return listing.listing_id
  if (listing?.pricelabs_link) return pricelabsIdFromLink(listing.pricelabs_link)
  return ""
}

const EMPTY: ListingFormData = {
  client_id: "",
  name: "",
  status: "active",
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  listing?: ListingFormData
}) {
  const isEdit = !!listing?.id
  const [form, setForm] = useState<ListingFormData>(listing ?? EMPTY)
  const [airbnbId, setAirbnbId] = useState(airbnbIdFromLink(listing?.airbnb_link ?? null))
  const [pricelabsId, setPricelabsId] = useState(pricelabsIdFromListing(listing))
  const [saving, setSaving] = useState(false)
  const [clients, setClients] = useState<ClientOption[] | null>(null)

  useEffect(() => {
    if (!open || clients) return
    let cancelled = false
    getClientOptionsAction().then((data) => {
      if (!cancelled) setClients(data)
    })
    return () => {
      cancelled = true
    }
  }, [open, clients])

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
    const plId = extractPricelabsId(pricelabsId.trim())
    const input = {
      client_id: form.client_id,
      name: form.name.trim(),
      status: form.status || "active",
      listing_id: plId || null,
      pricelabs_link: plId ? `${PRICELABS_BASE}${plId}` : null,
      airbnb_link: airbnbId.trim() ? `${AIRBNB_BASE}${extractAirbnbId(airbnbId.trim())}` : null,
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
              <Select
                value={form.client_id}
                onValueChange={(v) => set("client_id", v)}
                disabled={clients === null}
              >
                <SelectTrigger id="listing-client">
                  <SelectValue
                    placeholder={clients === null ? "Loading clients..." : "Select client"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="listing-status">Status</Label>
              <Select value={form.status ?? "active"} onValueChange={(v) => set("status", v)}>
                <SelectTrigger id="listing-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active — visible in Clients & Listings</SelectItem>
                  <SelectItem value="inactive">Inactive — hidden, only shown here</SelectItem>
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
              <Label htmlFor="listing-airbnb">Airbnb ID</Label>
              <Input
                id="listing-airbnb"
                value={airbnbId}
                onChange={(e) => setAirbnbId(extractAirbnbId(e.target.value))}
                placeholder="12345678"
              />
              {airbnbId.trim() && (
                <p className="text-muted-foreground text-xs">
                  {AIRBNB_BASE}{airbnbId.trim()}
                </p>
              )}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="listing-pricelabs">PriceLabs / Listing ID</Label>
              <Input
                id="listing-pricelabs"
                value={pricelabsId}
                onChange={(e) => setPricelabsId(extractPricelabsId(e.target.value))}
                placeholder="456319"
              />
              {pricelabsId.trim() && (
                <p className="text-muted-foreground text-xs">
                  {PRICELABS_BASE}{extractPricelabsId(pricelabsId.trim())}
                </p>
              )}
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
