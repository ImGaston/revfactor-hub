// Client-safe helpers for the /support queue's URL filters and client picker.
// The server loader (lib/support-queue.server.ts) and the page share these, so
// the URL contract is parsed and tested in one place.

/** Recently closed tickets shown when no client is picked. */
export const SUPPORT_RECENT_CLOSED_DAYS = 30
export const SUPPORT_RECENT_CLOSED_LIMIT = 50
/**
 * Cap on one client's closed tickets (`?client=<id>&closed=1`), newest first.
 * The loader counts the full total so the page can say when it is capped.
 */
export const SUPPORT_CLIENT_CLOSED_CAP = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SupportQueueFilters = {
  /** `clients.id` from `?client=`; null when absent or not a uuid. */
  clientId: string | null
  /** `?closed=1`; only honoured with a client picked. */
  showClosed: boolean
}

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * `/support?client=<uuid>&closed=1`. Anything else is ignored: a bad client
 * value falls back to every client, and `closed` without a client is dropped
 * (the default view already shows the last 30 days of closed tickets).
 */
export function parseSupportQueueParams(sp: SearchParams): SupportQueueFilters {
  const raw = first(sp.client)?.trim() ?? ""
  const clientId = UUID_RE.test(raw) ? raw.toLowerCase() : null
  return { clientId, showClosed: clientId !== null && first(sp.closed) === "1" }
}

/** The query string for a filter state, in a stable order (empty for none). */
export function supportQueueSearch(filters: SupportQueueFilters): string {
  if (!filters.clientId) return ""
  const params = new URLSearchParams({ client: filters.clientId })
  if (filters.showClosed) params.set("closed", "1")
  return `?${params.toString()}`
}

export function supportQueueHref(filters: SupportQueueFilters): string {
  return `/support${supportQueueSearch(filters)}`
}

/** Open tickets per client, from `support_tickets` rows in an active status. */
export function countOpenTicketsByClient(rows: { client_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.client_id, (counts.get(row.client_id) ?? 0) + 1)
  return counts
}

export type SupportClientOption = {
  id: string
  name: string
  status: string
  openCount: number
}

/**
 * Picker options: every active client, plus any other client that still has
 * open tickets or is the one picked (so a link to an inactive client's
 * history still shows its name). Sorted by name.
 */
export function buildSupportClientOptions(
  clients: { id: string; name: string; status: string }[],
  openCounts: Map<string, number>,
  selectedId: string | null
): SupportClientOption[] {
  return clients
    .filter((c) => c.status === "active" || (openCounts.get(c.id) ?? 0) > 0 || c.id === selectedId)
    .map((c) => ({ id: c.id, name: c.name, status: c.status, openCount: openCounts.get(c.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id))
}
