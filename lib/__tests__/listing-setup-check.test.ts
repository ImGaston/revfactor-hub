import { describe, expect, it } from "vitest"

import {
  addDays,
  checkSetting,
  leadWindowDays,
  nextTransition,
  summarizeDates,
  type CheckContext,
  type PriceLabsOverrideDay,
} from "@/lib/listing-setup-check"
import { sameSettingValue, validateSettingValue, type SettingValue } from "@/lib/listing-settings"

const today = "2026-10-15"

function overrides(from: string, to: string, day: Omit<PriceLabsOverrideDay, "date">) {
  const map = new Map<string, PriceLabsOverrideDay>()
  for (let d = from; d <= to; d = addDays(d, 1)) map.set(d, { date: d, ...day })
  return map
}

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  listing: { min: 274, base: 325, max: 950, push_enabled: true },
  overrides: new Map(),
  today,
  ...over,
})

const listingSetting = (key: string, value: SettingValue) => ({
  setting_key: key,
  channel: "all" as const,
  date_from: null,
  date_to: null,
  value,
})

describe("checkSetting: listing-level", () => {
  it("matches PriceLabs min/base/max", () => {
    expect(checkSetting(listingSetting("price.min", { amount: 274 }), ctx()).kind).toBe("match")
    expect(checkSetting(listingSetting("price.max", { amount: 950 }), ctx()).kind).toBe("match")
  })

  it("flags a changed base price with the observed amount", () => {
    const v = checkSetting(listingSetting("price.base", { amount: 300 }), ctx())
    expect(v).toMatchObject({ kind: "mismatch", observed: { amount: 325 } })
  })

  it("compares sync on/off", () => {
    const v = checkSetting(listingSetting("sync.pl_push", { enabled: true }), ctx({ listing: { min: 1, base: 1, max: 1, push_enabled: false } }))
    expect(v).toMatchObject({ kind: "mismatch", observed: { enabled: false } })
  })

  it("can't judge when PriceLabs didn't return the listing, notes, or other channels", () => {
    expect(checkSetting(listingSetting("price.min", { amount: 274 }), ctx({ listing: null })).kind).toBe("unknown")
    expect(checkSetting(listingSetting("price.min", { text: "about $274" }), ctx()).kind).toBe("unknown")
    expect(checkSetting({ ...listingSetting("price.min", { amount: 274 }), channel: "airbnb" }, ctx()).kind).toBe("unknown")
    expect(checkSetting(listingSetting("fee.cleaning", { amount: 150 }), ctx()).kind).toBe("unknown")
  })
})

describe("checkSetting: date ranges", () => {
  const range = (key: string, from: string, to: string, value: SettingValue) => ({
    setting_key: key,
    channel: "all" as const,
    date_from: from,
    date_to: to,
    value,
  })

  it("matches a seasonal minimum set on every day", () => {
    const o = overrides("2026-12-19", "2027-01-03", { min_price: 450, min_price_type: "fixed", min_stay: 5 })
    const v = checkSetting(range("price.seasonal_min", "2026-12-19", "2027-01-03", { amount: 450 }), ctx({ overrides: o }))
    expect(v).toMatchObject({ kind: "match" })
  })

  it("names the days that differ or are missing", () => {
    const o = overrides("2026-12-19", "2026-12-25", { min_price: 450, min_price_type: "fixed", min_stay: 5 })
    o.set("2026-12-20", { date: "2026-12-20", min_price: 400, min_price_type: "fixed", min_stay: 5 })
    o.delete("2026-12-24")
    o.delete("2026-12-25")
    const v = checkSetting(range("price.seasonal_min", "2026-12-19", "2026-12-25", { amount: 450 }), ctx({ overrides: o }))
    expect(v.kind).toBe("mismatch")
    expect(v.detail).toContain("Dec 20: $400")
    expect(v.detail).toContain("Dec 24–Dec 25: not set")
  })

  it("ignores percent-type minimums for a fixed-dollar decision", () => {
    const o = overrides("2026-12-19", "2026-12-19", { min_price: 10, min_price_type: "percent_base", min_stay: null })
    const v = checkSetting(range("price.seasonal_min", "2026-12-19", "2026-12-19", { amount: 450 }), ctx({ overrides: o }))
    expect(v.kind).toBe("mismatch")
    expect(v.detail).toContain("not set")
  })

  it("compares minimum stays", () => {
    const o = overrides("2026-12-26", "2027-01-03", { min_price: 450, min_stay: 6 })
    expect(checkSetting(range("stay.min_stay", "2026-12-26", "2027-01-03", { nights: 6 }), ctx({ overrides: o })).kind).toBe("match")
    expect(checkSetting(range("stay.min_stay", "2026-12-26", "2027-01-03", { nights: 5 }), ctx({ overrides: o })).kind).toBe("mismatch")
  })

  it("skips days inside the lead-time fallback window", () => {
    // Record expires 45 days out: Oct 20 – Nov 29 may be gone, Nov 30 on must be there.
    const o = overrides("2026-11-30", "2026-12-10", { min_price: 300, min_stay: 4 })
    const s = range("stay.min_stay", "2026-10-20", "2026-12-10", { nights: 4, fallback_after_days: 45 })
    const win = leadWindowDays([s], s)
    expect(win).toBe(45)
    expect(checkSetting(s, ctx({ overrides: o }), win).kind).toBe("match")
    // The seasonal min on the same dates shares that window.
    const p = range("price.seasonal_min", "2026-10-20", "2026-12-10", { amount: 300 })
    expect(leadWindowDays([s, p], p)).toBe(45)
    expect(checkSetting(p, ctx({ overrides: o }), 45).kind).toBe("match")
    // Without the window the expired days count as missing.
    expect(checkSetting(p, ctx({ overrides: o }), 0).kind).toBe("mismatch")
  })

  it("can't judge past ranges, fully expired ranges, or missing overrides", () => {
    expect(checkSetting(range("stay.min_stay", "2026-01-01", "2026-01-05", { nights: 4 }), ctx()).kind).toBe("unknown")
    expect(checkSetting(range("stay.min_stay", "2026-10-20", "2026-10-30", { nights: 4 }), ctx(), 45).kind).toBe("unknown")
    expect(checkSetting(range("stay.min_stay", "2026-12-01", "2026-12-05", { nights: 4 }), ctx({ overrides: null })).kind).toBe("unknown")
  })
})

