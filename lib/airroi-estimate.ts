import { z } from "zod"

import type { RevenueBriefInput } from "@/lib/revenue-brief/schema"

const requiredText = (label: string, max: number) =>
  z.string().trim().min(2, `${label} is required`).max(max)

const numeric = z
  .union([z.number(), z.string()])
  .transform((value, context) => {
    const parsed = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(parsed)) {
      context.addIssue({ code: "custom", message: "Expected a numeric value" })
      return z.NEVER
    }
    return parsed
  })

const nullableNumeric = numeric.nullable().optional()

export const AirRoiNewPropertyIntakeSchema = z.object({
  preparedFor: requiredText("Prepared for", 100),
  propertyName: requiredText("Property name", 120),
  propertyAddress: requiredText("Property address", 180),
  bedrooms: z.coerce.number().int().min(0).max(20),
  baths: z.coerce.number().min(0.5).max(20),
  guests: z.coerce.number().int().min(1).max(30),
  radiusMiles: z.coerce.number().min(1).max(10).default(3),
  ownerGoals: z
    .string()
    .trim()
    .min(10, "Owner goals need a little more detail")
    .max(420),
  knownConstraints: z.string().trim().max(320),
})

export type AirRoiNewPropertyIntake = z.infer<
  typeof AirRoiNewPropertyIntakeSchema
>

const PercentileSchema = z.object({
  avg: numeric.optional(),
  p25: numeric,
  p50: numeric,
  p75: numeric,
  p90: numeric,
})

const NestedComparableSchema = z.object({
  listing_info: z.object({
    listing_id: z.union([z.string(), z.number()]),
    listing_name: z.string().nullable().optional(),
  }),
  location_info: z
    .object({
      locality: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
    })
    .optional(),
  property_details: z
    .object({
      bedrooms: nullableNumeric,
    })
    .optional(),
  performance_metrics: z
    .object({
      ttm_revenue: nullableNumeric,
      ttm_avg_rate: nullableNumeric,
      ttm_adjusted_occupancy: nullableNumeric,
      ttm_occupancy: nullableNumeric,
    })
    .optional(),
})

const FlatComparableSchema = z
  .object({
    listing_id: z.union([z.string(), z.number()]),
    name: z.string().nullable().optional(),
    locality: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
    bedrooms: nullableNumeric,
    ttm_revenue: nullableNumeric,
    ttm_avg_rate: nullableNumeric,
    ttm_adjusted_occupancy: nullableNumeric,
    ttm_occupancy: nullableNumeric,
  })
  .transform((comparable) => ({
    listing_info: {
      listing_id: comparable.listing_id,
      listing_name: comparable.name,
    },
    location_info: {
      locality: comparable.locality,
      region: comparable.region,
    },
    property_details: { bedrooms: comparable.bedrooms },
    performance_metrics: {
      ttm_revenue: comparable.ttm_revenue,
      ttm_avg_rate: comparable.ttm_avg_rate,
      ttm_adjusted_occupancy: comparable.ttm_adjusted_occupancy,
      ttm_occupancy: comparable.ttm_occupancy,
    },
  }))

export const AirRoiEstimateResponseSchema = z
  .object({
    location: z.object({ latitude: numeric, longitude: numeric }).optional(),
    revenue: numeric,
    average_daily_rate: numeric.optional(),
    adr: numeric.optional(),
    occupancy: numeric,
    percentiles: z.object({
      revenue: PercentileSchema,
      average_daily_rate: PercentileSchema.optional(),
      adr: PercentileSchema.optional(),
      occupancy: PercentileSchema,
    }),
    currency: z.string().min(2).max(8),
    monthly_revenue_distributions: z.array(numeric).length(12),
    comparable_listings: z
      .array(z.union([NestedComparableSchema, FlatComparableSchema]))
      .min(3),
  })
  .transform((response, context) => {
    const adrPercentiles =
      response.percentiles.average_daily_rate ?? response.percentiles.adr
    if (!adrPercentiles) {
      context.addIssue({
        code: "custom",
        path: ["percentiles", "average_daily_rate"],
        message: "ADR percentile data is required",
      })
      return z.NEVER
    }

    return {
      location: response.location,
      revenue: response.revenue,
      average_daily_rate:
        response.average_daily_rate ??
        response.adr ??
        adrPercentiles.avg ??
        adrPercentiles.p50,
      occupancy: response.occupancy,
      percentiles: {
        revenue: response.percentiles.revenue,
        average_daily_rate: adrPercentiles,
        occupancy: response.percentiles.occupancy,
      },
      currency: response.currency,
      monthly_revenue_distributions: response.monthly_revenue_distributions,
      comparable_listings: response.comparable_listings,
    }
  })

export type AirRoiEstimateResponse = z.infer<
  typeof AirRoiEstimateResponseSchema
>

export type AirRoiNewPropertyDraft = {
  draft: Partial<RevenueBriefInput>
  projection: NonNullable<RevenueBriefInput["projection"]>
  warnings: string[]
}

