// Shared constants and pure helpers for the Adjustments module — safe for client & server

import type {
  Adjustment,
  AdjustmentOrigin,
  AdjustmentSignalKey,
  AdjustmentSignals,
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
  { value: "recommendation", label: "Recommendation" },
  { value: "visibility", label: "Visibility / Ranking" },
  { value: "blocked_dates", label: "Blocked Dates" },
  { value: "pricing_flexibility", label: "Pricing Flexibility" },
  { value: "other", label: "Other" },
]

// Internal-ops types HostPricing users don't file (onboarding lives with the
// internal team). UI-level filter only — the server accepts any valid type.
export const INTERNAL_ONLY_TYPES: AdjustmentType[] = ["setup"]

// `currentType` keeps the edit-mode Select from rendering blank if an
// internal-only type ends up on a hostpricing-editable ticket
export function adjustmentTypeOptions(
  isHostpricing: boolean,
  currentType?: string
): { value: AdjustmentType; label: string }[] {
  if (!isHostpricing) return ADJUSTMENT_TYPES
  return ADJUSTMENT_TYPES.filter(
    (t) => !INTERNAL_ONLY_TYPES.includes(t.value) || t.value === currentType
  )
}

export const ADJUSTMENT_ORIGINS: { value: AdjustmentOrigin; label: string }[] = [
  { value: "internal", label: "Internal" },
  { value: "client", label: "Client" },
  { value: "hostpricing", label: "HostPricing" },
]

export const ADJUSTMENT_STATUSES: { value: AdjustmentStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "needs_info", label: "Needs Info" },
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

// A HostPricing-filed ticket sitting in `open` is a proposal awaiting our
// approval — assigned to the internal team by definition. Derived from origin
// + status, never stored (see decisions.md 2026-07-16 "computed, not stored").
export function isPendingApproval(
  adjustment: Pick<Adjustment, "status" | "origin">
): boolean {
  return adjustment.origin === "hostpricing" && adjustment.status === "open"
}

// HostPricing proposals sit in `open` until an internal user approves or denies them
export function adjustmentStatusLabelFor(
  adjustment: Pick<Adjustment, "status" | "origin">
): string {
  if (isPendingApproval(adjustment)) return "Pending approval"
  return adjustmentStatusLabel(adjustment.status)
}

// Escalation: a client-origin request at high urgency (surfaced in the queue)
export function isEscalated(
  adjustment: Pick<Adjustment, "urgency" | "origin">
): boolean {
  return adjustment.urgency === "high" && adjustment.origin === "client"
}

// Badge classes shared by every adjustments surface (list, detail, public card)
export const URGENCY_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
}

// Only non-internal origins get a badge — internal is the default and would be noise
export const ORIGIN_BADGE: Record<string, string> = {
  client: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  hostpricing: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
}

export const STATUS_BADGE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  in_progress: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  needs_info: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  controlled: "bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  issue: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  rejected: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
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
  // Report signals + suggested pricing actions (HostPricing review context)
  showsSignals: boolean
  showsSuggestions: boolean
  targetPlaceholder: string
}

export const ADJUSTMENT_TYPE_CONFIG: Record<AdjustmentType, AdjustmentTypeConfig> = {
  setup: {
    showsTarget: false,
    requiresTarget: false,
    showsDates: false,
    requiresDateFrom: false,
    showsBookingWindow: false,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "",
  },
  min_stay: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "→ 3 nights",
  },
  price: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "→ $189",
  },
  min_price: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "→ $135",
  },
  max_price: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "→ $400",
  },
  target_payout: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "→ $5000/month net",
  },
  checkin_checkout: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "no check-in Sat",
  },
  discount: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "→ 15% off",
  },
  markup_fees: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: false,
    showsBookingWindow: true,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "→ 12% markup",
  },
  availability: {
    showsTarget: true,
    requiresTarget: true,
    showsDates: true,
    requiresDateFrom: true,
    showsBookingWindow: true,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "block Dec 24–26",
  },
  review: {
    showsTarget: true,
    requiresTarget: false,
    showsDates: true,
    requiresDateFrom: false,
    showsBookingWindow: true,
    // The existing underperformance ticket — benefits from the same report
    // context as the HostPricing review types
    showsSignals: true,
    showsSuggestions: true,
    targetPlaceholder: "expected outcome (optional)",
  },
  // Strategic pricing suggestion (e.g. composite listing setup, splitting a
  // large listing) — discussed internally before execution, so nothing is required
  recommendation: {
    showsTarget: true,
    requiresTarget: false,
    showsDates: true,
    requiresDateFrom: false,
    showsBookingWindow: false,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "suggested change (optional)",
  },
  // HostPricing review types: filed from their consolidated report when a
  // listing underperforms — signals carry the report context
  visibility: {
    showsTarget: true,
    requiresTarget: false,
    showsDates: true,
    requiresDateFrom: false,
    showsBookingWindow: false,
    showsSignals: true,
    showsSuggestions: true,
    targetPlaceholder: "e.g. impressions down 40% vs market",
  },
  blocked_dates: {
    showsTarget: true,
    requiresTarget: false,
    showsDates: true,
    // The blocked range IS the ticket — reuses date_from/date_to
    requiresDateFrom: true,
    showsBookingWindow: false,
    showsSignals: true,
    showsSuggestions: false,
    targetPlaceholder: "what's blocked / why it matters",
  },
  pricing_flexibility: {
    showsTarget: true,
    requiresTarget: false,
    showsDates: true,
    requiresDateFrom: false,
    showsBookingWindow: true,
    showsSignals: true,
    showsSuggestions: true,
    targetPlaceholder: "e.g. allow deeper last-minute discounting",
  },
  other: {
    showsTarget: true,
    requiresTarget: false,
    showsDates: true,
    requiresDateFrom: false,
    showsBookingWindow: true,
    showsSignals: false,
    showsSuggestions: false,
    targetPlaceholder: "optional",
  },
}

