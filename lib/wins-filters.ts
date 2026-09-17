// Pure helpers for the Wins list filters that are not plain columns on
// win_candidates: portfolio size (active listings per client) and bedrooms
// (listings.pl_no_of_bedrooms). Buckets are fixed so URLs stay stable and the
// dropdowns stay short; both are multi-select (OR within a filter).

export type RangeBucket = {
  value: string
  label: string
  min: number
  // null = open-ended
  max: number | null
}

export const PORTFOLIO_SIZE_BUCKETS = [
  { value: "1", label: "1 listing", min: 1, max: 1 },
  { value: "2-3", label: "2–3 listings", min: 2, max: 3 },
  { value: "4-9", label: "4–9 listings", min: 4, max: 9 },
  { value: "10+", label: "10+ listings", min: 10, max: null },
] as const satisfies readonly RangeBucket[]
export type PortfolioSizeBucket = (typeof PORTFOLIO_SIZE_BUCKETS)[number]["value"]

export const BEDROOM_BUCKETS = [
  { value: "0-1", label: "Studio / 1 bedroom", min: 0, max: 1 },
  { value: "2", label: "2 bedrooms", min: 2, max: 2 },
  { value: "3", label: "3 bedrooms", min: 3, max: 3 },
  { value: "4", label: "4 bedrooms", min: 4, max: 4 },
  { value: "5", label: "5 bedrooms", min: 5, max: 5 },
  { value: "6+", label: "6+ bedrooms", min: 6, max: null },
] as const satisfies readonly RangeBucket[]
export type BedroomBucket = (typeof BEDROOM_BUCKETS)[number]["value"]

/** Bucket value a number falls in, or null when it is unknown / out of range. */
export function bucketFor(
  buckets: readonly RangeBucket[],
  n: number | null | undefined
): string | null {
  if (n == null || !Number.isFinite(n)) return null
  const hit = buckets.find((b) => n >= b.min && (b.max === null || n <= b.max))
  return hit?.value ?? null
}

/**
 * Parse a comma-separated URL parameter against an allowlist. Unknown values
 * are dropped, duplicates collapse, and the result keeps the allowlist order
 * so the same selection always serializes the same way.
 */
export function parseAllowedList<T extends string>(
  raw: string | undefined | null,
  allowed: readonly T[]
): T[] {
  if (!raw) return []
  const wanted = new Set(raw.split(",").map((v) => v.trim()))
  return allowed.filter((v) => wanted.has(v))
}

/**
 * PostgREST `or=` expression matching a numeric column against the selected
 * buckets, e.g. `pl_no_of_bedrooms.eq.2,and(pl_no_of_bedrooms.gte.0,pl_no_of_bedrooms.lte.1)`.
 * Returns null when nothing is selected (no filter).
 */
export function rangeOrFilter(
  column: string,
  buckets: readonly RangeBucket[],
  selected: readonly string[]
): string | null {
  const parts = buckets
    .filter((b) => selected.includes(b.value))
    .map((b) => {
      if (b.max === null) return `${column}.gte.${b.min}`
      if (b.min === b.max) return `${column}.eq.${b.min}`
      return `and(${column}.gte.${b.min},${column}.lte.${b.max})`
    })
  return parts.length ? parts.join(",") : null
}
