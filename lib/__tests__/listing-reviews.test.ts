import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  ListingReviewFinalSchema,
  emptyListingReviewDraft,
  validateListingReviewFile,
} from "@/lib/listing-reviews"

describe("listing review intake", () => {
  it("renders exactly the selected number of property drafts", () => {
    expect(emptyListingReviewDraft(3).properties).toHaveLength(3)
    expect(emptyListingReviewDraft(8).properties).toHaveLength(3)
    expect(emptyListingReviewDraft(0).properties).toHaveLength(1)
  })

  it("accepts a complete gross-revenue property definition", () => {
    const draft = emptyListingReviewDraft(1)
    draft.properties[0] = {
      ...draft.properties[0],
      propertyName: "Example House",
      addressStatus: "confirmed",
      address: "100 Example Street, Austin, TX 78701",
      actualRevenue: "82500.25",
      actualBasis: "gross",
      revenueIncludes: ["accommodation", "cleaning_fees"],
      actualPeriodKind: "trailing_12_months",
      targetRevenue: "110000",
      targetPeriodKind: "calendar_year",
      targetPeriodYear: "2027",
    }

    expect(ListingReviewFinalSchema.safeParse(draft).success).toBe(true)
  })

  it("rejects incomplete revenue, address, and period evidence", () => {
    const result = ListingReviewFinalSchema.safeParse(
      emptyListingReviewDraft(1)
    )
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining([
        "properties.0.propertyName",
        "properties.0.address",
        "properties.0.addressStatus",
        "properties.0.actualRevenue",
        "properties.0.targetRevenue",
        "properties.0.targetPeriodKind",
      ])
    )
  })

  it("allows only bounded PDF, CSV, and XLSX evidence", () => {
    expect(
      validateListingReviewFile({
        name: "statement.pdf",
        size: 1_024,
        type: "application/pdf",
      })
    ).toBeNull()
    expect(
      validateListingReviewFile({
        name: "revenue.exe",
        size: 1_024,
        type: "application/octet-stream",
      })
    ).toMatch(/PDF/)
    expect(
      validateListingReviewFile({
        name: "large.csv",
        size: 21 * 1024 * 1024,
        type: "text/csv",
      })
    ).toMatch(/20 MB/)
  })

  it("keeps financial objects private and submission idempotent", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/090_listing_review_intake.sql"
      ),
      "utf8"
    )

    expect(migration).toMatch(
      /'listing-review-financials',\s*'listing-review-financials',\s*false/
    )
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]{0,120}storage\.objects/i)
    expect(migration).not.toMatch(/FOR DELETE TO authenticated/i)
    expect(migration).toContain("auth.role() <> 'service_role'")
    expect(
      migration.match(
        /ON CONFLICT \(request_id, event_type, recipient_email_normalized\)/g
      )
    ).toHaveLength(2)
    expect(migration).toContain("financial file required for property")
  })
})
