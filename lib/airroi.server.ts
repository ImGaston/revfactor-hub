import "server-only"

import {
  AirRoiListingResponseSchema,
  extractAirbnbListingId,
  mapAirRoiListingToRevenueBrief,
  type AirRoiRevenueBriefDraft,
  type AirRoiRevenueBriefIntake,
} from "@/lib/airroi"

const AIRROI_BASE_URL = "https://api.airroi.com"
const FETCH_TIMEOUT = 15_000

export class AirRoiApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "AirRoiApiError"
  }
}

export function isAirRoiConfigured(): boolean {
  return Boolean(process.env.AIRROI_API_KEY)
}

async function airRoiFetch(path: string, params: Record<string, string>) {
  const apiKey = process.env.AIRROI_API_KEY
  if (!apiKey) throw new AirRoiApiError("AIRROI_API_KEY is not configured", 503)

  const url = new URL(`${AIRROI_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    headers: { "X-API-KEY": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    console.error(
      `[AirROI] GET ${path} -> ${response.status}: ${detail || response.statusText}`
    )
    throw new AirRoiApiError(
      response.status === 404
        ? "AirROI could not find that Airbnb listing."
        : "AirROI listing research could not be completed.",
      response.status
    )
  }

  const payload: unknown = await response.json()
  const parsed = AirRoiListingResponseSchema.safeParse(payload)
  if (!parsed.success) {
    console.error(
      "[AirROI] Listing response did not match the documented schema",
      parsed.error
    )
    throw new AirRoiApiError(
      "AirROI returned an unexpected listing response.",
      502
    )
  }

  return parsed.data
}

export async function buildAirRoiRevenueBriefDraft(
  intake: AirRoiRevenueBriefIntake
): Promise<AirRoiRevenueBriefDraft> {
  const listingId = extractAirbnbListingId(intake.listingUrl)
  if (!listingId)
    throw new AirRoiApiError("The Airbnb listing ID is missing.", 400)

  const listing = await airRoiFetch("/listings", {
    listing_id: listingId,
    currency: "native",
  })

  return mapAirRoiListingToRevenueBrief(listing, intake)
}
