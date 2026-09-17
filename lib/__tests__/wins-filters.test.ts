import { describe, expect, it } from "vitest"

import {
  BEDROOM_BUCKETS,
  PORTFOLIO_SIZE_BUCKETS,
  bucketFor,
  parseAllowedList,
  rangeOrFilter,
} from "@/lib/wins-filters"

describe("bucketFor", () => {
  it("maps portfolio sizes to their bucket", () => {
    expect(bucketFor(PORTFOLIO_SIZE_BUCKETS, 1)).toBe("1")
    expect(bucketFor(PORTFOLIO_SIZE_BUCKETS, 3)).toBe("2-3")
    expect(bucketFor(PORTFOLIO_SIZE_BUCKETS, 9)).toBe("4-9")
    expect(bucketFor(PORTFOLIO_SIZE_BUCKETS, 40)).toBe("10+")
  })

  it("maps bedrooms, treating studios as the 0-1 bucket", () => {
    expect(bucketFor(BEDROOM_BUCKETS, 0)).toBe("0-1")
    expect(bucketFor(BEDROOM_BUCKETS, 1)).toBe("0-1")
    expect(bucketFor(BEDROOM_BUCKETS, 4)).toBe("4")
    expect(bucketFor(BEDROOM_BUCKETS, 9)).toBe("6+")
  })

  it("returns null for unknown or out-of-range values", () => {
    expect(bucketFor(BEDROOM_BUCKETS, null)).toBeNull()
    expect(bucketFor(PORTFOLIO_SIZE_BUCKETS, 0)).toBeNull()
    expect(bucketFor(PORTFOLIO_SIZE_BUCKETS, Number.NaN)).toBeNull()
  })
})

describe("parseAllowedList", () => {
  const allowed = ["high", "medium", "low"] as const

  it("keeps only allowed values, deduped, in allowlist order", () => {
    expect(parseAllowedList("low,high,low,bogus", allowed)).toEqual(["high", "low"])
  })

  it("returns an empty list for missing input", () => {
    expect(parseAllowedList(undefined, allowed)).toEqual([])
    expect(parseAllowedList("", allowed)).toEqual([])
  })
})

describe("rangeOrFilter", () => {
  it("builds eq / range / open-ended clauses", () => {
    expect(rangeOrFilter("beds", BEDROOM_BUCKETS, ["0-1", "3", "6+"])).toBe(
      "and(beds.gte.0,beds.lte.1),beds.eq.3,beds.gte.6"
    )
  })

  it("returns null when nothing is selected or nothing matches", () => {
    expect(rangeOrFilter("beds", BEDROOM_BUCKETS, [])).toBeNull()
    expect(rangeOrFilter("beds", BEDROOM_BUCKETS, ["nope"])).toBeNull()
  })
})
