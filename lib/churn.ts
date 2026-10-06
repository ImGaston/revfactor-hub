// Shared reporting and validation contract; safe for server and browser imports.
import { z } from "zod"
import { CLIENT_CHURN_REASONS } from "@/lib/clients"

export const STRIPE_ITEM_STATUSES = ["pending", "adjusted", "n/a"] as const
export type StripeItemStatus = (typeof STRIPE_ITEM_STATUSES)[number]
export const listingExitSchema = z.object({
  listingId: z.uuid(),
  reason: z.enum(CLIENT_CHURN_REASONS.map((reason) => reason.value)),
  note: z.string().trim().max(4000),
  handledBy: z.string().trim().max(120),
  stripeItemStatus: z.enum(STRIPE_ITEM_STATUSES),
})
export type ListingExitInput = z.infer<typeof listingExitSchema>

export type ChurnClient = {
  id: string
  name: string
  markets: string[]
  onboarding_date: string | null
  ending_date: string | null
  ending_reason_tags: string[]
  ending_note: string | null
  billing_amount?: number | null
}
export type ListingExit = {
  id: string
  name: string
  client_id: string
  client_name: string
  markets: string[]
  deactivated_date: string | null
  exit_reason: string | null
  exit_note: string | null
  exit_handled_by: string | null
  stripe_item_status: StripeItemStatus
}
export type LeavingClient = {
  id: string
  name: string
  markets: string[]
  cancellations: {
    subscription_id: string
    scheduled_end: string | null
    synced_at: string
  }[]
}
export type ChurnFilters = {
  reason: string
  market: string
  from: string
  to: string
}
export const EMPTY_CHURN_FILTERS: ChurnFilters = {
  reason: "all",
  market: "all",
  from: "",
  to: "",
}

export function marketLabel(city: string | null, state: string | null): string {
  return (
    [city?.trim(), state?.trim()].filter(Boolean).join(", ") || "Unknown market"
  )
}
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  )
}
export function reportDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}
export function tenureMonths(
  client: Pick<ChurnClient, "onboarding_date" | "ending_date">
): number | null {
  const start = client.onboarding_date
  const end = client.ending_date
  // Missing end dates are unknown tenure, never tenure through today.
  if (!start || !end || !validDate(start) || !validDate(end) || end < start)
    return null
  return (
    (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    Number(end.slice(5, 7)) -
    Number(start.slice(5, 7))
  )
}
export function formatChurnDate(value: string | null): string {
  if (!value || !validDate(value)) return "—"
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}
export function matchesChurnFilters(
  markets: string[],
  date: string | null,
  reasons: string[],
  filters: ChurnFilters
): boolean {
  if (filters.market !== "all" && !markets.includes(filters.market))
    return false
  if (filters.reason === "untagged" && reasons.length) return false
  if (
    filters.reason !== "all" &&
    filters.reason !== "untagged" &&
    !reasons.includes(filters.reason)
  )
    return false
  if ((filters.from || filters.to) && (!date || !validDate(date))) return false
  if (filters.from && date! < filters.from) return false
  if (filters.to && date! > filters.to) return false
  return true
}
export function filterChurnClients(rows: ChurnClient[], filters: ChurnFilters) {
  return rows.filter((row) =>
    matchesChurnFilters(
      row.markets,
      row.ending_date,
      row.ending_reason_tags,
      filters
    )
  )
}
export function filterListingExits(rows: ListingExit[], filters: ChurnFilters) {
  return rows.filter((row) =>
    matchesChurnFilters(
      row.markets,
      row.deactivated_date,
      row.exit_reason ? [row.exit_reason] : [],
      filters
    )
  )
}
export function filterLeavingClients(
  rows: LeavingClient[],
  filters: ChurnFilters
) {
  // Reasons are recorded only after offboarding. Reason filter doesn't apply here.
  return rows.flatMap((row) => {
    const cancellations = row.cancellations.filter((item) =>
      matchesChurnFilters(row.markets, item.scheduled_end, [], {
        ...filters,
        reason: "all",
      })
    )
    return cancellations.length ? [{ ...row, cancellations }] : []
  })
}
function topReasons(rows: string[][]) {
  const counts = new Map<string, number>()
  for (const reasons of rows)
    for (const reason of new Set(reasons))
      counts.set(reason, (counts.get(reason) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }))
}
export function summarizeChurn(
  clients: ChurnClient[],
  exits: ListingExit[],
  asOf: string
) {
  const anchor = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`)
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 11 + index, 1)
    )
      .toISOString()
      .slice(0, 7)
    return {
      month,
      clients: clients.filter(
        (row) => row.ending_date?.startsWith(month) && row.ending_date <= asOf
      ).length,
      listings: exits.filter(
        (row) =>
          row.deactivated_date?.startsWith(month) &&
          row.deactivated_date <= asOf
      ).length,
    }
  })
  const first = `${months[0].month}-01`
  const periodClients = clients.filter(
    (row) =>
      row.ending_date && row.ending_date >= first && row.ending_date <= asOf
  )
  const periodExits = exits.filter(
    (row) =>
      row.deactivated_date &&
      row.deactivated_date >= first &&
      row.deactivated_date <= asOf
  )
  const tenures = clients
    .map(tenureMonths)
    .filter((value): value is number => value !== null)
  return {
    months,
    clientCount: periodClients.length,
    listingCount: periodExits.length,
    clientReasons: topReasons(
      periodClients.map((row) => row.ending_reason_tags)
    ),
    listingReasons: topReasons(
      periodExits.map((row) => (row.exit_reason ? [row.exit_reason] : []))
    ),
    avgTenure: tenures.length
      ? Math.round((tenures.reduce((a, b) => a + b, 0) / tenures.length) * 10) /
        10
      : null,
    tenureCount: tenures.length,
    undatedClients: clients.filter((row) => !row.ending_date).length,
    undatedListings: exits.filter((row) => !row.deactivated_date).length,
  }
}
