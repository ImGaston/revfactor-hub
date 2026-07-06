// Shared constants and pure helpers for the Adjustments module — safe for client & server

import type {
  Adjustment,
  AdjustmentOrigin,
  AdjustmentStatus,
  AdjustmentType,
  AdjustmentUrgency,
} from "@/lib/types"

export const ADJUSTMENT_TYPES: { value: AdjustmentType; label: string }[] = [
  { value: "setup", label: "Initial Setup" },
  { value: "min_stay", label: "Stay Rules (min/max)" },
  { value: "price", label: "Price" },
  { value: "min_price", label: "Min Price" },
  { value: "max_price", label: "Max Price" },
  { value: "target_payout", label: "Target Payout" },
  { value: "checkin_checkout", label: "Check-in/out Restriction" },
  { value: "discount", label: "Discount / Promotion" },
  { value: "markup_fees", label: "Markup / Fees" },
  { value: "availability", label: "Availability" },
  { value: "review", label: "Review / Underperformance" },
  { value: "other", label: "Other" },
]

export const ADJUSTMENT_ORIGINS: { value: AdjustmentOrigin; label: string }[] = [
  { value: "internal", label: "Internal" },
  { value: "client", label: "Client" },
  { value: "hostpricing", label: "HostPricing" },
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

export function adjustmentTypeLabel(type: string): string {
  return ADJUSTMENT_TYPES.find((t) => t.value === type)?.label ?? type
}

export function adjustmentOriginLabel(origin: string): string {
  return ADJUSTMENT_ORIGINS.find((o) => o.value === origin)?.label ?? origin
}

export function adjustmentStatusLabel(status: string): string {
  return ADJUSTMENT_STATUSES.find((s) => s.value === status)?.label ?? status
}

// HostPricing proposals sit in `open` until an internal user approves or denies them
export function adjustmentStatusLabelFor(
  adjustment: Pick<Adjustment, "status" | "origin">
): string {
  if (adjustment.origin === "hostpricing" && adjustment.status === "open")
    return "Pending approval"
  return adjustmentStatusLabel(adjustment.status)
}

// Escalation: a client-origin request at high urgency (surfaced in the queue)
export function isEscalated(
  adjustment: Pick<Adjustment, "urgency" | "origin">
): boolean {
  return adjustment.urgency === "high" && adjustment.origin === "client"
}

// Static reviewer hint for the setup resolved -> controlled step (not persisted)
export const SETUP_CONTROL_CHECKLIST = [
  "Markup verified",
  "Min / base price verified",
  "LOS rules verified",
  "Promotions applied",
  "Sync state OK",
  "Access complete",
] as const

// Per-type field behavior — single source of truth for the form UI and server validation
export type AdjustmentTypeConfig = {
  showsTarget: boolean
  requiresTarget: boolean
  showsDates: boolean
  requiresDateFrom: boolean
  showsBookingWindow: boolean
  targetPlaceholder: string
}

export const ADJUSTMENT_TYPE_CONFIG: Record<AdjustmentType, AdjustmentTypeConfig> = {
  setup: {
    showsTarget: false,
    requiresTarget: false,
    showsDates: false,
    requiresDateFrom: false,
    showsBookingWindow: false,
    targetPlaceholder: "",
  },
  min_stay: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    targetPlaceholder: "→ 3 nights",
  },
  price: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    targetPlaceholder: "→ $189",
  },
  min_price: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    targetPlaceholder: "→ $135",
  },
  max_price: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    targetPlaceholder: "→ $400",
  },
  target_payout: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    targetPlaceholder: "→ $5000/month net",
  },
  checkin_checkout: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    targetPlaceholder: "no check-in Sat",
  },
  discount: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    targetPlaceholder: "→ 15% off",
  },
  markup_fees: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: false,
    showsBookingWindow: true,
    targetPlaceholder: "→ 12% markup",
  },
  availability: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    targetPlaceholder: "block Dec 24–26",
  },
  review: {
    showsTarget: true,
    requiresTarget: false,
    showsDates: true,
    requiresDateFrom: false,
    showsBookingWindow: true,
    targetPlaceholder: "expected outcome (optional)",
  },
  other: {
    showsTarget: true,
    requiresTarget: false,
    showsDates: true,
    requiresDateFrom: false,
    showsBookingWindow: true,
    targetPlaceholder: "optional",
  },
}

export type AdjustmentFieldInput = {
  scope: string
  clientId: string
  listingId: string | null
  type: string
  targetValue: string | null
  dateFrom: string | null
  dateTo: string | null
  bookingWindow: string | null
  origin: string
}

export type NormalizedAdjustmentInput = {
  scope: "portfolio" | "single_listing"
  client_id: string
  listing_id: string | null
  type: AdjustmentType
  target_value: string | null
  date_from: string | null
  date_to: string | null
  booking_window: string | null
  origin: AdjustmentOrigin
}

// Shared by the dialog's canSave and the server actions so validation can't drift.
// Nulls out fields the type doesn't show — the server result is authoritative.
export function validateAdjustmentInput(
  input: AdjustmentFieldInput
): { error: string } | { value: NormalizedAdjustmentInput } {
  const type = ADJUSTMENT_TYPES.find((t) => t.value === input.type)?.value
  if (!type) return { error: "Type is required" }
  const origin = ADJUSTMENT_ORIGINS.find((o) => o.value === input.origin)?.value
  if (!origin) return { error: "Origin is not valid" }
  if (!input.clientId) return { error: "Client is required" }

  const config = ADJUSTMENT_TYPE_CONFIG[type]
  // Initial setup is always per listing — data hygiene: client + listing must exist in the Hub
  const scope = type === "setup" ? "single_listing" : input.scope
  if (scope !== "portfolio" && scope !== "single_listing")
    return { error: "Scope is not valid" }
  if (scope === "single_listing" && !input.listingId)
    return {
      error:
        type === "setup"
          ? "Initial setup requires the listing to exist in the Hub"
          : "Listing is required for single-listing adjustments",
    }

  const targetValue = input.targetValue?.trim() || null
  if (config.requiresTarget && !targetValue)
    return { error: "Target value is required for this type" }
  if (config.requiresDateFrom && !input.dateFrom)
    return { error: "A start date is required for this type" }

  return {
    value: {
      scope,
      client_id: input.clientId,
      listing_id: scope === "single_listing" ? input.listingId : null,
      type,
      target_value: config.showsTarget ? targetValue : null,
      date_from: config.showsDates ? input.dateFrom || null : null,
      date_to: config.showsDates ? input.dateTo || null : null,
      booking_window: config.showsBookingWindow ? input.bookingWindow || null : null,
      origin,
    },
  }
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

export function airbnbRoomUrl(listing: ListingLinkFields): string | null {
  if (listing.airbnb_link) return listing.airbnb_link
  if (listing.listing_id && /^\d+$/.test(listing.listing_id))
    return `https://www.airbnb.com/rooms/${listing.listing_id}`
  return null
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
  "scope" | "type" | "target_value" | "date_from" | "date_to"
> & {
  clients?: { name: string } | null
  listings?: { name: string } | null
}

export function adjustmentSummary(adjustment: AdjustmentSummaryFields): string {
  const parts = [adjustmentTypeLabel(adjustment.type)]
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
