// Pure logic for saved /reservations views: what a view's stored `params`
// JSONB may contain, how to sanitize untrusted input into it, how it maps to
// the page's searchParams, and how to tell whether a view matches the current
// filters. No I/O — the server action and the client both import this so the
// two ends of the contract cannot drift.

import {
  isDateRangePresetKey,
  type DateRangePresetKey,
} from "@/lib/date-range-presets"
import {
  parseBookingWindowDays,
  parseUuidList,
  RESERVATION_SORT_FIELDS,
  type ReservationDateField,
  type ReservationSortField,
} from "@/lib/reservations"

export type ReservationViewParams = {
  client?: string // comma-separated client UUIDs (sorted)
  xclient?: "1" // exclude `client` instead of filtering to it
  listing?: string // comma-separated hub listing UUIDs (sorted)
  xlisting?: "1" // exclude `listing` instead of filtering to it
  bwmin?: string // booking window lower bound, days
  bwmax?: string // booking window upper bound, days
  df?: ReservationDateField // only stored when "booked" (checkin is the default)
  range?: DateRangePresetKey // relative range; wins over from/to
  from?: string // YYYY-MM-DD
  to?: string // YYYY-MM-DD
  q?: string
  sort?: ReservationSortField // only stored when not the default booked_at desc
  dir?: "asc" | "desc"
}

export type ReservationView = {
  id: string
  name: string
  params: ReservationViewParams
  created_by: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const VIEW_NAME_MAX = 60
const SEARCH_MAX = 200

// Validates untrusted input (client payloads, stored JSONB) into clean view
// params. Drops unknown keys, invalid values, and redundant defaults; a
// relative range wins over absolute dates. Returns null when the input is
// not an object at all.
export function sanitizeViewParams(input: unknown): ReservationViewParams | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null
  }
  const raw = input as Record<string, unknown>
  const str = (key: string): string | undefined =>
    typeof raw[key] === "string" ? (raw[key] as string) : undefined

  const params: ReservationViewParams = {}
  const clients = parseUuidList(str("client"))
  if (clients.length > 0) {
    params.client = clients.join(",")
    if (str("xclient") === "1") params.xclient = "1"
  }
  const listings = parseUuidList(str("listing"))
  if (listings.length > 0) {
    params.listing = listings.join(",")
    if (str("xlisting") === "1") params.xlisting = "1"
  }
  const bwmin = parseBookingWindowDays(str("bwmin"))
  if (bwmin != null) params.bwmin = String(bwmin)
  const bwmax = parseBookingWindowDays(str("bwmax"))
  if (bwmax != null) params.bwmax = String(bwmax)
  if (str("df") === "booked") params.df = "booked"

  const range = str("range")
  if (range && isDateRangePresetKey(range)) {
    params.range = range
  } else {
    const from = str("from")
    if (from && DATE_RE.test(from)) params.from = from
    const to = str("to")
    if (to && DATE_RE.test(to)) params.to = to
  }

  const q = str("q")?.trim()
  if (q) params.q = q.slice(0, SEARCH_MAX)

  const sort = str("sort")
  const dir = str("dir") === "asc" ? "asc" : "desc"
  if (
    RESERVATION_SORT_FIELDS.includes(sort as ReservationSortField) &&
    !(sort === "booked_at" && dir === "desc")
  ) {
    params.sort = sort as ReservationSortField
    params.dir = dir
  }

  return params
}

export function viewParamsAreEmpty(params: ReservationViewParams): boolean {
  return Object.keys(params).length === 0
}

// Ordered serialization — doubles as the canonical form for equality.
export function viewSearchString(params: ReservationViewParams): string {
  const sp = new URLSearchParams()
  for (const key of [
    "client",
    "xclient",
    "listing",
    "xlisting",
    "bwmin",
    "bwmax",
    "df",
    "range",
    "from",
    "to",
    "q",
    "sort",
    "dir",
  ] as const) {
    const value = params[key]
    if (value) sp.set(key, value)
  }
  return sp.toString()
}

// The current page state, expressed in the same shape a view stores — so
// saving and matching go through sanitizeViewParams like everything else.
export function currentViewParams(filters: {
  clientIds?: string[]
  clientExclude?: boolean
  listingIds?: string[]
  listingExclude?: boolean
  bwMin?: number
  bwMax?: number
  dateField: ReservationDateField
  range?: string
  from?: string
  to?: string
  q?: string
  sort: ReservationSortField
  dir: "asc" | "desc"
}): ReservationViewParams {
  return (
    sanitizeViewParams({
      client: filters.clientIds?.join(","),
      xclient: filters.clientExclude ? "1" : undefined,
      listing: filters.listingIds?.join(","),
      xlisting: filters.listingExclude ? "1" : undefined,
      bwmin: filters.bwMin != null ? String(filters.bwMin) : undefined,
      bwmax: filters.bwMax != null ? String(filters.bwMax) : undefined,
      df: filters.dateField,
      range: filters.range,
      from: filters.from,
      to: filters.to,
      q: filters.q,
      sort: filters.sort,
      dir: filters.dir,
    }) ?? {}
  )
}

export function viewMatchesParams(
  view: ReservationView,
  current: ReservationViewParams
): boolean {
  const stored = sanitizeViewParams(view.params)
  if (!stored) return false
  return viewSearchString(stored) === viewSearchString(current)
}
