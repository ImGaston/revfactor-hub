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
  no_of_bedrooms: number
  cleaning_fees: number
  channel_listing_details: PriceLabsChannelDetail[]
  min: number
  base: number
  max: number
  group: string
  subgroup: string
  tags: string
  notes: string
  isHidden: boolean
  push_enabled: boolean
  occupancy_next_7: number
  market_occupancy_next_7: number
  occupancy_next_30: number
  market_occupancy_next_30: number
  occupancy_next_60: number
  market_occupancy_next_60: number
  occupancy_past_90: number
  market_occupancy_past_90: number
  revenue_past_7: number | string
  stly_revenue_past_7: number | string
  recommended_base_price: number
  last_date_pushed: string | null
  last_refreshed_at: string | null
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
 * Parse a revenue value that might be a string with trailing comma/whitespace
 * e.g. "76," → 76
 */
export function parseRevenue(val: number | string | null | undefined): number | null {
  if (val == null) return null
  if (typeof val === "number") return val
  const cleaned = val.replace(/[^0-9.-]/g, "")
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}
