// Listing revenue setup: the catalog of decision types (setting keys) and the
// shapes stored in listing_settings / listing_setting_changes. Design:
// docs/ontology/listing-revenue-setup.md. Client-safe (no server imports).

export const SETTING_CATALOG_VERSION = "2026-10-15.2"

export type SettingChannel = "all" | "airbnb" | "booking" | "vrbo" | "direct" | "expedia"

export type SettingStatus = "planned" | "applied" | "verified" | "drift" | "retired"

export type SettingChangeAction =
  | "ProposeSettingChange"
  | "ApproveSettingChange"
  | "ApplySetting"
  | "VerifySetting"
  | "FlagDrift"
  | "RevertSetting"
  | "RecordObservation"

export type SettingGroup =
  | "pricing"
  | "stay"
  | "fees"
  | "markups"
  | "discounts"
  | "promotions"
  | "availability"
  | "sync"
  | "policy"

/**
 * Values are small JSON objects. Each key uses one shape; formatSettingValue
 * renders any of them, so an unknown key still displays.
 */
export type SettingValue =
  | { amount: number; currency?: "USD"; per?: "stay" | "night" | "guest" }
  | { percent: number }
  | { nights: number; fallback_after_days?: number }
  | { tiers: { label: string; percent: number }[] }
  | { enabled: boolean; note?: string }
  | { days: string[] | "all"; checkin?: string[] | "all"; checkout?: string[] | "all" }
  | { text: string }
  | Record<string, unknown>

export type SettingKeyDef = {
  key: string
  group: SettingGroup
  label: string
  /** Where the value lives (system of record) by default. */
  system: string
  scope: "listing" | "channel" | "date_range"
  /** How we confirm the value is still true on the channels. */
  observedBy: string
}

export const SETTING_GROUPS: { id: SettingGroup; label: string }[] = [
  { id: "sync", label: "Pricing tool and sync" },
  { id: "pricing", label: "Prices" },
  { id: "stay", label: "Stay rules" },
  { id: "fees", label: "Fees" },
  { id: "markups", label: "Channel markups" },
  { id: "discounts", label: "Discounts" },
  { id: "promotions", label: "Promotions" },
  { id: "availability", label: "Availability" },
  { id: "policy", label: "Policies and taxes" },
]

export const SETTING_KEYS: SettingKeyDef[] = [
  // Sync / tools
  { key: "sync.pricing_tool", group: "sync", label: "Pricing tool", system: "pricelabs", scope: "listing", observedBy: "PriceLabs API + PMS" },
  { key: "sync.pms_optimizer", group: "sync", label: "PMS price optimizer", system: "guesty", scope: "listing", observedBy: "PMS" },
  { key: "sync.pl_push", group: "sync", label: "PriceLabs sync (push)", system: "pricelabs", scope: "listing", observedBy: "PriceLabs API" },
  { key: "sync.pms_token", group: "sync", label: "PMS connection token", system: "pricelabs", scope: "listing", observedBy: "PriceLabs refresh" },
  // Prices
  { key: "price.min", group: "pricing", label: "Minimum price", system: "pricelabs", scope: "listing", observedBy: "PriceLabs API" },
  { key: "price.base", group: "pricing", label: "Base price", system: "pricelabs", scope: "listing", observedBy: "PriceLabs API" },
  { key: "price.max", group: "pricing", label: "Maximum price", system: "pricelabs", scope: "listing", observedBy: "PriceLabs API" },
  { key: "price.seasonal_min", group: "pricing", label: "Seasonal minimum", system: "pricelabs", scope: "date_range", observedBy: "PriceLabs API" },
  { key: "price.gap_premium", group: "pricing", label: "Gap-night premium", system: "pricelabs", scope: "listing", observedBy: "PriceLabs dashboard" },
  // Stay rules
  { key: "stay.min_stay_profile", group: "stay", label: "Minimum stay (default)", system: "pricelabs", scope: "listing", observedBy: "PMS calendar" },
  { key: "stay.gap_rule", group: "stay", label: "Gap stays", system: "pricelabs", scope: "listing", observedBy: "PMS calendar" },
  { key: "stay.min_stay", group: "stay", label: "Minimum stay (dates)", system: "pricelabs", scope: "date_range", observedBy: "PMS calendar" },
  { key: "stay.checkin_checkout_default", group: "stay", label: "Check-in/out days (default)", system: "pricelabs", scope: "listing", observedBy: "PriceLabs dashboard" },
  { key: "stay.checkin_checkout", group: "stay", label: "Check-in/out (dates)", system: "pricelabs", scope: "date_range", observedBy: "Channel guest quote" },
  // Fees
  { key: "fee.cleaning", group: "fees", label: "Cleaning fee", system: "guesty", scope: "channel", observedBy: "Channel guest quote" },
  { key: "fee.extra_guest", group: "fees", label: "Extra guest fee", system: "guesty", scope: "channel", observedBy: "PMS" },
  // Markups
  { key: "markup.channel", group: "markups", label: "Markup", system: "guesty", scope: "channel", observedBy: "Channel price ÷ PriceLabs price" },
  // Discounts
  { key: "discount.trip_length", group: "discounts", label: "Trip-length discounts", system: "airbnb", scope: "channel", observedBy: "Airbnb discounts panel" },
  { key: "discount.weekly", group: "discounts", label: "Weekly discount", system: "airbnb", scope: "channel", observedBy: "Channel discounts panel" },
  { key: "discount.monthly", group: "discounts", label: "Monthly discount", system: "airbnb", scope: "channel", observedBy: "Channel discounts panel" },
  { key: "discount.last_minute", group: "discounts", label: "Last-minute discount", system: "airbnb", scope: "channel", observedBy: "Channel discounts panel" },
  { key: "discount.early_bird", group: "discounts", label: "Early-bird discount", system: "airbnb", scope: "channel", observedBy: "Channel discounts panel" },
  { key: "discount.pms_weekly_monthly", group: "discounts", label: "PMS weekly/monthly", system: "guesty", scope: "listing", observedBy: "PMS" },
  // Promotions
  { key: "promotion.pms", group: "promotions", label: "PMS promotion", system: "guesty", scope: "channel", observedBy: "PMS promotions list" },
  // Availability
  { key: "availability.booking_window", group: "availability", label: "Booking window", system: "guesty", scope: "listing", observedBy: "PMS availability settings" },
  // Policies and taxes
  { key: "policy.cancellation", group: "policy", label: "Cancellation policy", system: "guesty", scope: "channel", observedBy: "PMS reservation policies" },
  { key: "tax.collection", group: "policy", label: "Tax collection", system: "guesty", scope: "channel", observedBy: "Reservation invoice" },
]

