import { describe, expect, it } from "vitest"

import {
  LISTING_CHECKS,
  checkCoverage,
  gradeSections,
  passedChecks,
  scoreChecks,
  type CheckResult,
} from "@/lib/listing-optimization-checks"
import { OPTIMIZATION_SECTIONS } from "@/lib/listing-optimization"

const all = (status: CheckResult["status"]): CheckResult[] =>
  LISTING_CHECKS.map((c) => ({ id: c.id, status }))

describe("checklist catalog", () => {
  it("has unique ids and only known sections", () => {
    const ids = LISTING_CHECKS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const sections = new Set<string>(OPTIMIZATION_SECTIONS.map((s) => s.key))
    for (const c of LISTING_CHECKS) expect(sections.has(c.section)).toBe(true)
  })
})

describe("scoreChecks", () => {
  it("scores 100 when everything passes and 0 when everything fails", () => {
    expect(scoreChecks(all("pass")).overall).toBe(100)
    expect(scoreChecks(all("fail")).overall).toBe(0)
  })

  it("gives half credit for thin and ignores n/a", () => {
    expect(scoreChecks(all("thin")).overall).toBe(50)
    const r = all("pass").map((c) => (c.id.startsWith("arrival.") ? { ...c, status: "na" as const } : c))
    expect(scoreChecks(r).overall).toBe(100)
  })

  it("returns null when nothing applicable was checked", () => {
    expect(scoreChecks(all("not_checked")).overall).toBeNull()
  })
})

describe("coverage and grades", () => {
  it("is partial when host checks were not run", () => {
    const r = LISTING_CHECKS.map((c) => ({
      id: c.id,
      status: (c.source === "host" ? "not_checked" : "pass") as CheckResult["status"],
    }))
    const cov = checkCoverage(r)
    expect(cov.complete).toBe(false)
    expect(cov.notChecked.length).toBe(LISTING_CHECKS.filter((c) => c.source === "host").length)
  })

  it("is complete when every check has a real status (n/a counts)", () => {
    expect(checkCoverage(all("na")).complete).toBe(true)
    expect(checkCoverage([]).missing.length).toBe(LISTING_CHECKS.length)
  })

  it("grades sections and lists passed checks", () => {
    const r = all("pass").map((c) => (c.id === "location.neighborhood" ? { ...c, status: "fail" as const } : c))
    expect(gradeSections(r).title).toBe("A")
    expect(gradeSections(r).location).not.toBe("A")
    expect(passedChecks(r, "location").map((c) => c.id)).not.toContain("location.neighborhood")
  })
})