// Report metrics HostPricing can attach to a review ticket — free-form
// strings copied from their consolidated report (Airbnb, Rankbreeze, market)
export const ADJUSTMENT_SIGNAL_FIELDS: {
  key: AdjustmentSignalKey
  label: string
  placeholder: string
}[] = [
  { key: "airbnb_impressions", label: "Airbnb impressions", placeholder: "e.g. 1,240 (30d)" },
  {
    key: "rankbreeze_avg_impressions_3m",
    label: "Rankbreeze avg impressions (3 mo)",
    placeholder: "e.g. 980",
  },
  { key: "visibility_index", label: "Visibility index", placeholder: "e.g. 42 / low" },
  { key: "conversion", label: "Conversion", placeholder: "e.g. 0.8%" },
  { key: "pace", label: "Pace", placeholder: "e.g. behind 15% vs LY" },
  { key: "occupancy", label: "Occupancy", placeholder: "e.g. 55% next 30d" },
  { key: "market_occupancy", label: "Market occupancy", placeholder: "e.g. 71% next 30d" },
]

const SIGNAL_KEYS = new Set<string>(ADJUSTMENT_SIGNAL_FIELDS.map((f) => f.key))
const SIGNAL_VALUE_MAX_LENGTH = 120

// Known pricing suggestions from HostPricing's review tab; free-text entries
// are stored verbatim alongside these slugs
export const ADJUSTMENT_SUGGESTED_ACTIONS = [
  { value: "top15_discount", label: "Top 15% discount" },
  { value: "mobile_discount", label: "Mobile discount (2–3%)" },
  { value: "flexible_cancellation", label: "Flexible cancellation" },
] as const

export function suggestedActionLabel(value: string): string {
  return (
    ADJUSTMENT_SUGGESTED_ACTIONS.find((a) => a.value === value)?.label ?? value
  )
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
  signals: Record<string, string>
  suggestedActions: string[]
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
  signals: AdjustmentSignals
  suggested_actions: string[]
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

  // Signals/suggestions are always optional; unknown keys and empties dropped
  const signals: AdjustmentSignals = {}
  if (config.showsSignals) {
    for (const [key, raw] of Object.entries(input.signals ?? {})) {
      const value = typeof raw === "string" ? raw.trim() : ""
      if (!value || !SIGNAL_KEYS.has(key)) continue
      signals[key as AdjustmentSignalKey] = value.slice(0, SIGNAL_VALUE_MAX_LENGTH)
    }
  }
  const suggested_actions = config.showsSuggestions
    ? [
        ...new Set(
          (input.suggestedActions ?? [])
            .map((a) => (typeof a === "string" ? a.trim() : ""))
            .filter(Boolean)
        ),
      ]
    : []

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
      signals,
      suggested_actions,
    },
  }
}

// Statuses that require a note explaining the transition
export const NOTE_REQUIRED_STATUSES: AdjustmentStatus[] = [
  "issue",
  "rejected",
  "needs_info",
]

// Open (not yet closed) statuses — gates editability; the Triage queue
// additionally excludes needs_info so those rows live in "Waiting on us"
export const OPEN_STATUSES: AdjustmentStatus[] = [
  "open",
  "in_progress",
  "issue",
  "needs_info",
]

// Needs an internal reply: the conversation's last word came from outside.
// Derived from the adjustment_comment_stats view — never stored.
export function hasUnansweredExternalComment(
  stats?: { last_comment_origin: string } | null
): boolean {
  return !!stats && stats.last_comment_origin !== "internal"
}

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

// Mid-ticket response pasted back to the HostPricing group: an internal note
// with enough ticket context to stand alone in the chat
export function buildWhatsappCommentUpdate(
  adjustment: AdjustmentSummaryFields,
  commentContent: string
): string {
  return `💬 ${adjustmentSummary(adjustment)}\n${commentContent}`
}
