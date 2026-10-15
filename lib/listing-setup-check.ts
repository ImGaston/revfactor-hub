// Daily PriceLabs check for the listing revenue setup: compares what we decided
// (listing_settings) with what PriceLabs holds now and says whether each
// setting is confirmed, drifted, or can't be judged. Pure; the server module
// fetches the data and writes the result. Design: docs/ontology/listing-revenue-setup.md.

import {
  PRICELABS_CHECKED_KEYS,
  type ListingSettingRow,
  type SettingStatus,
  type SettingValue,
} from "@/lib/listing-settings"

export type PriceLabsListingState = {
  min: number | null
  base: number | null
  max: number | null
  push_enabled: boolean | null
}

export type PriceLabsOverrideDay = {
  date: string
  min_price: number | null
  min_price_type?: string | null
  min_stay: number | null
}

export type CheckContext = {
  /** Fresh listing values from the PriceLabs API, or null if it wasn't returned. */
  listing: PriceLabsListingState | null
  /** Date overrides by YYYY-MM-DD, or null when they couldn't be read. */
  overrides: Map<string, PriceLabsOverrideDay> | null
  /** Today in YYYY-MM-DD (the listing's market day is close enough). */
  today: string
}

export type CheckVerdict =
  | { kind: "match"; detail: string }
  | { kind: "mismatch"; observed: SettingValue; detail: string }
  | { kind: "unknown"; detail: string }

const CHECKED = new Set<string>(PRICELABS_CHECKED_KEYS)

