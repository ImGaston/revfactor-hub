import { z } from "zod"

import type { RevenueBriefInput } from "@/lib/revenue-brief/schema"

const requiredText = (label: string, max: number) =>
  z.string().trim().min(2, `${label} is required`).max(max)

const nullableNumber = z
  .union([z.number(), z.string()])
  .transform((value, context) => {
    const parsed = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(parsed)) {
      context.addIssue({ code: "custom", message: "Expected a numeric value" })
      return z.NEVER
    }
    return parsed
  })
  .nullable()
  .optional()

export const AirRoiRevenueBriefIntakeSchema = z.object({
  preparedFor: requiredText("Prepared for", 100),
  propertyAddress: requiredText("Property address", 180),
  listingUrl: z
    .url("Enter a valid Airbnb listing URL")
    .max(500)
    .refine((value) => extractAirbnbListingId(value) !== null, {
      message: "Enter an Airbnb URL containing a numeric listing ID",
    }),
  ownerGoals: z
    .string()
    .trim()
    .min(10, "Owner goals need a little more detail")
    .max(420),
  knownConstraints: z.string().trim().max(320),
})

export type AirRoiRevenueBriefIntake = z.infer<
  typeof AirRoiRevenueBriefIntakeSchema
>

export const AirRoiListingResponseSchema = z.object({
  listing_info: z.object({
    listing_id: z.union([z.number(), z.string()]),
    listing_name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    listing_type: z.string().nullable().optional(),
    room_type: z.string().nullable().optional(),
    cover_photo_url: z.string().nullable().optional(),
    guest_favorite: z.boolean().nullable().optional(),
  }),
  host_info: z
    .object({
      superhost: z.boolean().nullable().optional(),
      professional_management: z.boolean().nullable().optional(),
    })
    .optional(),
  location_info: z
    .object({
      country: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      locality: z.string().nullable().optional(),
      district: z.string().nullable().optional(),
      exact_location: z.boolean().nullable().optional(),
    })
    .optional(),
  property_details: z
    .object({
      guests: nullableNumber,
      bedrooms: nullableNumber,
      beds: nullableNumber,
      baths: nullableNumber,
      amenities: z.array(z.string()).optional().default([]),
    })
    .optional(),
  booking_settings: z
    .object({
      instant_book: z.boolean().nullable().optional(),
      min_nights: nullableNumber,
      cancellation_policy: z.string().nullable().optional(),
    })
    .optional(),
  pricing_info: z
    .object({
      currency: z.string().nullable().optional(),
    })
    .optional(),
  ratings: z
    .object({
      num_reviews: nullableNumber,
      rating_overall: nullableNumber,
    })
    .optional(),
  performance_metrics: z
    .object({
      ttm_revenue: nullableNumber,
      ttm_avg_rate: nullableNumber,
      ttm_occupancy: nullableNumber,
      ttm_adjusted_occupancy: nullableNumber,
      ttm_revpar: nullableNumber,
      ttm_adjusted_revpar: nullableNumber,
    })
    .optional(),
})

export type AirRoiListingResponse = z.infer<typeof AirRoiListingResponseSchema>

export type AirRoiRevenueBriefDraft = {
  draft: Partial<RevenueBriefInput>
  source: {
    provider: "AirROI"
    listingId: string
    retrievedAt: string
    currency: string | null
    modeledTtmRevenue: number | null
    modeledTtmAdr: number | null
    modeledTtmOccupancy: number | null
    modeledTtmRevpar: number | null
  }
  warnings: string[]
}

export function extractAirbnbListingId(value: string): string | null {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (hostname !== "airbnb.com" && !hostname.endsWith(".airbnb.com"))
      return null
    return url.pathname.match(/\/rooms\/(\d+)/)?.[1] ?? null
  } catch {
    return null
  }
}

