"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  ADJUSTMENT_TAGS,
  ADJUSTMENT_URGENCIES,
  BOOKING_WINDOWS,
  adjustmentShareUrl,
} from "@/lib/adjustments"
import type { Adjustment } from "@/lib/types"
import { createAdjustment, getAdjustmentFormOptions, updateAdjustment } from "./actions"

type ClientOption = {
  id: string
  name: string
  listings: { id: string; name: string }[]
}

export function AdjustmentDialog({
  open,
  onOpenChange,
  whatsappInviteUrl,
  defaultClientId,
  adjustment,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  whatsappInviteUrl: string | null
  defaultClientId?: string
  adjustment?: Adjustment | null
}) {
  const [clients, setClients] = useState<ClientOption[] | null>(null)
  const [saving, setSaving] = useState(false)

  const [clientId, setClientId] = useState(defaultClientId ?? "")
  const [scope, setScope] = useState("single_listing")
  const [listingId, setListingId] = useState("")
  const [tag, setTag] = useState("")
  const [targetValue, setTargetValue] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [bookingWindow, setBookingWindow] = useState("")
  const [urgency, setUrgency] = useState("medium")
  const [requestedBy, setRequestedBy] = useState("")
  const [originMessage, setOriginMessage] = useState("")

  useEffect(() => {
    if (open && !clients) {
      getAdjustmentFormOptions().then((result) => {
        if ("error" in result && result.error) toast.error(result.error)
        setClients(result.clients)
      })
    }
  }, [open, clients])

  // Edit mode: prefill from the existing adjustment when the dialog opens
  useEffect(() => {
    if (!open || !adjustment) return
    setClientId(adjustment.client_id)
    setScope(adjustment.scope)
    setListingId(adjustment.listing_id ?? "")
    setTag(adjustment.tag)
    setTargetValue(adjustment.target_value ?? "")
    setDateFrom(adjustment.date_from ?? "")
    setDateTo(adjustment.date_to ?? "")
    setBookingWindow(adjustment.booking_window ?? "")
    setUrgency(adjustment.urgency)
    setRequestedBy(adjustment.requested_by ?? "")
    setOriginMessage(adjustment.origin_message ?? "")
  }, [open, adjustment])

  const selectedClient = clients?.find((c) => c.id === clientId)

  // Single-listing clients: picking the client picks the listing. Keeps a
  // selection that already belongs to the client (edit-mode prefill).
  useEffect(() => {
    if (scope !== "single_listing") {
      setListingId("")
      return
    }
    if (!selectedClient) return
    if (selectedClient.listings.some((l) => l.id === listingId)) return
    setListingId(
      selectedClient.listings.length === 1 ? selectedClient.listings[0].id : ""
    )
  }, [clientId, scope, selectedClient, listingId])

  function resetForm() {
    setClientId(defaultClientId ?? "")
    setScope("single_listing")
    setListingId("")
    setTag("")
    setTargetValue("")
    setDateFrom("")
    setDateTo("")
    setBookingWindow("")
    setUrgency("medium")
    setRequestedBy("")
    setOriginMessage("")
  }

  async function handleSave() {
    setSaving(true)
    try {
      await submit()
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    const formData = new FormData()
    formData.set("scope", scope)
    formData.set("client_id", clientId)
    formData.set("listing_id", listingId)
    formData.set("tag", tag)
    formData.set("target_value", targetValue)
    formData.set("date_from", dateFrom)
    formData.set("date_to", dateTo)
    formData.set("booking_window", bookingWindow)
    formData.set("urgency", urgency)
    formData.set("requested_by", requestedBy)
    formData.set("origin_message", originMessage)

    if (adjustment) {
      const result = await updateAdjustment(adjustment.id, formData)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Adjustment updated")
      onOpenChange(false)
      return
    }

    const result = await createAdjustment(formData)

    if (result.error || !result.publicToken) {
      toast.error(result.error ?? "Failed to create adjustment")
      return
    }

    // Copy the share link, then open the WhatsApp group so it can be pasted.
    // A single deep-link can't open a specific group AND pre-fill text.
    try {
      await navigator.clipboard.writeText(adjustmentShareUrl(result.publicToken))
      toast.success("Adjustment created — link copied, paste it in the group")
    } catch {
      toast.success("Adjustment created")
    }
    if (whatsappInviteUrl) window.open(whatsappInviteUrl, "_blank")

    resetForm()
    onOpenChange(false)
  }

  const canSave =
    !!clientId && !!tag && (scope === "portfolio" || !!listingId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{adjustment ? "Edit Adjustment" : "New Adjustment"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId} disabled={!clients}>
                <SelectTrigger>
                  <SelectValue placeholder={clients ? "Select client" : "Loading clients…"} />
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
            <div className="grid gap-1.5">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single_listing">Single listing</SelectItem>
                  <SelectItem value="portfolio">Portfolio (group)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {scope === "single_listing" && (
            <div className="grid gap-1.5">
              <Label>Listing</Label>
              <Select
                value={listingId}
                onValueChange={setListingId}
                disabled={!selectedClient}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={selectedClient ? "Select listing" : "Pick a client first"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(selectedClient?.listings ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Change</Label>
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger>
                  <SelectValue placeholder="What changes?" />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_TAGS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Target value</Label>
              <Input
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="e.g. → 3 nights"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Booking window</Label>
              <Select value={bookingWindow} onValueChange={setBookingWindow}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  {BOOKING_WINDOWS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Urgency</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_URGENCIES.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Requested by</Label>
            <Input
              value={requestedBy}
              onChange={(e) => setRequestedBy(e.target.value)}
              placeholder="Client contact or internal initiative"
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Original message</Label>
            <Textarea
              value={originMessage}
              onChange={(e) => setOriginMessage(e.target.value)}
              placeholder="Paste the WhatsApp message so context isn't lost"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving
              ? "Saving…"
              : adjustment
                ? "Save changes"
                : "Create & copy link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
