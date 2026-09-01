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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
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
import {
  AIRBNB_CANCELLATION_POLICIES,
  AIRBNB_CANCELLATION_POLICY_LABELS,
  isValidIanaTimezone,
  type AirbnbCancellationPolicy,
} from "@/lib/airbnb-cancellation-foundation"

const BLACKBIRD_ACCOUNT = "__blackbird__"
const UNSET_POLICY = "__unset_policy__"

type ListingRecord = {
  id?: string
  client_id: string | null
  name: string
  status?: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
  initial_setup_date?: string | null
  adjustment_confirmed_date?: string | null
  deactivated_date?: string | null
  default_cancellation_policy?: AirbnbCancellationPolicy | null
  timezone?: string | null
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
  const [clientId, setClientId] = useState<string | null>(
    listing ? listing.client_id : ""
  )
  const [status, setStatus] = useState(listing?.status ?? "active")
  const [initialSetupDate, setInitialSetupDate] = useState(
    listing?.initial_setup_date ?? ""
  )
  const [adjustmentConfirmedDate, setAdjustmentConfirmedDate] = useState(
    listing?.adjustment_confirmed_date ?? ""
  )
  const [deactivatedDate, setDeactivatedDate] = useState(
    listing?.deactivated_date ?? ""
  )
  const [defaultCancellationPolicy, setDefaultCancellationPolicy] =
    useState<AirbnbCancellationPolicy | null>(
      listing?.default_cancellation_policy ?? null
    )
  const [timezone, setTimezone] = useState(listing?.timezone ?? "")
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
    if (clientId === "") {
      toast.error("Choose a RevFactor client or the Blackbird account")
      return
    }
    const normalizedTimezone = timezone.trim()
    if (normalizedTimezone && !isValidIanaTimezone(normalizedTimezone)) {
      toast.error("Use a valid IANA timezone, such as America/New_York")
      return
    }

    setSaving(true)
    // This dialog is also reused by the general /listings route. Until that
    // route intentionally selects these fields, omit them there so an edit to
    // an unrelated field cannot clear an inventoried policy/timezone.
    const includeAirbnbFoundationFields =
      !listing ||
      "default_cancellation_policy" in listing ||
      "timezone" in listing
    const input = {
      client_id: clientId,
      status: status || "active",
      ...buildListingFields(values),
      initial_setup_date: initialSetupDate || null,
      adjustment_confirmed_date: adjustmentConfirmedDate || null,
      deactivated_date: deactivatedDate || null,
      ...(includeAirbnbFoundationFields
        ? {
            default_cancellation_policy: defaultCancellationPolicy,
            timezone: normalizedTimezone || null,
          }
        : {}),
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="listing-client">
                Account / client *
              </FieldLabel>
              <Select
                value={clientId ?? BLACKBIRD_ACCOUNT}
                onValueChange={(value) =>
                  setClientId(value === BLACKBIRD_ACCOUNT ? null : value)
                }
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
                  <SelectGroup>
                    <SelectItem value={BLACKBIRD_ACCOUNT}>
                      Blackbird — no RevFactor client
                    </SelectItem>
                    {(clients ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="listing-default-cancellation-policy">
                Default cancellation policy
              </FieldLabel>
              <Select
                value={defaultCancellationPolicy ?? UNSET_POLICY}
                onValueChange={(value) =>
                  setDefaultCancellationPolicy(
                    value === UNSET_POLICY
                      ? null
                      : (value as AirbnbCancellationPolicy)
                  )
                }
              >
                <SelectTrigger
                  id="listing-default-cancellation-policy"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={UNSET_POLICY}>
                      Not inventoried — blocked
                    </SelectItem>
                    {AIRBNB_CANCELLATION_POLICIES.map((policy) => (
                      <SelectItem key={policy} value={policy}>
                        {AIRBNB_CANCELLATION_POLICY_LABELS[policy]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="listing-timezone">
                Property timezone
              </FieldLabel>
              <Input
                id="listing-timezone"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="America/New_York"
                autoComplete="off"
              />
              <FieldDescription>
                Exact IANA identifier. Missing values remain blocked.
              </FieldDescription>
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="listing-status">Status</FieldLabel>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="listing-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="active">
                      Active — visible in Clients & Listings
                    </SelectItem>
                    <SelectItem value="inactive">
                      Inactive — hidden, only shown here
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <div className="space-y-2">
              <Label htmlFor="listing-initial-setup">Initial setup</Label>
              <Input
                id="listing-initial-setup"
                type="date"
                value={initialSetupDate}
                onChange={(e) => setInitialSetupDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="listing-adjustment-confirmed">
                Adjustment confirmed
              </Label>
              <Input
                id="listing-adjustment-confirmed"
                type="date"
                value={adjustmentConfirmedDate}
                onChange={(e) => setAdjustmentConfirmedDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="listing-deactivated">Deactivated</Label>
              <Input
                id="listing-deactivated"
                type="date"
                value={deactivatedDate}
                onChange={(e) => setDeactivatedDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Auto-set when the listing goes inactive; cleared on
                reactivation.
              </p>
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
              {saving
                ? "Saving..."
                : isEdit
                  ? "Save Changes"
                  : "Create Listing"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
