import "server-only"

import { pmsErrorFromHttpStatus, type DiscoveredProperty, type PmsErrorCode } from "@/lib/pms-connections"

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

export type HospitableResult<T> = { ok: true; data: T } | { ok: false; code: PmsErrorCode }

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

async function getJson(
  path: string,
  params: Record<string, string>,
  token: string,
  fetcher: Fetcher,
  timeoutMs: number
): Promise<HospitableResult<unknown>> {
  const url = new URL(`${HOSPITABLE_BASE_URL}${path}`)
  url.search = new URLSearchParams(params).toString()
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
    return { ok: false, code: pmsErrorFromHttpStatus(response.status) }
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
// Phase 2 (not built): reservation backfill + daily sync.
// ---------------------------------------------------------------------------

/**
 * Shape of the Phase 2 request: `GET /reservations` with `properties[]`,
 * `start_date`/`end_date`, `include=financials`, `page`/`per_page` (≤100) and
 * `meta.last_page`. Money arrives as integer minor units. Only confirmed
 * mappings (client_pms_properties.mapping_status = 'confirmed') may be
 * backfilled. Intentionally no implementation in phase 1.
 */
export type HospitableReservationsRequest = {
  propertyIds: string[]
  startDate: string
  endDate: string
  includeFinancials: true
}
