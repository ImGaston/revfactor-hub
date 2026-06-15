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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ListingFormFields,
  buildListingFields,
  listingValuesFromRecord,
  type ListingFormValues,
} from "@/components/listings/listing-form-fields"
import {
  createListingAction,
  getClientOptionsAction,
  updateListingAction,
} from "./actions"

type ListingRecord = {
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

export function ListingDialog({
  open,
  onOpenChange,
  listing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  listing?: ListingRecord
}) {
  const isEdit = !!listing?.id
  const [clientId, setClientId] = useState(listing?.client_id ?? "")
  const [status, setStatus] = useState(listing?.status ?? "active")
  const [values, setValues] = useState<ListingFormValues>(
    listingValuesFromRecord(listing)
  )
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!values.name.trim()) {
      toast.error("Name is required")
      return
    }
    if (!clientId) {
      toast.error("Client is required")
      return
    }

    setSaving(true)
    const input = {
      client_id: clientId,
      status: status || "active",
      ...buildListingFields(values),
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
              <Label htmlFor="listing-client">Client *</Label>
              <Select
                value={clientId}
                onValueChange={setClientId}
                disabled={clients === null}
              >
                <SelectTrigger id="listing-client" className="w-full">
                  <SelectValue
                    placeholder={
                      clients === null ? "Loading clients..." : "Select client"
                    }
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
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="listing-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">
                    Active — visible in Clients & Listings
                  </SelectItem>
                  <SelectItem value="inactive">
                    Inactive — hidden, only shown here
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ListingFormFields
            values={values}
            onChange={setValues}
            idPrefix="listing"
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
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
