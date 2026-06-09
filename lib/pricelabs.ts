const PRICELABS_BASE_URL = "https://api.pricelabs.co/v1"
const FETCH_TIMEOUT = 15_000

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

async function priceLabsFetch<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const apiKey = process.env.PRICELABS_API_KEY
  if (!apiKey) throw new Error("PRICELABS_API_KEY is not configured")

  const url = new URL(`${PRICELABS_BASE_URL}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `PriceLabs API error ${res.status}: ${body || res.statusText}`
    )
  }

  return res.json() as Promise<T>
}

// --- API Functions ---

export async function fetchPriceLabsListings(
  onlySyncing = true
): Promise<PriceLabsListing[]> {
  const data = await priceLabsFetch<PriceLabsListingsResponse>("/listings", {
    only_syncing_listings: String(onlySyncing),
    skip_hidden: "true",
  })
  return data.listings
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