const KEY_INDEX = new Map(SETTING_KEYS.map((k) => [k.key, k]))

export type SettingValueKind =
  | "amount"
  | "percent"
  | "nights"
  | "tiers"
  | "enabled"
  | "checkin_checkout"
  | "text"

/** The value shape each key is entered in. Any key can also hold a plain note ({ text }). */
export const SETTING_VALUE_KINDS: Record<string, SettingValueKind> = {
  "sync.pricing_tool": "text",
  "sync.pms_optimizer": "enabled",
  "sync.pl_push": "enabled",
  "sync.pms_token": "text",
  "price.min": "amount",
  "price.base": "amount",
  "price.max": "amount",
  "price.seasonal_min": "amount",
  "price.gap_premium": "percent",
  "stay.min_stay_profile": "nights",
  "stay.gap_rule": "text",
  "stay.min_stay": "nights",
  "stay.checkin_checkout_default": "checkin_checkout",
  "stay.checkin_checkout": "text",
  "fee.cleaning": "amount",
  "fee.extra_guest": "amount",
  "markup.channel": "percent",
  "discount.trip_length": "tiers",
  "discount.weekly": "percent",
  "discount.monthly": "percent",
  "discount.last_minute": "percent",
  "discount.early_bird": "percent",
  "discount.pms_weekly_monthly": "text",
  "promotion.pms": "text",
  "availability.booking_window": "text",
  "policy.cancellation": "text",
  "tax.collection": "text",
}

export function settingValueKind(key: string): SettingValueKind {
  return SETTING_VALUE_KINDS[baseSettingKey(key)] ?? "text"
}

/**
 * Keys the daily PriceLabs check can confirm on its own. Everything else is
 * verified by a person (channel quotes, PMS screens, dashboard-only settings).
 */
export const PRICELABS_CHECKED_KEYS = [
  "price.min",
  "price.base",
  "price.max",
  "sync.pl_push",
  "price.seasonal_min",
  "stay.min_stay",
] as const

export const SETTING_CHANNELS: SettingChannel[] = ["all", "airbnb", "booking", "vrbo", "direct", "expedia"]

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
export const WEEKDAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
}

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v)

/**
 * Checks a value against the key's shape (or a plain note) and returns it
 * cleaned, or an error message. Server actions call this; never trust the form.
 */
