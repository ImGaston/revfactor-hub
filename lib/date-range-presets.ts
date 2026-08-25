// Named relative date ranges, shared by the DateRangePicker UI and the
// /reservations URL contract (?range=<key>). Keeping the resolution here —
// plain module, no "use client" — lets the server resolve the same keys, so
// a saved view holding range=last30 re-resolves to "the last 30 days as of
// now" every time it is opened instead of freezing the dates it was saved on.

export const DATE_RANGE_PRESETS = [
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "last90", label: "Last 90 days" },
  { key: "thismonth", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "ytd", label: "Year to date" },
] as const

export type DateRangePresetKey = (typeof DATE_RANGE_PRESETS)[number]["key"]

export function isDateRangePresetKey(
  value: string | undefined
): value is DateRangePresetKey {
  return DATE_RANGE_PRESETS.some((p) => p.key === value)
}

export function dateRangePresetLabel(key: DateRangePresetKey): string {
  return DATE_RANGE_PRESETS.find((p) => p.key === key)?.label ?? key
}

function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
}

export function resolveDateRangePreset(
  key: DateRangePresetKey,
  today: Date = new Date()
): { from: string; to: string } {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  switch (key) {
    case "last7":
      return { from: toIsoDate(addDays(t, -6)), to: toIsoDate(t) }
    case "last30":
      return { from: toIsoDate(addDays(t, -29)), to: toIsoDate(t) }
    case "last90":
      return { from: toIsoDate(addDays(t, -89)), to: toIsoDate(t) }
    case "thismonth":
      return {
        from: toIsoDate(new Date(t.getFullYear(), t.getMonth(), 1)),
        to: toIsoDate(t),
      }
    case "lastmonth":
      return {
        from: toIsoDate(new Date(t.getFullYear(), t.getMonth() - 1, 1)),
        to: toIsoDate(new Date(t.getFullYear(), t.getMonth(), 0)),
      }
    case "ytd":
      return { from: toIsoDate(new Date(t.getFullYear(), 0, 1)), to: toIsoDate(t) }
  }
}