export function isPriceLabsChecked(setting: Pick<ListingSettingRow, "setting_key" | "channel">): boolean {
  return CHECKED.has(setting.setting_key) && setting.channel === "all"
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function* eachDate(from: string, to: string) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`

function shortDate(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

/** "Dec 19–Dec 21, Jan 5" from a sorted list of dates. */
export function summarizeDates(dates: string[]): string {
  const runs: [string, string][] = []
  for (const d of dates) {
    const last = runs[runs.length - 1]
    if (last && addDays(last[1], 1) === d) last[1] = d
    else runs.push([d, d])
  }
  const parts = runs.map(([a, b]) => (a === b ? shortDate(a) : `${shortDate(a)}–${shortDate(b)}`))
  return parts.length > 4 ? `${parts.slice(0, 4).join(", ")} +${parts.length - 4} more` : parts.join(", ")
}

/**
 * Days before a date when the PriceLabs record for that range expires on
 * purpose (a lead-time fallback on a min stay set for the same dates also
 * clears the date's min price). Missing overrides inside that window are fine.
 */
export function leadWindowDays(
  settings: Pick<ListingSettingRow, "setting_key" | "date_from" | "date_to" | "value">[],
  range: { date_from: string | null; date_to: string | null }
): number {
  let days = 0
  for (const s of settings) {
    if (s.date_from !== range.date_from || s.date_to !== range.date_to) continue
    const v = s.value as Record<string, unknown>
    if (typeof v?.fallback_after_days === "number") days = Math.max(days, v.fallback_after_days)
  }
  return days
}

function amountOf(value: SettingValue): number | null {
  const v = value as Record<string, unknown>
  return typeof v.amount === "number" ? v.amount : null
}

/** Compares one decided setting with PriceLabs. */
export function checkSetting(
  setting: Pick<ListingSettingRow, "setting_key" | "channel" | "date_from" | "date_to" | "value">,
  ctx: CheckContext,
  leadWindow = 0
): CheckVerdict {
  if (!isPriceLabsChecked(setting)) return { kind: "unknown", detail: "Not checked automatically" }
  const v = setting.value as Record<string, unknown>
  if (typeof v.text === "string") return { kind: "unknown", detail: "Stored as a note" }

  const key = setting.setting_key
  if (key === "price.min" || key === "price.base" || key === "price.max") {
    if (!ctx.listing) return { kind: "unknown", detail: "Listing not returned by PriceLabs" }
    const field = key.slice("price.".length) as "min" | "base" | "max"
    const seen = ctx.listing[field]
    const want = amountOf(setting.value)
    if (seen == null || want == null) return { kind: "unknown", detail: "No value to compare" }
    return seen === want
      ? { kind: "match", detail: `PriceLabs ${field} ${usd(seen)}` }
      : { kind: "mismatch", observed: { amount: seen }, detail: `PriceLabs ${field} is ${usd(seen)}, decided ${usd(want)}` }
  }

  if (key === "sync.pl_push") {
    if (!ctx.listing) return { kind: "unknown", detail: "Listing not returned by PriceLabs" }
    const seen = ctx.listing.push_enabled
    if (seen == null || typeof v.enabled !== "boolean") return { kind: "unknown", detail: "No value to compare" }
    return seen === v.enabled
      ? { kind: "match", detail: `PriceLabs sync ${seen ? "on" : "off"}` }
      : { kind: "mismatch", observed: { enabled: seen }, detail: `PriceLabs sync is ${seen ? "on" : "off"}` }
  }

  // Date-range settings, read from the PriceLabs date overrides.
  const from = setting.date_from
  const to = setting.date_to
  if (!from || !to) return { kind: "unknown", detail: "No dates on this setting" }
  if (to < ctx.today) return { kind: "unknown", detail: "Dates have passed" }
  if (!ctx.overrides) return { kind: "unknown", detail: "Couldn't read PriceLabs date overrides" }

  const isPrice = key === "price.seasonal_min"
  const want = isPrice ? amountOf(setting.value) : typeof v.nights === "number" ? v.nights : null
  if (want == null) return { kind: "unknown", detail: "No value to compare" }

  const start = from < ctx.today ? ctx.today : from
  const lastExpiringDay = addDays(ctx.today, leadWindow)
  const wrong: string[] = []
  const missing: string[] = []
  const seenValues = new Set<number>()
  let checkedDays = 0
  for (const d of eachDate(start, to)) {
    const o = ctx.overrides.get(d)
    const seen = o ? (isPrice ? (o.min_price_type && o.min_price_type !== "fixed" ? null : o.min_price) : o.min_stay) : null
    if (seen == null) {
      // Expected to have expired (lead-time fallback) — not drift.
      if (leadWindow > 0 && d <= lastExpiringDay) continue
      missing.push(d)
      checkedDays++
      continue
    }
    checkedDays++
    if (seen !== want) {
      wrong.push(d)
      seenValues.add(seen)
    }
  }
  if (checkedDays === 0) return { kind: "unknown", detail: "Inside the lead-time window" }

  const label = isPrice ? `min ${usd(want)}` : `${want}-night minimum`
  if (wrong.length === 0 && missing.length === 0) {
    return { kind: "match", detail: `PriceLabs has the ${label} on ${checkedDays} day${checkedDays === 1 ? "" : "s"}` }
  }
  const fmt = (n: number) => (isPrice ? usd(n) : `${n} nights`)
  const parts = [
    wrong.length ? `${summarizeDates(wrong)}: ${[...seenValues].map(fmt).join(" / ")}` : null,
    missing.length ? `${summarizeDates(missing)}: not set` : null,
  ].filter(Boolean)
  const detail = `Decided ${label}; PriceLabs ${parts.join("; ")}`
  return { kind: "mismatch", observed: { text: detail }, detail }
}

export type CheckTransition = { action: "VerifySetting" | "FlagDrift"; status: SettingStatus } | null

/**
 * What the check records. Planned and retired settings are left alone, a
 * setting already in drift isn't flagged again, and a confirmed value that
 * was already verified adds no row (no daily noise).
 */
export function nextTransition(status: SettingStatus, verdict: CheckVerdict): CheckTransition {
  if (verdict.kind === "unknown") return null
  if (verdict.kind === "match") {
    return status === "applied" || status === "drift" ? { action: "VerifySetting", status: "verified" } : null
  }
  return status === "applied" || status === "verified" ? { action: "FlagDrift", status: "drift" } : null
}