export function validateSettingValue(
  key: string,
  value: unknown
): { ok: true; value: SettingValue } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Enter a value." }
  }
  const v = value as Record<string, unknown>
  if ("text" in v) {
    const text = typeof v.text === "string" ? v.text.trim() : ""
    return text ? { ok: true, value: { text: text.slice(0, 500) } } : { ok: false, error: "Enter a note." }
  }
  switch (settingValueKind(key)) {
    case "amount": {
      if (!finite(v.amount) || (v.amount as number) < 0) return { ok: false, error: "Enter an amount of 0 or more." }
      const per = v.per === "stay" || v.per === "night" || v.per === "guest" ? v.per : undefined
      return { ok: true, value: per ? { amount: v.amount as number, per } : { amount: v.amount as number } }
    }
    case "percent": {
      if (!finite(v.percent) || (v.percent as number) < -100 || (v.percent as number) > 500) {
        return { ok: false, error: "Enter a percent between -100 and 500." }
      }
      return { ok: true, value: { percent: v.percent as number } }
    }
    case "nights": {
      if (!Number.isInteger(v.nights) || (v.nights as number) < 1 || (v.nights as number) > 365) {
        return { ok: false, error: "Enter whole nights between 1 and 365." }
      }
      if (v.fallback_after_days != null) {
        if (!Number.isInteger(v.fallback_after_days) || (v.fallback_after_days as number) < 1) {
          return { ok: false, error: "Lead-time fallback must be whole days." }
        }
        return { ok: true, value: { nights: v.nights as number, fallback_after_days: v.fallback_after_days as number } }
      }
      return { ok: true, value: { nights: v.nights as number } }
    }
    case "tiers": {
      const tiers = Array.isArray(v.tiers) ? v.tiers : []
      const clean = tiers
        .map((t) => t as Record<string, unknown>)
        .filter((t) => typeof t.label === "string" && t.label.trim() && finite(t.percent))
        .map((t) => ({ label: (t.label as string).trim().slice(0, 60), percent: t.percent as number }))
      if (clean.length === 0 || clean.length !== tiers.length) {
        return { ok: false, error: "Each tier needs a label and a percent." }
      }
      return { ok: true, value: { tiers: clean } }
    }
    case "enabled": {
      if (typeof v.enabled !== "boolean") return { ok: false, error: "Choose on or off." }
      const note = typeof v.note === "string" && v.note.trim() ? v.note.trim().slice(0, 200) : undefined
      return { ok: true, value: note ? { enabled: v.enabled, note } : { enabled: v.enabled } }
    }
    case "checkin_checkout": {
      const days = (d: unknown): string[] | "all" | null => {
        if (d === "all") return "all"
        if (!Array.isArray(d) || d.length === 0) return null
        const set = new Set(d.filter((x): x is string => (WEEKDAYS as readonly string[]).includes(x as string)))
        if (set.size !== d.length) return null
        return set.size === 7 ? "all" : WEEKDAYS.filter((w) => set.has(w))
      }
      const checkin = days(v.checkin)
      const checkout = days(v.checkout)
      if (!checkin || !checkout) return { ok: false, error: "Pick at least one check-in and one check-out day." }
      return { ok: true, value: { checkin, checkout } }
    }
    default:
      return { ok: false, error: "Enter a note." }
  }
}

/** Order-insensitive deep equality for stored JSON values. */
export function sameSettingValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b)
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(v ?? null)
}

/** Same scope = same key, channel and date range (the unique index on listing_settings). */
export function sameSettingScope(
  a: { setting_key: string; channel: string; date_from: string | null; date_to: string | null },
  b: { setting_key: string; channel: string; date_from: string | null; date_to: string | null }
): boolean {
  return (
    a.setting_key === b.setting_key &&
    a.channel === b.channel &&
    (a.date_from ?? null) === (b.date_from ?? null) &&
    (a.date_to ?? null) === (b.date_to ?? null)
  )
}


/**
 * A stored key may carry a name after "/" when one listing has several of the
 * same kind on one channel (e.g. "promotion.pms/early-bird"); the catalog
 * entry is the part before the slash.
 */
export function baseSettingKey(key: string): string {
  return key.split("/")[0]
}

export function settingKeyDef(key: string): SettingKeyDef | undefined {
  return KEY_INDEX.get(key) ?? KEY_INDEX.get(baseSettingKey(key))
}

export const CHANNEL_LABELS: Record<SettingChannel, string> = {
  all: "All channels",
  airbnb: "Airbnb",
  booking: "Booking.com",
  vrbo: "Vrbo",
  direct: "Direct",
  expedia: "Expedia",
}

export const SYSTEM_LABELS: Record<string, string> = {
  pricelabs: "PriceLabs",
  guesty: "Guesty",
  airbnb: "Airbnb",
  booking: "Booking.com",
  vrbo: "Vrbo",
  hub: "Hub",
}