describe("nextTransition", () => {
  const match = { kind: "match", detail: "" } as const
  const miss = { kind: "mismatch", observed: { amount: 1 }, detail: "" } as const
  const unknown = { kind: "unknown", detail: "" } as const

  it("verifies applied settings and clears drift when PriceLabs agrees", () => {
    expect(nextTransition("applied", match)).toEqual({ action: "VerifySetting", status: "verified" })
    expect(nextTransition("drift", match)).toEqual({ action: "VerifySetting", status: "verified" })
    expect(nextTransition("verified", match)).toBeNull()
  })

  it("flags drift once and leaves planned/retired alone", () => {
    expect(nextTransition("verified", miss)).toEqual({ action: "FlagDrift", status: "drift" })
    expect(nextTransition("applied", miss)).toEqual({ action: "FlagDrift", status: "drift" })
    expect(nextTransition("drift", miss)).toBeNull()
    expect(nextTransition("planned", miss)).toBeNull()
    expect(nextTransition("retired", match)).toBeNull()
    expect(nextTransition("applied", unknown)).toBeNull()
  })
})

describe("summarizeDates", () => {
  it("collapses runs and caps the list", () => {
    expect(summarizeDates(["2026-12-19", "2026-12-20", "2026-12-21", "2027-01-05"])).toBe("Dec 19–Dec 21, Jan 5")
    const many = ["2026-12-01", "2026-12-03", "2026-12-05", "2026-12-07", "2026-12-09", "2026-12-11"]
    expect(summarizeDates(many)).toBe("Dec 1, Dec 3, Dec 5, Dec 7 +2 more")
  })
})

describe("validateSettingValue", () => {
  it("accepts each shape and cleans it", () => {
    expect(validateSettingValue("price.min", { amount: 274, junk: 1 })).toEqual({ ok: true, value: { amount: 274 } })
    expect(validateSettingValue("fee.cleaning", { amount: 150, per: "stay" })).toEqual({ ok: true, value: { amount: 150, per: "stay" } })
    expect(validateSettingValue("markup.channel", { percent: 44 })).toEqual({ ok: true, value: { percent: 44 } })
    expect(validateSettingValue("stay.min_stay", { nights: 4, fallback_after_days: 45 })).toEqual({
      ok: true,
      value: { nights: 4, fallback_after_days: 45 },
    })
    expect(validateSettingValue("sync.pl_push", { enabled: true, note: " " })).toEqual({ ok: true, value: { enabled: true } })
    expect(
      validateSettingValue("stay.checkin_checkout_default", {
        checkin: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
        checkout: ["fri", "mon"],
      })
    ).toEqual({ ok: true, value: { checkin: "all", checkout: ["mon", "fri"] } })
    expect(validateSettingValue("discount.trip_length", { tiers: [{ label: "3+ nights", percent: 21 }] })).toEqual({
      ok: true,
      value: { tiers: [{ label: "3+ nights", percent: 21 }] },
    })
  })

  it("lets any key hold a note", () => {
    expect(validateSettingValue("price.min", { text: "  see PriceLabs  " })).toEqual({ ok: true, value: { text: "see PriceLabs" } })
  })

  it("rejects bad input", () => {
    expect(validateSettingValue("price.min", { amount: -1 }).ok).toBe(false)
    expect(validateSettingValue("price.min", { amount: "274" }).ok).toBe(false)
    expect(validateSettingValue("stay.min_stay", { nights: 2.5 }).ok).toBe(false)
    expect(validateSettingValue("stay.checkin_checkout_default", { checkin: [], checkout: "all" }).ok).toBe(false)
    expect(validateSettingValue("discount.trip_length", { tiers: [{ label: "", percent: 5 }] }).ok).toBe(false)
    expect(validateSettingValue("price.min", null).ok).toBe(false)
    expect(validateSettingValue("price.min", { text: "  " }).ok).toBe(false)
  })
})

describe("sameSettingValue", () => {
  it("ignores key order", () => {
    expect(sameSettingValue({ per: "stay", amount: 150 }, { amount: 150, per: "stay" })).toBe(true)
    expect(sameSettingValue({ amount: 150 }, { amount: 151 })).toBe(false)
  })
})