const compact = (value: string, max: number) =>
  value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 3)).trim()}...`

const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())

const displayNumber = (value: number | null | undefined, fallback = "N/A") =>
  value == null
    ? fallback
    : Number.isInteger(value)
      ? String(value)
      : String(value)

function locationLabel(listing: AirRoiListingResponse): string {
  const location = listing.location_info
  const parts = [location?.locality, location?.region].filter(
    (value): value is string => Boolean(value)
  )
  return parts.join(", ") || "Location to verify"
}

function visibleStrengths(listing: AirRoiListingResponse): string {
  const strengths: string[] = []
  if (listing.listing_info.guest_favorite)
    strengths.push("guest-favorite status")
  if (listing.host_info?.superhost) strengths.push("Superhost status")
  const rating = listing.ratings?.rating_overall
  const reviews = listing.ratings?.num_reviews
  if (rating != null && reviews != null) {
    strengths.push(`${rating.toFixed(2)} rating across ${reviews} reviews`)
  }
  const amenities = (listing.property_details?.amenities ?? [])
    .slice(0, 6)
    .map(titleCase)
  if (amenities.length > 0)
    strengths.push(`visible amenities including ${amenities.join(", ")}`)

  return compact(
    strengths.length > 0
      ? `Visible listing strengths include ${strengths.join("; ")}.`
      : "Visible listing strengths should be confirmed against the live listing before delivery.",
    420
  )
}

function visibleConstraints(
  listing: AirRoiListingResponse,
  knownConstraints: string
): string {
  const details: string[] = []
  if (knownConstraints) details.push(knownConstraints)
  if (listing.booking_settings?.min_nights != null) {
    details.push(
      `${listing.booking_settings.min_nights}-night minimum shown in the AirROI snapshot`
    )
  }
  if (listing.booking_settings?.cancellation_policy) {
    details.push(
      `${titleCase(listing.booking_settings.cancellation_policy)} cancellation policy`
    )
  }
  if (listing.booking_settings?.instant_book === false) {
    details.push("Instant Book is not enabled")
  }

  return compact(
    details.length > 0
      ? `${details.join("; ")}. Verify these conditions against the live listing and owner guidance.`
      : "No constraints were supplied. Verify stay rules, owner-use dates, permits, and operating limits before delivery.",
    320
  )
}

export function mapAirRoiListingToRevenueBrief(
  listing: AirRoiListingResponse,
  intake: AirRoiRevenueBriefIntake,
  retrievedAt = new Date().toISOString()
): AirRoiRevenueBriefDraft {
  const details = listing.property_details
  const location = locationLabel(listing)
  const propertyName =
    listing.listing_info.listing_name?.trim() || "Property to verify"
  const listingType =
    listing.listing_info.listing_type?.trim() || "short-term rental"
  const bedrooms = displayNumber(details?.bedrooms)
  const baths = displayNumber(details?.baths)
  const beds = displayNumber(details?.beds)
  const guests = displayNumber(details?.guests)
  const rating = listing.ratings?.rating_overall
  const reviews = listing.ratings?.num_reviews
  const amenities = (details?.amenities ?? []).slice(0, 4).map(titleCase)
  const positioning = `${listingType} in ${location}, configured for up to ${guests} guests${
    amenities.length > 0 ? ` with ${amenities.join(", ")}` : ""
  }.`
  const performance = listing.performance_metrics

  return {
    draft: {
      preparedFor: intake.preparedFor,
      propertyName,
      propertyAddress: intake.propertyAddress,
      locationLabel: location,
      listingUrl: intake.listingUrl,
      listingStage: "existing",
      metrics: {
        rating: rating == null ? "N/A" : rating.toFixed(2),
        reviews: reviews == null ? "N/A" : String(reviews),
        layout: `${bedrooms}BR / ${baths}BA`,
        guests,
      },
      listingDetails: compact(
        `${listingType}; ${guests} guests; ${bedrooms} bedrooms; ${beds} beds; ${baths} baths`,
        240
      ),
      hostSignals: compact(
        [
          listing.host_info?.superhost ? "Superhost" : null,
          listing.listing_info.guest_favorite ? "Guest favorite" : null,
          rating == null ? null : `${rating.toFixed(2)} rating`,
          reviews == null ? null : `${reviews} reviews`,
        ]
          .filter((value): value is string => Boolean(value))
          .join("; ") ||
          "Host and trust signals should be verified against the live listing.",
        240
      ),
      currentPositioning: compact(positioning, 360),
      strengths: visibleStrengths(listing),
      visibleConstraints: visibleConstraints(listing, intake.knownConstraints),
      executiveSummary: compact(
        `${propertyName} is an established ${listingType.toLowerCase()} in ${location}. The initial review should test pricing, stay rules, and forward calendar protection against the owner's priority: ${intake.ownerGoals}.`,
        520
      ),
      bottomLine: compact(
        `The clearest revenue opportunity is to protect high-value booking windows while using targeted pricing and stay controls to advance the owner's goal: ${intake.ownerGoals}.`,
        420
      ),
      ownerTakeaway: compact(
        `The initial review should focus on ${intake.ownerGoals}. RevFactor would validate the opportunity against the live calendar, owner-reported performance, and approved comparable evidence before making a final recommendation.`,
        520
      ),
    },
    source: {
      provider: "AirROI",
      listingId: String(listing.listing_info.listing_id),
      retrievedAt,
      currency: listing.pricing_info?.currency ?? null,
      modeledTtmRevenue: performance?.ttm_revenue ?? null,
      modeledTtmAdr: performance?.ttm_avg_rate ?? null,
      modeledTtmOccupancy:
        performance?.ttm_adjusted_occupancy ??
        performance?.ttm_occupancy ??
        null,
      modeledTtmRevpar:
        performance?.ttm_adjusted_revpar ?? performance?.ttm_revpar ?? null,
    },
    warnings: [
      "AirROI performance metrics are third-party modeled estimates, not owner-reported actuals.",
      "Demand drivers, property constraints, and RevFactor benchmarks still require analyst verification.",
    ],
  }
}
