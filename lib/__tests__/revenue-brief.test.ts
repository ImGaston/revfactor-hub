import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { describe, expect, it } from "vitest"

import { renderRevenueBriefPdf } from "@/lib/revenue-brief/pdf"
import {
  RevenueBriefSchema,
  SYNTHETIC_REVENUE_BRIEF,
  revenueBriefFilename,
} from "@/lib/revenue-brief/schema"

describe("revenue brief builder", () => {
  it("accepts the complete synthetic example", () => {
    expect(RevenueBriefSchema.safeParse(SYNTHETIC_REVENUE_BRIEF).success).toBe(true)
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
})
