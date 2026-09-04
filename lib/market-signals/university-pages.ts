export type UniversityPageDate = {
  institution: string
  eventType: "graduation" | "family_weekend" | "academic_calendar"
  title: string
  date: string
  sourceUrl: string
  confidence: "high" | "medium"
}

const DATE_PATTERN = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:[-–]\d{1,2})?,?\s+20\d{2}\b/gi

function eventTypeFor(text: string): UniversityPageDate["eventType"] | null {
  if (/family\s+weekend|family\s+day/i.test(text)) return "family_weekend"
  if (/commencement|graduation/i.test(text)) return "graduation"
  if (/academic\s+calendar|registrar/i.test(text)) return "academic_calendar"
  return null
}

export function parseUniversityOfficialPage(input: {
  html: string
  institution: string
  sourceUrl: string
}): UniversityPageDate[] {
  const text = input.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  const matches = [...text.matchAll(DATE_PATTERN)]
  const output: UniversityPageDate[] = []
  for (const match of matches) {
    const start = Math.max(0, (match.index ?? 0) - 35)
    const end = (match.index ?? 0) + match[0].length
    const context = text.slice(start, end)
    const eventType = eventTypeFor(context)
    if (!eventType) continue
    output.push({
      institution: input.institution,
      eventType,
      title: context.slice(0, 160),
      date: match[0].replace(/\s+/g, " ").trim(),
      sourceUrl: input.sourceUrl,
      confidence: eventType === "graduation" || eventType === "family_weekend" ? "high" : "medium",
    })
  }
  return output.filter((row, index, rows) => rows.findIndex((candidate) => candidate.eventType === row.eventType && candidate.date === row.date) === index)
}

export async function collectUniversityOfficialPage(input: {
  institution: string
  sourceUrl: string
  fetcher?: typeof fetch
}): Promise<UniversityPageDate[]> {
  const fetcher = input.fetcher ?? fetch
  const response = await fetcher(input.sourceUrl, {
    headers: { accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`University source returned HTTP ${response.status}`)
  return parseUniversityOfficialPage({
    institution: input.institution,
    sourceUrl: input.sourceUrl,
    html: await response.text(),
  })
}

function parseDateRange(value: string) {
  const match = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:[-–](\d{1,2}))?,?\s+(20\d{2})$/)
  if (!match) return null
  const month = match[1]
  const start = Number(match[2])
  const end = Number(match[3] ?? match[2])
  const year = Number(match[4])
  const monthIndex = new Date(`${month} 1, 2000`).getUTCMonth()
  const startDate = new Date(Date.UTC(year, monthIndex, start, 0, 0, 0))
  const endDate = new Date(Date.UTC(year, monthIndex, end, 23, 59, 59))
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null
  return { startDate: startDate.toISOString(), endDate: endDate.toISOString() }
}

export function normalizeUniversityPageDates(input: {
  rows: UniversityPageDate[]
  city: string
  region: string
  timezone?: string
}): NormalizedProviderEvent[] {
  return input.rows.flatMap((row, index) => {
    const range = parseDateRange(row.date)
    if (!range) return []
    const now = new Date().toISOString()
    return [{
      sourceType: "official_feed",
      externalId: `university-page:${row.institution.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${row.eventType}:${row.date.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${index}`,
      sourceUrl: row.sourceUrl,
      title: row.title.slice(0, 300),
      category: row.eventType,
      startDate: range.startDate,
      endDate: range.endDate,
      timezone: input.timezone ?? "America/New_York",
      venueName: row.institution,
      city: input.city,
      region: input.region,
      countryCode: "US",
      latitude: null,
      longitude: null,
      providerStatus: "official_page",
      attendance: null,
      localRank: null,
      firstSeenAt: now,
      updatedAt: now,
    }]
  })
}
import type { NormalizedProviderEvent } from "@/lib/market-signals/contracts"
