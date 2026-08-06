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
import { Checkbox } from "@/components/ui/checkbox"
import {
  ADJUSTMENT_ORIGINS,
  ADJUSTMENT_SIGNAL_FIELDS,
  ADJUSTMENT_SUGGESTED_ACTIONS,
  ADJUSTMENT_TYPE_CONFIG,
  ADJUSTMENT_URGENCIES,
  BOOKING_WINDOWS,
  adjustmentShareUrl,
  adjustmentTypeOptions,
} from "@/lib/adjustments"
import type { Adjustment, AdjustmentType } from "@/lib/types"
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
  lockOriginToHostpricing = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  whatsappInviteUrl: string | null
  defaultClientId?: string
  adjustment?: Adjustment | null
  // HostPricing users always file as hostpricing — the server enforces this
  // too; hiding the select just keeps the form honest
  lockOriginToHostpricing?: boolean
}) {
  const [clients, setClients] = useState<ClientOption[] | null>(null)
  const [saving, setSaving] = useState(false)

  const defaultOrigin = lockOriginToHostpricing ? "hostpricing" : "internal"
  const [clientId, setClientId] = useState(defaultClientId ?? "")
  const [scope, setScope] = useState("single_listing")
  const [listingId, setListingId] = useState("")
  const [adjustmentType, setAdjustmentType] = useState("")
  const [origin, setOrigin] = useState(defaultOrigin)
  const [targetValue, setTargetValue] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [bookingWindow, setBookingWindow] = useState("")
  const [urgency, setUrgency] = useState("medium")
  const [requestedBy, setRequestedBy] = useState("")
  const [originMessage, setOriginMessage] = useState("")
  const [signals, setSignals] = useState<Record<string, string>>({})
  const [suggestedActions, setSuggestedActions] = useState<string[]>([])
  const [otherAction, setOtherAction] = useState("")

  const config = ADJUSTMENT_TYPE_CONFIG[adjustmentType as AdjustmentType] ?? null
  const isSetup = adjustmentType === "setup"

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
    setAdjustmentType(adjustment.type)
    setOrigin(adjustment.origin)
    setTargetValue(adjustment.target_value ?? "")
    setDateFrom(adjustment.date_from ?? "")
    setDateTo(adjustment.date_to ?? "")
    setBookingWindow(adjustment.booking_window ?? "")
    setUrgency(adjustment.urgency)
    setRequestedBy(adjustment.requested_by ?? "")
    setOriginMessage(adjustment.origin_message ?? "")
    setSignals({ ...(adjustment.signals ?? {}) })
    // Known slugs drive the checkboxes; free-text entries land in "Other"
    const known = new Set<string>(ADJUSTMENT_SUGGESTED_ACTIONS.map((a) => a.value))
    const stored = adjustment.suggested_actions ?? []
    setSuggestedActions(stored.filter((a) => known.has(a)))
    setOtherAction(stored.filter((a) => !known.has(a)).join(", "))
  }, [open, adjustment])

  const selectedClient = clients?.find((c) => c.id === clientId)

  // Initial setup is always per listing (data hygiene: client + listing must exist first)
  useEffect(() => {
    if (isSetup) setScope("single_listing")
  }, [isSetup])

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
    setAdjustmentType("")
    setOrigin(defaultOrigin)
    setTargetValue("")
    setDateFrom("")
    setDateTo("")
    setBookingWindow("")
    setUrgency("medium")
    setRequestedBy("")
    setOriginMessage("")
    setSignals({})
    setSuggestedActions([])
    setOtherAction("")
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
    formData.set("type", adjustmentType)
    formData.set("origin", origin)
    formData.set("target_value", targetValue)
    formData.set("date_from", dateFrom)
    formData.set("date_to", dateTo)
    formData.set("booking_window", bookingWindow)
    formData.set("urgency", urgency)
    formData.set("requested_by", requestedBy)
    formData.set("origin_message", originMessage)
    formData.set("signals", JSON.stringify(signals))
    formData.set(
      "suggested_actions",
      JSON.stringify([
        ...suggestedActions,
        ...(otherAction.trim() ? [otherAction.trim()] : []),
      ])
    )

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

  // Mirrors validateAdjustmentInput — the server re-checks and normalizes
  const hasListingIfNeeded = isSetup || scope === "single_listing" ? !!listingId : true
  const hasTargetIfNeeded = !config?.requiresTarget || !!targetValue.trim()
  const hasDateFromIfNeeded = !config?.requiresDateFrom || !!dateFrom
  const canSave =
    !!clientId &&
    !!adjustmentType &&
    hasListingIfNeeded &&
    hasTargetIfNeeded &&
    hasDateFromIfNeeded

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
              {isSetup ? (
                <p className="flex h-9 items-center text-sm text-muted-foreground">
                  Initial setup is always per listing
                </p>
              ) : (
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single_listing">Single listing</SelectItem>
                    <SelectItem value="portfolio">Portfolio (group)</SelectItem>
                  </SelectContent>
                </Select>
              )}
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
              <Label>Type</Label>
              <Select value={adjustmentType} onValueChange={setAdjustmentType}>
                <SelectTrigger>
                  <SelectValue placeholder="What changes?" />
                </SelectTrigger>
                <SelectContent>
                  {adjustmentTypeOptions(lockOriginToHostpricing, adjustment?.type).map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Origin</Label>
              {lockOriginToHostpricing ? (
                <p className="flex h-9 items-center text-sm text-muted-foreground">
                  HostPricing
                </p>
              ) : (
                <Select value={origin} onValueChange={setOrigin}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ADJUSTMENT_ORIGINS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {origin === "hostpricing" && (
            <p className="text-xs text-muted-foreground">
              Created on HostPricing&apos;s behalf — it will start as a proposal
              pending internal approval.
            </p>
          )}

          {(!config || config.showsTarget) && (
            <div className="grid gap-1.5">
              <Label>
                Target value
                {config && !config.requiresTarget && (
                  <span className="font-normal text-muted-foreground"> (optional)</span>
                )}
              </Label>
              <Input
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder={config?.targetPlaceholder || "e.g. → 3 nights"}
              />
            </div>
          )}

          {(!config || config.showsDates) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>
                  From
                  {config && !config.requiresDateFrom && (
                    <span className="font-normal text-muted-foreground"> (optional)</span>
                  )}
                </Label>
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
          )}

          {config?.showsSignals && (
            <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">
                Report signals{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {ADJUSTMENT_SIGNAL_FIELDS.map((field) => (
                  <div key={field.key} className="grid gap-1">
                    <Label className="text-xs font-normal text-muted-foreground">
                      {field.label}
                    </Label>
                    <Input
                      className="h-8"
                      value={signals[field.key] ?? ""}
                      onChange={(e) =>
                        setSignals((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {config?.showsSuggestions && (
            <div className="grid gap-2">
              <Label>
                Suggested actions{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ADJUSTMENT_SUGGESTED_ACTIONS.map((action) => (
                  <label
                    key={action.value}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={suggestedActions.includes(action.value)}
                      onCheckedChange={(checked) =>
                        setSuggestedActions((prev) =>
                          checked
                            ? [...prev, action.value]
                            : prev.filter((a) => a !== action.value)
                        )
                      }
                    />
                    {action.label}
                  </label>
                ))}
              </div>
              <Input
                value={otherAction}
                onChange={(e) => setOtherAction(e.target.value)}
                placeholder="Other suggestion…"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {(!config || config.showsBookingWindow) && (
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
            )}
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
            {origin === "client" && !originMessage.trim() && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Paste the owner&apos;s message here so the request context isn&apos;t lost.
              </p>
            )}
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