const compact = (value: string, max: number) =>
  value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 3)).trim()}...`

const sentence = (value: string) => value.replace(/[.!?]+$/, "")

function locationLabel(address: string): string {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length >= 2 ? parts.slice(-2).join(", ") : address
}

function scenario(
  response: AirRoiEstimateResponse,
  percentile: "p25" | "p50" | "p75"
) {
  return {
    revenue: response.percentiles.revenue[percentile],
    adr: response.percentiles.average_daily_rate[percentile],
    occupancy: response.percentiles.occupancy[percentile],
  }
}

function monthlyShares(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return Array.from({ length: 12 }, () => 0)
  return values.map((value) => value / total)
}

export function mapAirRoiEstimateToRevenueBrief(
  response: AirRoiEstimateResponse,
  intake: AirRoiNewPropertyIntake,
  retrievedAt = new Date().toISOString()
): AirRoiNewPropertyDraft {
  const location = locationLabel(intake.propertyAddress)
  const comparableCount = response.comparable_listings.length
  const constraints =
    intake.knownConstraints ||
    "No constraints were supplied. Verify permits, parking, owner-use dates, turnover capacity, and operating limits before delivery."

  const projection: NonNullable<RevenueBriefInput["projection"]> = {
    provider: "AirROI",
    retrievedAt,
    currency: response.currency.toUpperCase(),
    radiusMiles: intake.radiusMiles,
    comparableCount,
    conservative: scenario(response, "p25"),
    base: scenario(response, "p50"),
    strong: scenario(response, "p75"),
    monthlyRevenueShares: monthlyShares(response.monthly_revenue_distributions),
    comparables: response.comparable_listings
      .slice(0, 5)
      .map((comparable, index) => {
        const compLocation =
          [comparable.location_info?.locality, comparable.location_info?.region]
            .filter((value): value is string => Boolean(value))
            .join(", ") || location
        const performance = comparable.performance_metrics
        return {
          listingId: String(comparable.listing_info.listing_id),
          name:
            comparable.listing_info.listing_name?.trim() ||
            `Comparable ${index + 1}`,
          location: compLocation,
          bedrooms: comparable.property_details?.bedrooms ?? null,
          revenue: performance?.ttm_revenue ?? null,
          adr: performance?.ttm_avg_rate ?? null,
          occupancy:
            performance?.ttm_adjusted_occupancy ??
            performance?.ttm_occupancy ??
            null,
        }
      }),
  }

  return {
    projection,
    draft: {
      preparedFor: intake.preparedFor,
      propertyName: intake.propertyName,
      propertyAddress: intake.propertyAddress,
      locationLabel: location,
      listingUrl: "",
      listingStage: "new",
      metrics: {
        rating: "Pre-launch",
        reviews: "0",
        layout: `${intake.bedrooms}BR / ${intake.baths}BA`,
        guests: String(intake.guests),
      },
      listingDetails: `${intake.bedrooms}-bedroom, ${intake.baths}-bath entire-home concept configured for up to ${intake.guests} guests. Final bed count and amenities require confirmation.`,
      hostSignals:
        "Pre-launch property with no listing reviews or booking history. Launch quality and review-ramp assumptions require operator confirmation.",
      currentPositioning: compact(
        `Proposed entire-home short-term rental in ${location}, configured for up to ${intake.guests} guests. Positioning should be finalized against the selected comparable set and target guest segments.`,
        360
      ),
      strengths: compact(
        `The proposed ${intake.bedrooms}-bedroom layout and ${intake.guests}-guest capacity can be positioned against ${comparableCount} nearby AirROI comparables. Final upside depends on design, amenities, photography, reviews, and operating execution.`,
        420
      ),
      visibleConstraints: compact(constraints, 320),
      executiveSummary: compact(
        `${intake.propertyName} is a pre-launch opportunity in ${location}. AirROI's comparable model provides a conservative, base, and strong-execution range; the proposal should use the base case for planning and treat the upper case as earned performance, not a promise.`,
        520
      ),
      bottomLine: compact(
        `The initial underwriting supports a staged launch decision around the owner's priority: ${sentence(intake.ownerGoals)}. The first operating plan should protect rate integrity while earning reviews and validating booking pace.`,
        420
      ),
      ownerTakeaway: compact(
        `The base projection is a market-informed planning case, not guaranteed income. RevFactor and the property-management partner would validate the comp set, launch readiness, permit path, and monthly pacing before presenting a final operating target.`,
        520
      ),
      demandDrivers: [
        {
          name: "Nearby comparable STR demand",
          distance: `Within ${intake.radiusMiles} mi`,
          why: `AirROI identified ${comparableCount} comparable listings for the initial revenue estimate. Review individual relevance before delivery.`,
        },
      ],
      distanceNote:
        "The comparable radius and geocoded location come from AirROI. Verify the address, comp relevance, and local drive-time demand before final underwriting.",
      finalDataRequest: compact(
        `A final recommendation requires confirmed property plans, bed configuration, amenity scope, photography and launch timing, permit status, owner-use constraints, operating costs, and analyst approval of the ${comparableCount}-listing AirROI comp set.`,
        420
      ),
      projection,
    },
    warnings: [
      "AirROI projections are third-party modeled estimates based on comparable listings, not guaranteed owner income.",
      "P25, P50, and P75 scenarios should be reviewed against property quality, regulations, fees, and launch execution.",
    ],
  }
}
