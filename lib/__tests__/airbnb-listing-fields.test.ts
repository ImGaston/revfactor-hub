import { describe, expect, it } from "vitest"

import { AIRBNB_LISTING_FIELDS } from "@/lib/airbnb-listing-fields"
import { LISTING_CHECKS, getCheck } from "@/lib/listing-optimization-checks"

describe("Airbnb listing field map", () => {
  it("audits or explicitly records every editable field", () => {
    const unmapped = AIRBNB_LISTING_FIELDS.filter(
      (f) => !(f.checks && f.checks.length > 0) && !f.recordOnly
    ).map((f) => `${f.card} / ${f.field}`)
    expect(unmapped).toEqual([])
  })

  it("only references checks that exist", () => {
    const unknown = AIRBNB_LISTING_FIELDS.flatMap((f) => f.checks ?? []).filter((id) => !getCheck(id))
    expect(unknown).toEqual([])
  })

  it("ties every standard check to at least one real field", () => {
    const used = new Set(AIRBNB_LISTING_FIELDS.flatMap((f) => f.checks ?? []))
    const orphan = LISTING_CHECKS.map((c) => c.id).filter((id) => !used.has(id))
    expect(orphan).toEqual([])
  })

  it("has no duplicate card/field rows", () => {
    const keys = AIRBNB_LISTING_FIELDS.map((f) => `${f.card}::${f.field}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
