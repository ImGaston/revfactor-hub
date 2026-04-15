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
import { createListingAction } from "@/app/(authenticated)/settings/listings/actions"

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

export function AddListingDialog({
  open,
  onOpenChange,
  clientId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId: string
}) {
  const [name, setName] = useState("")
  const [city, setCity] = useState("")
  const [state, setState] = useState("")
  const [airbnbId, setAirbnbId] = useState("")
  const [pricelabsId, setPricelabsId] = useState("")
  const [saving, setSaving] = useState(false)

  function reset() {
    setName("")
    setCity("")
    setState("")
    setAirbnbId("")
    setPricelabsId("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }

    setSaving(true)
    const plId = extractPricelabsId(pricelabsId.trim())
    const result = await createListingAction({
      client_id: clientId,
      name: name.trim(),
      status: "active",
      listing_id: plId || null,
      pricelabs_link: plId ? `${PRICELABS_BASE}${plId}` : null,
      airbnb_link: airbnbId.trim()
        ? `${AIRBNB_BASE}${extractAirbnbId(airbnbId.trim())}`
        : null,
      city: city.trim() || null,
      state: state.trim() || null,
    })
    setSaving(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Listing created")
      reset()
      onOpenChange(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Listing</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="new-listing-name">Name *</Label>
              <Input
                id="new-listing-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Listing name"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-listing-city">City</Label>
              <Input
                id="new-listing-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Austin"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-listing-state">State</Label>
              <Input
                id="new-listing-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="TX"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="new-listing-airbnb">Airbnb ID</Label>
              <Input
                id="new-listing-airbnb"
                value={airbnbId}
                onChange={(e) => setAirbnbId(extractAirbnbId(e.target.value))}
                placeholder="12345678"
              />
              {airbnbId.trim() && (
                <p className="text-muted-foreground text-xs truncate">
                  {AIRBNB_BASE}{airbnbId.trim()}
                </p>
              )}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="new-listing-pricelabs">PriceLabs / Listing ID</Label>
              <Input
                id="new-listing-pricelabs"
                value={pricelabsId}
                onChange={(e) =>
                  setPricelabsId(extractPricelabsId(e.target.value))
                }
                placeholder="456319"
              />
              {pricelabsId.trim() && (
                <p className="text-muted-foreground text-xs truncate">
                  {PRICELABS_BASE}{extractPricelabsId(pricelabsId.trim())}
                </p>
              )}
            </div>
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
              {saving ? "Creating..." : "Create Listing"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
