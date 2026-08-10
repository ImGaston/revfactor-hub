import "server-only"

import {
  AirRoiListingResponseSchema,
  extractAirbnbListingId,
  mapAirRoiListingToRevenueBrief,
  type AirRoiRevenueBriefDraft,
  type AirRoiRevenueBriefIntake,
} from "@/lib/airroi"
import {
  AirRoiEstimateResponseSchema,
  mapAirRoiEstimateToRevenueBrief,
  type AirRoiNewPropertyDraft,
  type AirRoiNewPropertyIntake,
} from "@/lib/airroi-estimate"

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

async function airRoiFetch(
  path: string,
  params: Record<string, string>
): Promise<unknown> {
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

  return response.json()
}

function parseListing(payload: unknown) {
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

  const listing = parseListing(
    await airRoiFetch("/listings", {
      listing_id: listingId,
      currency: "native",
    })
  )

  return mapAirRoiListingToRevenueBrief(listing, intake)
}

export async function buildAirRoiNewPropertyDraft(
  intake: AirRoiNewPropertyIntake
): Promise<AirRoiNewPropertyDraft> {
  const payload = await airRoiFetch("/calculator/estimate", {
    address: intake.propertyAddress,
    radius: String(intake.radiusMiles),
    room_type: "entire_home",
    bedrooms: String(intake.bedrooms),
    baths: String(intake.baths),
    guests: String(intake.guests),
    currency: "native",
  })

  const parsed = AirRoiEstimateResponseSchema.safeParse(payload)
  if (!parsed.success) {
    console.error(
      "[AirROI] Revenue estimate response did not match the documented schema",
      parsed.error
    )
    throw new AirRoiApiError(
      "AirROI returned an unexpected revenue estimate response.",
      502
    )
  }

  return mapAirRoiEstimateToRevenueBrief(parsed.data, intake)
}
