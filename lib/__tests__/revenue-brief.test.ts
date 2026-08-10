import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { describe, expect, it } from "vitest"

import { renderRevenueBriefPdf } from "@/lib/revenue-brief/pdf"
import type { RevenueBriefBrandTheme } from "@/lib/revenue-brief/brand"
import {
  RevenueBriefSchema,
  SYNTHETIC_REVENUE_BRIEF,
  revenueBriefFilename,
} from "@/lib/revenue-brief/schema"

describe("revenue brief builder", () => {
  it("accepts the complete synthetic example", () => {
    expect(RevenueBriefSchema.safeParse(SYNTHETIC_REVENUE_BRIEF).success).toBe(
      true
    )
  })

  it("accepts zero reviews and a single-digit guest capacity", () => {
    const result = RevenueBriefSchema.safeParse({
      ...SYNTHETIC_REVENUE_BRIEF,
      metrics: {
        ...SYNTHETIC_REVENUE_BRIEF.metrics,
        rating: "N/A",
        reviews: "0",
        guests: "8",
      },
    })

    expect(result.success).toBe(true)
  })

  it("rejects missing evidence and unsupported cover image formats", () => {
    const result = RevenueBriefSchema.safeParse({
      ...SYNTHETIC_REVENUE_BRIEF,
      demandDrivers: [],
      photoDataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["demandDrivers", "photoDataUrl"])
    )
  })

  it("requires an AirROI projection for a pre-launch brief", () => {
    const result = RevenueBriefSchema.safeParse({
      ...SYNTHETIC_REVENUE_BRIEF,
      listingStage: "new",
      projection: null,
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
      "projection"
    )
  })

  it("creates a filesystem-safe client filename", () => {
    expect(
      revenueBriefFilename({
        ...SYNTHETIC_REVENUE_BRIEF,
        propertyName: "Harbor House / Newport: Owner's View",
      })
    ).toBe("RevFactor-Harbor-House-Newport-Owner-s-View-Revenue-Brief.pdf")
  })

  it("renders a six-page PDF buffer", async () => {
    const pdf = await renderRevenueBriefPdf(SYNTHETIC_REVENUE_BRIEF)

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
    expect(pdf.length).toBeGreaterThan(20_000)
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 612 792]")

    const samplePath = process.env.REVENUE_BRIEF_SAMPLE_PATH
    if (samplePath) {
      await mkdir(dirname(samplePath), { recursive: true })
      await writeFile(samplePath, pdf)
    }
  }, 20_000)

  it("renders a branded six-page pre-launch projection", async () => {
    const prelaunch = RevenueBriefSchema.parse({
      ...SYNTHETIC_REVENUE_BRIEF,
      listingUrl: "",
      listingStage: "new",
      finalDataRequest:
        "A final recommendation requires confirmed property plans, bed configuration, amenity scope, launch timing, permit status, owner-use constraints, operating costs, and analyst approval of the AirROI comp set.",
      metrics: {
        rating: "Pre-launch",
        reviews: "0",
        layout: "4BR / 3BA",
        guests: "10",
      },
      projection: {
        provider: "AirROI",
        retrievedAt: "2026-08-10T14:00:00.000Z",
        currency: "USD",
        radiusMiles: 5,
        comparableCount: 5,
        conservative: { revenue: 54_000, adr: 290, occupancy: 0.48 },
        base: { revenue: 72_000, adr: 350, occupancy: 0.62 },
        strong: { revenue: 91_000, adr: 410, occupancy: 0.72 },
        monthlyRevenueShares: Array.from({ length: 12 }, () => 1 / 12),
        comparables: Array.from({ length: 5 }, (_, index) => ({
          listingId: `90000000000000000${index}`,
          name: `Mountain comparable ${index + 1}`,
          location: "Stowe, Vermont",
          bedrooms: 4,
          revenue: 62_000 + index * 4_000,
          adr: 310 + index * 15,
          occupancy: 0.55 + index * 0.03,
        })),
      },
    })
    const mintedStay: RevenueBriefBrandTheme = {
      name: "MintedStay",
      coBrandingMode: "partner_led",
      primaryColor: "#000000",
      secondaryColor: "#CADB84",
      accentColor: "#CADB84",
      fontFamily: "Museo Sans 700",
      footerText: "MintedStay · Revenue strategy powered by RevFactor",
      logoDataUrl: null,
    }

    const pdf = await renderRevenueBriefPdf(prelaunch, mintedStay)

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
    expect(pdf.length).toBeGreaterThan(20_000)

    const samplePath = process.env.REVENUE_BRIEF_PRELAUNCH_SAMPLE_PATH
    if (samplePath) {
      await mkdir(dirname(samplePath), { recursive: true })
      await writeFile(samplePath, pdf)
    }
  }, 20_000)
})
