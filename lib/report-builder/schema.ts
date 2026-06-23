// Report Builder field schema + rename layer.
// The API ships "friendly" PriceLabs field names; the hub stores stable
// snake_case columns. The rename lives HERE and nowhere else.
//
// A report row has 55 fields: 20 listing-level (constant across the 12 months
// of a listing) + 35 month-level. We split and rename per row, deriving the
// period from "Year Month" (NOT the standalone "Year", which is just part of
// the period key).

import { parseNullableNumber, parsePriceLabsDate } from "@/lib/pricelabs"

/** A single raw row from `report_data` (one listing × one month). */
export type ReportRow = Record<string, unknown>

/** Parsed listing-level attributes (maps to `report_listings` columns). */
export type ParsedListing = {
  listing_id: string
  listing_name: string | null
  group_name: string | null
  sub_group_name: string | null
  property_name: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  bedroom_count: number | null
  unit_count: number | null
  pms_name: string | null
  is_parent: boolean | null
  sync_on: boolean | null
  base_price: number | null
  min_price: number | null
  max_price: number | null
  base_price_recommendation: number | null
  tags: string[] | null
  last_booked_date: string | null
}

/**
 * Month-level metric column → API field name. The rename source of truth.
 * Every key is a `report_metrics` numeric column; every value is the exact
 * field name in the report payload.
 */
export const METRIC_FIELD_MAP = {
  // Revenue
  rental_revenue: "Rental Revenue",
  rental_revenue_stly: "Rental Revenue STLY",
  rental_revenue_ly: "Rental Revenue LY",
  rental_revenue_stly_yoy_pct: "Rental Revenue STLY YoY %",
  // ADR
  rental_adr: "ADR",
  rental_adr_stly: "ADR STLY",
  rental_adr_ly: "ADR LY",
  rental_adr_stly_yoy_pct: "ADR STLY YoY %",
  market_adr: "Average Market ADR",
  market_adr_stly: "Average Market ADR STLY",
  market_adr_stly_yoy_pct: "Average Market ADR STLY YoY %",
  // RevPAR
  rental_revpar: "RevPar",
  rental_revpar_stly: "RevPar STLY",
  rental_revpar_ly: "RevPar LY",
  rental_revpar_stly_yoy_pct: "RevPar STLY YoY %",
  market_revpar: "Average Market RevPar",
  market_revpar_stly: "Average Market RevPar STLY",
  market_revpar_ly: "Average Market RevPar LY",
  market_revpar_stly_yoy_pct: "Average Market RevPar STLY YoY %",
  revpar_index: "Market Penetration RevPar Index",
  // Occupancy (%)
  adjusted_occupancy_pct: "Occupancy",
  adjusted_occupancy_stly_pct: "Occupancy STLY",
  adjusted_occupancy_ly_pct: "Occupancy LY",
  market_occupancy_pct: "Average Market Occupancy",
  market_occupancy_stly_pct: "Average Market Occupancy STLY",
  market_occupancy_ly_pct: "Average Market Occupancy LY",
  // Booking window (days)
  median_booking_window: "Booking Window",
  median_booking_window_stly: "Booking Window STLY",
  median_booking_window_ly: "Booking Window LY",
  market_median_booking_window: "Median Market Booking Window",
  market_median_booking_window_stly: "Median Market Booking Window STLY",
  market_median_booking_window_ly: "Median Market Booking Window LY",
  // Open inventory
  potential_revenue_open_inventory:
    "Available and Bookable dates Recommended Potential Revenue",
} as const

export type MetricColumn = keyof typeof METRIC_FIELD_MAP

/** Parsed month-level metrics (maps to `report_metrics` numeric columns). */
export type ParsedMetrics = Record<MetricColumn, number | null>

function asString(val: unknown): string | null {
  if (typeof val === "string") {
    const t = val.trim()
    return t === "" ? null : t
  }
  if (typeof val === "number") return String(val)
  return null
}

function asBoolean(val: unknown): boolean | null {
  if (typeof val === "boolean") return val
  if (typeof val === "number") return val !== 0 // "Sync ON/OFF" comes as 1/0
  if (typeof val === "string") {
    const t = val.trim().toLowerCase()
    if (t === "true" || t === "1" || t === "on" || t === "yes") return true
    if (t === "false" || t === "0" || t === "off" || t === "no") return false
  }
  return null
}

function asStringArray(val: unknown): string[] | null {
  if (!Array.isArray(val)) return null
  const out = val.map((v) => String(v).trim()).filter((v) => v !== "")
  return out.length > 0 ? out : null
}

/**
 * Derive the period (first of month, ISO date) from "Year Month" like
 * "2026-01.Jan" → "2026-01-01". Returns null if it can't be parsed.
 */
export function parsePeriod(yearMonth: unknown): string | null {
  if (typeof yearMonth !== "string") return null
  const match = yearMonth.trim().match(/^(\d{4})-(\d{2})/)
  if (!match) return null
  return `${match[1]}-${match[2]}-01`
}

/** Extract & parse the 20 listing-level attributes from a row. */
export function parseListing(row: ReportRow): ParsedListing | null {
  const listingId = asString(row["Listing ID"])
  if (!listingId) return null
  return {
    listing_id: listingId,
    listing_name: asString(row["Listing Name"]),
    group_name: asString(row["Group Name"]),
    sub_group_name: asString(row["Sub Group Name"]),
    property_name: asString(row["Property Name"]),
    city: asString(row["City"]),
    latitude: parseNullableNumber(row["Latitude"]),
    longitude: parseNullableNumber(row["Longitude"]),
    bedroom_count: parseNullableNumber(row["Bedroom Count"]),
    unit_count: parseNullableNumber(row["Unit Count"]),
    pms_name: asString(row["PMS Name"]),
    is_parent: asBoolean(row["IS PARENT"]),
    sync_on: asBoolean(row["Sync ON/OFF"]),
    base_price: parseNullableNumber(row["Base Price"]),
    min_price: parseNullableNumber(row["Min Price"]),
    max_price: parseNullableNumber(row["Max Price"]),
    base_price_recommendation: parseNullableNumber(
      row["Base Price Recommendation"]
    ),
    tags: asStringArray(row["Tag"]),
    last_booked_date: parsePriceLabsDate(row["Last Booked date"]),
  }
}

/** Extract & parse the 35 month-level metrics from a row. */
export function parseMetrics(row: ReportRow): ParsedMetrics {
  const out = {} as ParsedMetrics
  for (const col of Object.keys(METRIC_FIELD_MAP) as MetricColumn[]) {
    out[col] = parseNullableNumber(row[METRIC_FIELD_MAP[col]])
  }
  return out
}
