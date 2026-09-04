import { describe, expect, it } from "vitest"
import { collectUniversityOfficialPage, normalizeUniversityPageDates, parseUniversityOfficialPage } from "@/lib/market-signals/university-pages"

describe("university official page extraction", () => {
  it("extracts graduation and family weekend dates without fetching or writing", () => {
    const rows = parseUniversityOfficialPage({
      institution: "Example University",
      sourceUrl: "https://example.edu/calendar",
      html: `<h1>Commencement</h1><p>May 17, 2027</p><h2>Family Weekend</h2><p>October 8-10, 2027</p>`,
    })
    expect(rows.map((row) => row.eventType)).toEqual(["graduation", "family_weekend"])
    expect(rows.every((row) => row.sourceUrl.startsWith("https://"))).toBe(true)
  })

  it("deduplicates repeated page dates and ignores unrelated dates", () => {
    const rows = parseUniversityOfficialPage({
      institution: "Example University",
      sourceUrl: "https://example.edu/registrar",
      html: `<p>Academic calendar: August 20, 2027</p><p>Academic calendar: August 20, 2027</p><p>Classes begin January 10, 2027</p>`,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].eventType).toBe("academic_calendar")
  })

  it("collects through an injected fetcher without persisting anything", async () => {
    const rows = await collectUniversityOfficialPage({
      institution: "Example University",
      sourceUrl: "https://example.edu/commencement",
      fetcher: async () => new Response("<p>Commencement May 17, 2027</p>"),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].eventType).toBe("graduation")
  })

  it("emits the existing normalized provider contract", () => {
    const rows = parseUniversityOfficialPage({ institution: "Example University", sourceUrl: "https://example.edu/calendar", html: "<p>Commencement May 17, 2027</p>" })
    const events = normalizeUniversityPageDates({ rows, city: "Storrs", region: "CT" })
    expect(events[0]).toMatchObject({ sourceType: "official_feed", category: "graduation", city: "Storrs", countryCode: "US" })
    expect(events[0].startDate).toContain("2027-05-17")
  })
})
