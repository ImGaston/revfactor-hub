// Shared constants and pure helpers for the Adjustments module — safe for client & server

import type {
  Adjustment,
  AdjustmentStatus,
  AdjustmentTag,
  AdjustmentUrgency,
} from "@/lib/types"

export const ADJUSTMENT_TAGS: { value: AdjustmentTag; label: string }[] = [
  { value: "min_stay", label: "Min Stay" },
  { value: "price", label: "Price" },
  { value: "min_price", label: "Min Price" },
  { value: "max_price", label: "Max Price" },
  { value: "discount", label: "Discount" },
  { value: "availability", label: "Availability" },
  { value: "other", label: "Other" },
]

export const ADJUSTMENT_STATUSES: { value: AdjustmentStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "controlled", label: "Done" },
  { value: "issue", label: "Issue" },
  { value: "rejected", label: "Rejected" },
]

export const ADJUSTMENT_URGENCIES: { value: AdjustmentUrgency; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]

export const BOOKING_WINDOWS = [
  { value: "last_minute", label: "Last minute" },
  { value: "far_out", label: "Far out" },
] as const

export function adjustmentTagLabel(tag: string): string {
  return ADJUSTMENT_TAGS.find((t) => t.value === tag)?.label ?? tag
}

export function adjustmentStatusLabel(status: string): string {
  return ADJUSTMENT_STATUSES.find((s) => s.value === status)?.label ?? status
}

// Statuses that require a note explaining the transition
export const NOTE_REQUIRED_STATUSES: AdjustmentStatus[] = ["issue", "rejected"]

// Open (not yet closed) statuses for the triage queue
export const OPEN_STATUSES: AdjustmentStatus[] = ["open", "in_progress", "issue"]

// An open high-urgency adjustment older than this gets flagged in the queue
export const STALE_HIGH_URGENCY_DAYS = 2

type ListingLinkFields = {
  listing_id: string | null
  pricelabs_link: string | null
  airbnb_link: string | null
}

export function pricelabsUrl(listing: ListingLinkFields): string | null {
  if (listing.pricelabs_link) return listing.pricelabs_link
  if (listing.listing_id)
    return `https://app.pricelabs.co/pricing?listings=${listing.listing_id}`
  return null
}

export function airbnbMulticalendarUrl(listing: ListingLinkFields): string | null {
  // The unified PriceLabs / Listing ID field holds the numeric Airbnb ID
  if (listing.listing_id && /^\d+$/.test(listing.listing_id))
    return `https://www.airbnb.com/multicalendar/${listing.listing_id}`
  const match = listing.airbnb_link?.match(/\/rooms\/(\d+)/)
  return match ? `https://www.airbnb.com/multicalendar/${match[1]}` : null
}

export function adjustmentShareUrl(publicToken: string): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://hub.revfactor.io"
  return `${base}/a/${publicToken}`
}

function formatDateRange(dateFrom: string | null, dateTo: string | null): string | null {
  if (!dateFrom && !dateTo) return null
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
  if (dateFrom && dateTo && dateFrom !== dateTo) return `${fmt(dateFrom)} – ${fmt(dateTo)}`
  return fmt((dateFrom ?? dateTo)!)
}

// Minimal shape shared by the full Adjustment type and the public-shell select
export type AdjustmentSummaryFields = Pick<
  Adjustment,
  "scope" | "tag" | "target_value" | "date_from" | "date_to"
> & {
  clients?: { name: string } | null
  listings?: { name: string } | null
}

export function adjustmentSummary(adjustment: AdjustmentSummaryFields): string {
  const parts = [adjustmentTagLabel(adjustment.tag)]
  if (adjustment.target_value) parts.push(adjustment.target_value)
  const where =
    adjustment.scope === "portfolio"
      ? `${adjustment.clients?.name ?? "portfolio"} (portfolio)`
      : adjustment.listings?.name
  if (where) parts.push(where)
  const range = formatDateRange(adjustment.date_from, adjustment.date_to)
  if (range) parts.push(range)
  return parts.join(" · ")
}

// Closing-the-loop message pasted back into the WhatsApp group
export function buildWhatsappUpdate(adjustment: AdjustmentSummaryFields): string {
  return `✅ Done: ${adjustmentSummary(adjustment)}`
}
