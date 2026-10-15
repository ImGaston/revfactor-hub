import { describe, expect, it } from "vitest"

import { validateClientProfile } from "@/lib/client-profile"
import { parseClientTab } from "@/lib/client-tabs"

describe("parseClientTab", () => {
  it("defaults to legacy and accepts known tabs only", () => {
    expect(parseClientTab(undefined)).toBe("legacy")
    expect(parseClientTab("journey")).toBe("journey")
    expect(parseClientTab("onboarding")).toBe("onboarding")
    expect(parseClientTab(["tickets", "profile"])).toBe("tickets")
    expect(parseClientTab("financials")).toBe("legacy")
  })
})

describe("validateClientProfile", () => {
  it("trims, nulls empty fields and keeps known keys only", () => {
    const result = validateClientProfile({
      experience_level: "some",
      goals: "  Higher ADR in summer  ",
      background: "   ",
      extra: "ignored",
    })
    expect(result).toEqual({
      values: expect.objectContaining({ experience_level: "some", goals: "Higher ADR in summer", background: null }),
    })
    expect("values" in result && "extra" in result.values).toBe(false)
  })

  it("rejects unknown experience levels, oversize text and credentials", () => {
    expect(validateClientProfile({ experience_level: "guru" })).toEqual({ error: "Pick an experience level" })
    expect(validateClientProfile({ goals: "x".repeat(2001) })).toHaveProperty("error")
    expect(validateClientProfile({ communication: "PriceLabs password: hunter2hunter2" })).toHaveProperty("error")
  })
})
