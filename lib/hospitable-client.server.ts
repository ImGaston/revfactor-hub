import "server-only"

import { pmsErrorFromHttpStatus, type DiscoveredProperty, type PmsErrorCode } from "@/lib/pms-connections"
import { normalizeHospitableReservation, type DateWindow, type NormalizedPmsReservation } from "@/lib/pms-reservations"

// Minimal read-only Hospitable Public API client (personal access token).
//
//   * Fixed base URL; GET only; redirects are refused so the token is never
//     forwarded to another host.
//   * Per-request timeout and bounded pagination (per_page 100, max 20 pages).
//   * Never logs or returns raw response bodies (they can carry guest or
//     account data) and never echoes the token. Errors are typed codes.
//
// Verified facts (Spencer pilot, 2026-10-07): `GET /properties?include=listings`
// returns channel listings with `platform` + `platform_id` (Airbnb IDs as
// strings); pagination is `meta.current_page/last_page/total`.

export const HOSPITABLE_BASE_URL = "https://public.api.hospitable.com/v2"

const PER_PAGE = 100
const MAX_PAGES = 20
const DEFAULT_TIMEOUT_MS = 15_000

type Fetcher = (input: URL, init: RequestInit) => Promise<Response>

export type HospitableResult<T> = { ok: true; data: T } | { ok: false; code: PmsErrorCode; retryAfterMs?: number }

export type HospitableProperty = DiscoveredProperty

type RawListing = { platform?: unknown; platform_id?: unknown }
type RawProperty = { id?: unknown; name?: unknown; public_name?: unknown; listings?: unknown }

function platformId(listings: unknown, platforms: string[]): string | null {
  if (!Array.isArray(listings)) return null
  for (const listing of listings as RawListing[]) {
    const platform = typeof listing?.platform === "string" ? listing.platform.toLowerCase() : ""
    const id = listing?.platform_id
    if (!platforms.includes(platform)) continue
    if (typeof id === "string" && id.trim()) return id.trim()
    if (typeof id === "number" && Number.isSafeInteger(id)) return String(id)
  }
  return null
}

/** Project a raw property onto the few fields mapping needs. Nothing else is kept. */
export function parseHospitableProperty(row: unknown): HospitableProperty | null {
  const raw = (row ?? {}) as RawProperty
  if (typeof raw.id !== "string" || !raw.id.trim() || raw.id.length > 100) return null
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : typeof raw.public_name === "string" && raw.public_name.trim()
        ? raw.public_name.trim()
        : null
  const airbnb = platformId(raw.listings, ["airbnb"])
  return {
    external_property_id: raw.id,
    name: name ? name.slice(0, 300) : null,
    airbnb_id: airbnb && /^\d{1,30}$/.test(airbnb) ? airbnb : null,
    vrbo_id: platformId(raw.listings, ["homeaway", "vrbo"])?.slice(0, 60) ?? null,
  }
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  return name === "TimeoutError" || name === "AbortError"
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after")
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

async function getJson(
  path: string,
  params: Record<string, string> | URLSearchParams,
  token: string,
  fetcher: Fetcher,
  timeoutMs: number
): Promise<HospitableResult<unknown>> {
  const url = new URL(`${HOSPITABLE_BASE_URL}${path}`)
  url.search = (params instanceof URLSearchParams ? params : new URLSearchParams(params)).toString()
  let response: Response
  try {
    response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return { ok: false, code: isTimeout(error) ? "timeout" : "provider_unavailable" }
  }
  if (!response.ok) {
    // Drain without reading into memory we keep; the body is never logged.
    await response.body?.cancel().catch(() => undefined)
    const code = pmsErrorFromHttpStatus(response.status)
    return code === "rate_limited" ? { ok: false, code, retryAfterMs: retryAfterMs(response) } : { ok: false, code }
  }
  try {
    return { ok: true, data: await response.json() }
  } catch {
    return { ok: false, code: "unexpected_response" }
  }
}

/**
 * List every property the token can read, with Airbnb/Vrbo channel IDs.
 * Fails closed on malformed pagination, duplicates, changing totals or more
 * than MAX_PAGES pages.
 */
export async function listHospitableProperties(
  token: string,
  options: { fetcher?: Fetcher; timeoutMs?: number } = {}
): Promise<HospitableResult<HospitableProperty[]>> {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const clean = token.trim()
  if (!clean || /\s/.test(clean)) return { ok: false, code: "invalid_token" }

  const properties: HospitableProperty[] = []
  const seen = new Set<string>()
  let expectedTotal: number | null = null

  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await getJson(
      "/properties",
      { include: "listings", per_page: String(PER_PAGE), page: String(page) },
      clean,
      fetcher,
      timeoutMs
    )
    if (!result.ok) return result

    const body = result.data as { data?: unknown; meta?: { current_page?: unknown; last_page?: unknown; total?: unknown } }
    const meta = body?.meta
    if (
      !Array.isArray(body?.data) ||
      !meta ||
      !Number.isInteger(meta.last_page) ||
      (meta.last_page as number) < 1 ||
      (meta.last_page as number) > MAX_PAGES ||
      (meta.current_page !== undefined && meta.current_page !== page)
    ) {
      // An account with no properties may report last_page 1 with empty data.
      return { ok: false, code: "unexpected_response" }
    }
    const total = Number.isInteger(meta.total) ? (meta.total as number) : null
    if (expectedTotal !== null && total !== null && total !== expectedTotal) return { ok: false, code: "unexpected_response" }
    expectedTotal = total ?? expectedTotal

    for (const row of body.data as unknown[]) {
      const property = parseHospitableProperty(row)
      if (!property || seen.has(property.external_property_id)) return { ok: false, code: "unexpected_response" }
      seen.add(property.external_property_id)
      properties.push(property)
    }

    if (page >= (meta.last_page as number)) {
      if (expectedTotal !== null && properties.length !== expectedTotal) return { ok: false, code: "unexpected_response" }
      return { ok: true, data: properties }
    }
  }
  return { ok: false, code: "unexpected_response" }
}

