const PRICELABS_BASE_URL = "https://api.pricelabs.co/v1"
const FETCH_TIMEOUT = 15_000
// GET /listings returns every listing (~400, ~1MB) and usually takes 8-11s;
// 15s was too tight on a slow day (Oct 14 2026 cron), so it gets its own
// per-attempt timeout and one retry.
const LISTINGS_FETCH_TIMEOUT = 20_000
const LISTINGS_FETCH_RETRIES = 1
// A retry only starts when at least this much of the caller's deadline is left.
const MIN_RETRY_WINDOW_MS = 8_000
const RETRY_DELAY_MS = 1_000

// --- Types ---

export type PriceLabsChannelDetail = {
  channel_name: string
  channel_listing_id: string
}

export type PriceLabsListing = {
  id: string
  pms: string
  name: string
  latitude: number
  longitude: number
  country: string
  city_name: string
  state: string
  no_of_bedrooms: number | string | null | undefined
  cleaning_fees: number | string | null | undefined
  channel_listing_details: PriceLabsChannelDetail[]
  min: number | string | null | undefined
  base: number | string | null | undefined
  max: number | string | null | undefined
  group: string
  subgroup: string
  tags: string
  notes: string | null
  isHidden: boolean
  push_enabled: boolean | null | undefined
  // Occupancy fields come as strings like "100 %" from PriceLabs API
  // 7-day uses "occupancy_*", 30+ uses "adjusted_occupancy_*"
  occupancy_next_7: string | number | undefined
  market_occupancy_next_7: string | number | undefined
  adjusted_occupancy_next_30: string | number | undefined
  market_adjusted_occupancy_next_30: string | number | undefined
  adjusted_occupancy_next_90: string | number | undefined
  market_adjusted_occupancy_next_90: string | number | undefined
  recommended_base_price: number | string | null | undefined
  last_date_pushed: string | null
  last_refreshed_at: string | null | undefined
  // Additional fields from API
  mpi_next_30: number | string | null | undefined
  mpi_next_60: number | string | null | undefined
  last_booked_date: string | null | undefined
  weekend_adjusted_occupancy_next_30: string | number | undefined
  market_weekend_adjusted_occupancy_next_30: string | number | undefined
}

export type PriceLabsListingsResponse = {
  listings: PriceLabsListing[]
}

// --- Helpers ---

export function isPriceLabsConfigured(): boolean {
  return !!process.env.PRICELABS_API_KEY
}

export class PriceLabsApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "PriceLabsApiError"
  }
}

export type PriceLabsFetchOptions = {
  /** Per-attempt timeout. */
  timeoutMs?: number
  /** Extra attempts after a timeout or 5xx (4xx never retries). */
  retries?: number
  /** Epoch ms; attempts are cut to fit and no retry starts too close to it. */
  deadline?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  )
}

function isRetryable(err: unknown): boolean {
  if (err instanceof PriceLabsApiError) return err.status >= 500
  return isTimeoutError(err)
}

async function priceLabsFetch<T>(
  path: string,
  params?: Record<string, string>,
  {
    timeoutMs = FETCH_TIMEOUT,
    retries = 0,
    deadline,
  }: PriceLabsFetchOptions = {}
): Promise<T> {
  const apiKey = process.env.PRICELABS_API_KEY
  if (!apiKey) throw new Error("PRICELABS_API_KEY is not configured")

  const url = new URL(`${PRICELABS_BASE_URL}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const attemptTimeouts: number[] = []
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline ? deadline - Date.now() : Infinity
    const timeout = Math.max(1, Math.min(timeoutMs, remaining))
    attemptTimeouts.push(timeout)
    try {
      const res = await fetch(url.toString(), {
        headers: { "X-API-Key": apiKey },
        signal: AbortSignal.timeout(timeout),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new PriceLabsApiError(
          res.status,
          `PriceLabs API error ${res.status}: ${body || res.statusText}`
        )
      }

      return (await res.json()) as T
    } catch (err) {
      const windowLeft = deadline
        ? deadline - Date.now() - RETRY_DELAY_MS
        : Infinity
      if (
        attempt < retries &&
        isRetryable(err) &&
        windowLeft >= MIN_RETRY_WINDOW_MS
      ) {
        console.warn(`PriceLabs ${path} attempt ${attempt + 1} failed; retrying`, {
          error: err instanceof Error ? err.message : String(err),
        })
        await sleep(RETRY_DELAY_MS)
        continue
      }
      if (isTimeoutError(err)) {
        const seconds = attemptTimeouts.map((ms) => `${Math.round(ms / 1000)}s`)
        throw new Error(
          `PriceLabs ${path} timed out (${attemptTimeouts.length} attempt${
            attemptTimeouts.length === 1 ? "" : "s"
          }: ${seconds.join(", ")})`,
          { cause: err }
        )
      }
      throw err
    }
  }
}

// --- API Functions ---

/**
 * onlySyncing=false returns every listing, including ones with sync (push)
 * off; the Hub sync and the setup check both need that full list.
 * Times out per attempt after 20s and retries once on a timeout or 5xx;
 * pass `deadline` to keep both attempts inside a caller's time budget.
 */
export async function fetchPriceLabsListings(
  onlySyncing = true,
  options: PriceLabsFetchOptions = {}
): Promise<PriceLabsListing[]> {
  const data = await priceLabsFetch<PriceLabsListingsResponse>(
    "/listings",
    {
      only_syncing_listings: String(onlySyncing),
      skip_hidden: "true",
    },
    {
      timeoutMs: LISTINGS_FETCH_TIMEOUT,
      retries: LISTINGS_FETCH_RETRIES,
      ...options,
    }
  )
  return data.listings
}

export type PriceLabsOverride = {
  date: string
  min_stay?: number | null
  min_price?: number | string | null
  min_price_type?: string | null
  check_in?: string | null
  check_out?: string | null
  lead_time_expiry?: number | null
  reason?: string | null
}

/** Date-specific overrides (DSOs) for one listing, today onward. */
export async function fetchPriceLabsOverrides(
  listingId: string,
  pms: string
): Promise<PriceLabsOverride[]> {
  const data = await priceLabsFetch<{ overrides?: PriceLabsOverride[] }>(
    `/listings/${encodeURIComponent(listingId)}/overrides`,
    { pms }
  )
  return data.overrides ?? []
}

/**
 * Parse a percentage string like "100 %" or "57 %" → integer (100, 57)
 * Also handles plain numbers.
 */
export function parseOccupancy(
  val: string | number | null | undefined
): number | null {
  return parseNullableNumber(val)
}

export function parseNullableNumber(val: unknown): number | null {
  if (typeof val === "number") return Number.isFinite(val) ? val : null
  if (typeof val !== "string") return null

  const normalized = val.trim().toLowerCase()
  if (
    !normalized ||
    normalized === "-" ||
    normalized === "unavailable" ||
    normalized === "n/a" ||
    normalized === "null"
  ) {
    return null
  }

  const cleaned = val.replace(/[^0-9.-]/g, "")
  const num = parseFloat(cleaned)
  return Number.isFinite(num) ? num : null
}

export function parsePriceLabsDate(val: unknown): string | null {
  if (typeof val !== "string") return null
  const normalized = val.trim()
  if (!normalized || normalized === "-") return null

  const timestamp = Date.parse(normalized)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}
