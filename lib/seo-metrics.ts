// Pure, client- and server-safe helpers for importing the Rankbreeze
// "listing-metrics" SEO CSV into the `seo_metrics_raw` base table. No
// `next/headers` or Supabase imports here so the upload dialog can parse/preview
// rows and the server action can reuse the exact same parsing logic.
//
// `seo_metrics_raw` is a near 1:1 dump of the CSV (only the Tags column is
// dropped). All transformation — metric-label → slug, side → my/similar, hub
// listing/client resolution, empty-period nulling — happens in the read-side
// `seo_metrics` VIEW, so this loader stores columns verbatim.

// One parsed CSV row, mapped directly to `seo_metrics_raw` columns.
export type SeoMetricRow = {
  download_date: string
  airbnb_id: string | null
  rankbreeze_id: string | null
  listing_name: string | null
  city: string | null
  state: string | null
  country: string | null
  metric: string | null
  guest_count: number | null
  side: string | null
  period: string | null
  value: number | null
}

export type ParsedSeoMetrics = {
  rows: SeoMetricRow[]
  downloadDates: string[]
  distinctAirbnbIds: string[]
  error?: string
}

// Header labels we read from the CSV (lookup is by name, so column order and
// the unused Tags column don't matter).
const HEADER = {
  downloadDate: "download date",
  airbnbId: "airbnb id",
  rankbreezeId: "rankbreeze id",
  listingName: "listing name",
  city: "city",
  state: "state/province",
  country: "country",
  metric: "metric",
  guestCount: "guest count",
  side: "listing (own/similar listings)",
  period: "mm-yyyy",
  value: "value",
} as const

// Full-text, quote-aware CSV tokenizer. Handles quoted fields containing
// commas, escaped double-quotes (""), and embedded newlines — a stricter
// superset of the line-based splitter in bank-import.ts, because listing names
// are free text and this file is user-uploaded.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ",") {
      row.push(current)
      current = ""
    } else if (char === "\n" || char === "\r") {
      // Consume \r\n as a single break.
      if (char === "\r" && text[i + 1] === "\n") i++
      row.push(current)
      current = ""
      // Skip fully blank lines.
      if (row.length > 1 || row[0] !== "") rows.push(row)
      row = []
    } else {
      current += char
    }
  }
  // Flush trailing cell/row (no final newline).
  if (current !== "" || row.length > 0) {
    row.push(current)
    if (row.length > 1 || row[0] !== "") rows.push(row)
  }
  return rows
}

function toNumberOrNull(raw: string): number | null {
  const cleaned = raw.replace(/[$,%\s]/g, "")
  if (cleaned === "" || cleaned === "-") return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function parseSeoMetricsCsv(text: string): ParsedSeoMetrics {
  const table = parseCsv(text)
  if (table.length === 0) {
    return { rows: [], downloadDates: [], distinctAirbnbIds: [], error: "The file is empty." }
  }

  const header = table[0].map((c) => c.trim().toLowerCase().replace(/\s+/g, " "))
  const col = (name: string) => header.indexOf(name)
  const idx = {
    downloadDate: col(HEADER.downloadDate),
    airbnbId: col(HEADER.airbnbId),
    rankbreezeId: col(HEADER.rankbreezeId),
    listingName: col(HEADER.listingName),
    city: col(HEADER.city),
    state: col(HEADER.state),
    country: col(HEADER.country),
    metric: col(HEADER.metric),
    guestCount: col(HEADER.guestCount),
    side: col(HEADER.side),
    period: col(HEADER.period),
    value: col(HEADER.value),
  }

  // Only these columns are required to consider the file a valid export; the
  // rest (rankbreeze_id, city, state, country) are stored when present but not
  // mandatory.
  const required: [keyof typeof HEADER, string][] = [
    ["downloadDate", HEADER.downloadDate],
    ["airbnbId", HEADER.airbnbId],
    ["metric", HEADER.metric],
    ["side", HEADER.side],
    ["period", HEADER.period],
    ["value", HEADER.value],
  ]
  const missing = required.filter(([key]) => idx[key] === -1).map(([, label]) => label)
  if (missing.length > 0) {
    return {
      rows: [],
      downloadDates: [],
      distinctAirbnbIds: [],
      error: `CSV is missing expected columns: ${missing.join(", ")}. This does not look like a Rankbreeze listing-metrics export.`,
    }
  }

  const rows: SeoMetricRow[] = []
  const downloadDates = new Set<string>()
  const airbnbIds = new Set<string>()

  for (const cells of table.slice(1)) {
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "")
    const downloadDate = get(idx.downloadDate)
    // A row must have a download date to be meaningful; skip stray blanks.
    if (!downloadDate) continue

    const airbnbId = get(idx.airbnbId) || null
    const guestRaw = get(idx.guestCount)
    const guest = guestRaw === "" ? null : Number.parseInt(guestRaw, 10)

    rows.push({
      download_date: downloadDate,
      airbnb_id: airbnbId,
      rankbreeze_id: get(idx.rankbreezeId) || null,
      listing_name: get(idx.listingName) || null,
      city: get(idx.city) || null,
      state: get(idx.state) || null,
      country: get(idx.country) || null,
      metric: get(idx.metric) || null,
      guest_count: guest !== null && Number.isFinite(guest) ? guest : null,
      side: get(idx.side) || null,
      period: get(idx.period) || null,
      value: toNumberOrNull(get(idx.value)),
    })

    downloadDates.add(downloadDate)
    if (airbnbId) airbnbIds.add(airbnbId)
  }

  return {
    rows,
    downloadDates: Array.from(downloadDates),
    distinctAirbnbIds: Array.from(airbnbIds),
  }
}