// ---------------------------------------------------------------------------
// Reservations (phase 2): one check-in window for a set of properties
// ---------------------------------------------------------------------------

const RESERVATION_MAX_PAGES = 50
const RATE_LIMIT_RETRIES = 3
const DEFAULT_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 10_000
/** Never start a request with less time than this before the deadline. */
const MIN_REQUEST_MS = 2_000

export type FetchReservationsOptions = {
  fetcher?: Fetcher
  /** Absolute epoch ms; requests and backoff waits never run past it. */
  deadline?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/**
 * `GET /reservations?properties[]=…&start_date&end_date&date_query=checkin
 * &include=financials,properties&per_page=100&page=N` for one window (the
 * caller keeps windows ≤ 3 months). Every row is normalized immediately (no
 * guest, message or code fields survive) and must belong to a requested
 * property. 429s back off (Retry-After, capped) up to 3 times within the
 * deadline. Fails closed on malformed pagination, duplicates, a changing
 * total or more than 50 pages.
 */
export async function fetchHospitableReservations(
  token: string,
  request: { propertyIds: string[]; window: DateWindow },
  options: FetchReservationsOptions = {}
): Promise<HospitableResult<NormalizedPmsReservation[]>> {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = options.deadline ?? now() + 50_000
  const clean = token.trim()
  if (!clean || /\s/.test(clean)) return { ok: false, code: "invalid_token" }
  const propertyIds = [...new Set(request.propertyIds)]
  if (propertyIds.length === 0 || propertyIds.length > 100) return { ok: false, code: "unexpected_response" }

  const rows: NormalizedPmsReservation[] = []
  const seen = new Set<string>()
  let expectedTotal: number | null = null

  for (let page = 1; page <= RESERVATION_MAX_PAGES; page++) {
    const params = new URLSearchParams()
    for (const id of propertyIds) params.append("properties[]", id)
    params.set("start_date", request.window.start)
    params.set("end_date", request.window.end)
    params.set("date_query", "checkin")
    params.set("include", "financials,properties")
    params.set("per_page", String(PER_PAGE))
    params.set("page", String(page))

    let result: HospitableResult<unknown> | null = null
    for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
      const remaining = deadline - now()
      if (remaining < MIN_REQUEST_MS) return { ok: false, code: "timeout" }
      result = await getJson("/reservations", params, clean, fetcher, Math.min(DEFAULT_TIMEOUT_MS, remaining - 500))
      if (result.ok || result.code !== "rate_limited" || attempt === RATE_LIMIT_RETRIES) break
      const wait = result.retryAfterMs ?? DEFAULT_BACKOFF_MS * 2 ** attempt
      // A longer Retry-After than we can afford: stop now; the cursor resumes later.
      if (wait > MAX_BACKOFF_MS || now() + wait + MIN_REQUEST_MS > deadline) break
      await sleep(wait)
    }
    if (!result || !result.ok) return result ?? { ok: false, code: "unexpected_response" }

    const body = result.data as { data?: unknown; meta?: { current_page?: unknown; last_page?: unknown; total?: unknown } }
    const meta = body?.meta
    if (
      !Array.isArray(body?.data) ||
      !meta ||
      !Number.isInteger(meta.last_page) ||
      (meta.last_page as number) < 1 ||
      (meta.last_page as number) > RESERVATION_MAX_PAGES ||
      (meta.current_page !== undefined && meta.current_page !== page)
    ) {
      return { ok: false, code: "unexpected_response" }
    }
    const total = Number.isInteger(meta.total) ? (meta.total as number) : null
    if (expectedTotal !== null && total !== null && total !== expectedTotal) return { ok: false, code: "unexpected_response" }
    expectedTotal = total ?? expectedTotal

    for (const raw of body.data as unknown[]) {
      const row = normalizeHospitableReservation(raw, propertyIds)
      if (!row || seen.has(row.external_reservation_id)) return { ok: false, code: "unexpected_response" }
      seen.add(row.external_reservation_id)
      rows.push(row)
    }

    if (page >= (meta.last_page as number)) {
      if (expectedTotal !== null && rows.length !== expectedTotal) return { ok: false, code: "unexpected_response" }
      return { ok: true, data: rows }
    }
  }
  return { ok: false, code: "unexpected_response" }
}
