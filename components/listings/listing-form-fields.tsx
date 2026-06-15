"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { US_STATES } from "@/lib/us-states"

export const AIRBNB_BASE = "https://www.airbnb.com/rooms/"
export const PRICELABS_BASE = "https://app.pricelabs.co/pricing?listings="

export type ListingFormValues = {
  name: string
  city: string
  state: string
  airbnbId: string
  pricelabsId: string
}

export const EMPTY_LISTING_VALUES: ListingFormValues = {
  name: "",
  city: "",
  state: "",
  airbnbId: "",
  pricelabsId: "",
}

export function extractAirbnbId(value: string): string {
  if (value.includes("airbnb.com/rooms/")) {
    const match = value.match(/airbnb\.com\/rooms\/(\d+)/)
    return match?.[1] ?? value
  }
  return value
}

export function extractPricelabsId(value: string): string {
  if (value.includes("pricelabs.co")) {
    const match = value.match(/listings=([^&\s]+)/)
    return match?.[1] ?? value
  }
  return value
}

// Build the DB-shaped fields (snake_case) from form values, including the
// derived Airbnb / PriceLabs links and the listing_id.
export function buildListingFields(values: ListingFormValues): {
  name: string
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
  city: string | null
  state: string | null
} {
  const plId = extractPricelabsId(values.pricelabsId.trim())
  const airbnbId = extractAirbnbId(values.airbnbId.trim())
  return {
    name: values.name.trim(),
    listing_id: plId || null,
    pricelabs_link: plId ? `${PRICELABS_BASE}${plId}` : null,
    airbnb_link: airbnbId ? `${AIRBNB_BASE}${airbnbId}` : null,
    city: values.city.trim() || null,
    state: values.state.trim() || null,
  }
}

// Prefill form values from an existing listing record (edit flows).
export function listingValuesFromRecord(record?: {
  name?: string | null
  city?: string | null
  state?: string | null
  airbnb_link?: string | null
  listing_id?: string | null
  pricelabs_link?: string | null
}): ListingFormValues {
  if (!record) return { ...EMPTY_LISTING_VALUES }
  return {
    name: record.name ?? "",
    city: record.city ?? "",
    state: record.state ?? "",
    airbnbId: record.airbnb_link ? extractAirbnbId(record.airbnb_link) : "",
    pricelabsId:
      record.listing_id ??
      (record.pricelabs_link ? extractPricelabsId(record.pricelabs_link) : ""),
  }
}

// Shared listing fields: Name, City, State (code selector), Airbnb ID, and the
// unified PriceLabs / Listing ID. Reused wherever a listing is created/edited.
export function ListingFormFields({
  values,
  onChange,
  idPrefix = "listing",
}: {
  values: ListingFormValues
  onChange: (values: ListingFormValues) => void
  idPrefix?: string
}) {
  const set = (patch: Partial<ListingFormValues>) =>
    onChange({ ...values, ...patch })

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Name *</Label>
        <Input
          id={`${idPrefix}-name`}
          value={values.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Listing name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-city`}>City</Label>
        <Input
          id={`${idPrefix}-city`}
          value={values.city}
          onChange={(e) => set({ city: e.target.value })}
          placeholder="Austin"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-state`}>State</Label>
        <Select
          value={values.state}
          onValueChange={(value) => set({ state: value })}
        >
          <SelectTrigger id={`${idPrefix}-state`} className="w-full">
            <SelectValue placeholder="State" />
          </SelectTrigger>
          <SelectContent>
            {US_STATES.map((s) => (
              <SelectItem key={s.code} value={s.code}>
                {s.code} — {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-airbnb`}>Airbnb ID</Label>
        <Input
          id={`${idPrefix}-airbnb`}
          value={values.airbnbId}
          onChange={(e) => set({ airbnbId: extractAirbnbId(e.target.value) })}
          placeholder="12345678"
        />
        {values.airbnbId.trim() && (
          <p className="text-muted-foreground truncate text-xs">
            {AIRBNB_BASE}
            {values.airbnbId.trim()}
          </p>
        )}
      </div>

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-pricelabs`}>PriceLabs / Listing ID</Label>
        <Input
          id={`${idPrefix}-pricelabs`}
          value={values.pricelabsId}
          onChange={(e) =>
            set({ pricelabsId: extractPricelabsId(e.target.value) })
          }
          placeholder="456319"
        />
        {values.pricelabsId.trim() && (
          <p className="text-muted-foreground truncate text-xs">
            {PRICELABS_BASE}
            {extractPricelabsId(values.pricelabsId.trim())}
          </p>
        )}
      </div>
    </div>
  )
}