export const STATUS_LABELS: Record<SettingStatus, string> = {
  planned: "Planned",
  applied: "Applied",
  verified: "Verified",
  drift: "Drift",
  retired: "Retired",
}

export const ACTION_LABELS: Record<SettingChangeAction, string> = {
  ProposeSettingChange: "Proposed",
  ApproveSettingChange: "Approved",
  ApplySetting: "Applied",
  VerifySetting: "Verified",
  FlagDrift: "Drift found",
  RevertSetting: "Reverted",
  RecordObservation: "Observed",
}

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`

function list(days: string[] | "all" | undefined): string {
  if (!days) return "—"
  return days === "all" ? "all days" : days.join(", ")
}

/** Human-readable value for any SettingValue shape. */
export function formatSettingValue(value: unknown): string {
  if (value == null) return "—"
  if (typeof value !== "object") return String(value)
  const v = value as Record<string, unknown>
  if (typeof v.text === "string") return v.text
  if (typeof v.amount === "number") {
    const per = typeof v.per === "string" ? ` per ${v.per}` : ""
    return `${usd(v.amount)}${per}`
  }
  if (typeof v.percent === "number") return `${v.percent}%`
  if (typeof v.nights === "number") {
    const fb =
      typeof v.fallback_after_days === "number"
        ? ` (if booked ${v.fallback_after_days}+ days out)`
        : ""
    return `${v.nights} night${v.nights === 1 ? "" : "s"}${fb}`
  }
  if (Array.isArray(v.tiers)) {
    return (v.tiers as { label: string; percent: number }[])
      .map((t) => `${t.label}: ${t.percent}%`)
      .join(" · ")
  }
  if (typeof v.enabled === "boolean") {
    const note = typeof v.note === "string" ? ` (${v.note})` : ""
    return `${v.enabled ? "On" : "Off"}${note}`
  }
  if ("checkin" in v || "checkout" in v) {
    return `Check-in: ${list(v.checkin as string[] | "all")} · Check-out: ${list(v.checkout as string[] | "all")}`
  }
  return JSON.stringify(value)
}

export function formatDateRange(from: string | null, to: string | null): string | null {
  if (!from && !to) return null
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
  if (from && to && from === to) return fmt(from)
  return `${from ? fmt(from) : "…"} – ${to ? fmt(to) : "…"}`
}

// ─── Row shapes (as read from the database) ─────────────────

export type ListingSettingRow = {
  id: string
  setting_key: string
  channel: SettingChannel
  date_from: string | null
  date_to: string | null
  value: SettingValue
  system: string
  status: SettingStatus
  last_change_id: string | null
  updated_at: string
}

export type ListingSettingChangeRow = {
  id: string
  change_set_id: string | null
  setting_key: string
  channel: SettingChannel
  date_from: string | null
  date_to: string | null
  action: SettingChangeAction
  old_value: SettingValue | null
  new_value: SettingValue | null
  system: string
  reason: string | null
  evidence: Record<string, unknown>
  adjustment_id: string | null
  actor_type: "staff" | "agent" | "owner" | "system"
  approved_by_label: string | null
  occurred_at: string
}

export type ListingChangeSetRow = {
  id: string
  title: string
  status: "proposed" | "approved" | "applied" | "verified" | "rejected"
  plan_ref: string | null
  approved_by_label: string | null
  approved_at: string | null
  notes: string | null
  created_at: string
}

export type ListingSetup =
  | { available: false; reason: "not_migrated" | "error" }
  | {
      available: true
      settings: ListingSettingRow[]
      changes: ListingSettingChangeRow[]
      changeSets: ListingChangeSetRow[]
    }

/** Settings grouped in catalog order; unknown keys land in their own group. */
export function groupSettings(settings: ListingSettingRow[]) {
  const order = new Map(SETTING_KEYS.map((k, i) => [k.key, i]))
  const sorted = [...settings].sort((a, b) => {
    const ka = order.get(baseSettingKey(a.setting_key)) ?? 999
    const kb = order.get(baseSettingKey(b.setting_key)) ?? 999
    if (ka !== kb) return ka - kb
    if (a.channel !== b.channel) return a.channel.localeCompare(b.channel)
    return (a.date_from ?? "").localeCompare(b.date_from ?? "")
  })
  const groups = SETTING_GROUPS.map((g) => ({
    ...g,
    rows: sorted.filter((s) => settingKeyDef(s.setting_key)?.group === g.id),
  }))
  const unknown = sorted.filter((s) => !settingKeyDef(s.setting_key))
  if (unknown.length > 0) {
    groups.push({ id: "policy", label: "Other", rows: unknown })
  }
  return groups.filter((g) => g.rows.length > 0)
}
