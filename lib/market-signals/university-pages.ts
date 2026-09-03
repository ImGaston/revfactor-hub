import { z } from "zod"

import { normalizedProviderEventSchema } from "@/lib/market-signals/contracts"
import {
  MarketSignalProviderRequestError,
  type MarketSignalMarket,
  type MarketSignalProviderCandidate,
  type MarketSignalProviderFetchResult,
} from "@/lib/market-signals/provider"

const MAX_RESPONSE_BYTES = 512 * 1024
const MAX_PARSED_CANDIDATES = 250
const FETCH_TIMEOUT_MS = 10_000

// University domains are intentionally reviewed in code as well as stored in
// the registry. A database edit alone must not expand the server-side fetch
// allowlist. Additions require a normal code review.
const REVIEWED_INSTITUTION_DOMAINS: Record<string, string> = {
  "university-of-connecticut": "uconn.edu",
  "university-of-tennessee-knoxville": "utk.edu",
  "george-washington-university": "gwu.edu",
}

const universityEventTypeSchema = z.enum([
  "commencement",
  "family_weekend",
  "homecoming",
])

const universityEventMatchRuleSchema = z.object({
  event_type: universityEventTypeSchema,
  event_name: z.string().trim().min(2).max(200),
  include_terms: z.array(z.string().trim().min(2).max(80)).min(1).max(12),
  exclude_terms: z.array(z.string().trim().min(2).max(80)).max(12).default([]),
})

const universityPageQueryConfigSchema = z
  .object({
    adapter: z.literal("official_page"),
    collection_status: z
      .enum(["registry_only", "enabled"])
      .default("registry_only"),
    source_role: z.enum(["canonical", "corroborating"]),
    institution_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    event_types: z.array(universityEventTypeSchema).min(1).max(3),
    match_rules: z.array(universityEventMatchRuleSchema).max(8).default([]),
    format: z
      .enum(["auto", "ics", "json_ld", "html", "rest_html"])
      .default("auto"),
    endpoint_path: z
      .string()
      .trim()
      .regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/)
      .optional(),
    endpoint_query: z
      .array(
        z.object({
          name: z.string().regex(/^[A-Za-z0-9_.~-]{1,80}$/),
          value: z.string().trim().min(1).max(200),
        })
      )
      .max(10)
      .default([]),
    days_forward: z.number().int().min(1).max(1095).default(1095),
    max_events: z.number().int().min(1).max(50).default(25),
    min_expected_events: z.number().int().min(0).max(10).default(1),
    timezone: z.string().trim().min(3).max(80).optional(),
    venue_name: z.string().trim().min(1).max(200).optional(),
    city: z.string().trim().min(1).max(120).optional(),
    region: z.string().trim().min(1).max(120).optional(),
    country_code: z.string().trim().length(2).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .superRefine((config, context) => {
    if (
      config.collection_status === "enabled" &&
      config.match_rules.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["match_rules"],
        message:
          "enabled official-page sources require explicit event match rules",
      })
    }
    for (const [index, rule] of config.match_rules.entries()) {
      if (!config.event_types.includes(rule.event_type)) {
        context.addIssue({
          code: "custom",
          path: ["match_rules", index, "event_type"],
          message: "match rule event type must be registered by this source",
        })
      }
    }
  })

export type UniversityPageQueryConfig = z.infer<
  typeof universityPageQueryConfigSchema
>

export type UniversityPageFormat = "ics" | "json_ld" | "html" | "rest_html"

export type UniversityPageDateCandidate = {
  externalId: string | null
  title: string
  startDate: string
  endDate: string | null
  sourceUrl: string | null
  status: string
  venueName: string | null
  city: string | null
  region: string | null
  countryCode: string | null
  publishedAt: string | null
  sourceFormat: UniversityPageFormat
  matchText: string
  eventType: z.infer<typeof universityEventTypeSchema> | null
}

type DateParseResult = {
  iso: string
  dateOnly: boolean
  calendarDate: string | null
}

export function parseUniversityPageQueryConfig(
  value: unknown
): UniversityPageQueryConfig {
  return universityPageQueryConfigSchema.parse(value)
}

function decodeHtml(value: string) {
  const codePoint = (raw: string, radix = 10) => {
    const parsed = Number.parseInt(raw, radix)
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff
      ? String.fromCodePoint(parsed)
      : ""
  }
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => codePoint(code))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => codePoint(code, 16))
}

function plainText(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function safeAbsoluteUrl(value: unknown, baseUrl: string) {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const resolved = new URL(value, baseUrl)
    return resolved.protocol === "https:" ? resolved.toString() : null
  } catch {
    return null
  }
}

function wallClockParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  )
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  }
}

function zonedDateTimeToIso(input: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  timezone: string
}) {
  const requestedAsUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second
  )
  let guess = requestedAsUtc
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = wallClockParts(new Date(guess), input.timezone)
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    )
    const adjustment = requestedAsUtc - actualAsUtc
    if (adjustment === 0) break
    guess += adjustment
  }
  return new Date(guess).toISOString()
}

function parseDateValue(
  value: unknown,
  timezone: string
): DateParseResult | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed)
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  const compactDateTime =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(trimmed)
  const localDateTime =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed)

  const dateParts = compactDate ?? isoDate
  if (dateParts) {
    const year = Number(dateParts[1])
    const month = Number(dateParts[2])
    const day = Number(dateParts[3])
    const calendarCheck = new Date(Date.UTC(year, month - 1, day))
    if (
      calendarCheck.getUTCFullYear() !== year ||
      calendarCheck.getUTCMonth() !== month - 1 ||
      calendarCheck.getUTCDate() !== day
    ) {
      return null
    }
    const calendarDate = `${dateParts[1]}-${dateParts[2]}-${dateParts[3]}`
    return {
      iso: zonedDateTimeToIso({
        year,
        month,
        day,
        hour: 0,
        minute: 0,
        second: 0,
        timezone,
      }),
      dateOnly: true,
      calendarDate,
    }
  }
  if (compactDateTime) {
    const values = compactDateTime.slice(1, 7).map(Number)
    const instant = compactDateTime[7]
      ? new Date(
          Date.UTC(
            values[0],
            values[1] - 1,
            values[2],
            values[3],
            values[4],
            values[5]
          )
        ).toISOString()
      : zonedDateTimeToIso({
          year: values[0],
          month: values[1],
          day: values[2],
          hour: values[3],
          minute: values[4],
          second: values[5],
          timezone,
        })
    return { iso: instant, dateOnly: false, calendarDate: null }
  }
  if (localDateTime) {
    return {
      iso: zonedDateTimeToIso({
        year: Number(localDateTime[1]),
        month: Number(localDateTime[2]),
        day: Number(localDateTime[3]),
        hour: Number(localDateTime[4]),
        minute: Number(localDateTime[5]),
        second: Number(localDateTime[6] ?? 0),
        timezone,
      }),
      dateOnly: false,
      calendarDate: null,
    }
  }

  const parsed = new Date(trimmed)
  return Number.isFinite(parsed.getTime())
    ? { iso: parsed.toISOString(), dateOnly: false, calendarDate: null }
    : null
}

function exclusiveDateEnd(end: DateParseResult, start: DateParseResult) {
  if (!end.dateOnly || !start.dateOnly || end.iso <= start.iso) return end.iso
  return new Date(new Date(end.iso).getTime() - 1).toISOString()
}

function unescapeIcs(value: string) {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim()
}

export function parseUniversityIcsDateCandidates(
  document: string,
  input: { sourceUrl: string; timezone: string }
): UniversityPageDateCandidate[] {
  const lines = document
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
  const events: Array<Record<string, { value: string; timezone?: string }>> = []
  let current: Record<string, { value: string; timezone?: string }> | null =
    null

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {}
      continue
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current)
      current = null
      if (events.length >= MAX_PARSED_CANDIDATES) break
      continue
    }
    if (!current) continue
    const separator = line.indexOf(":")
    if (separator <= 0) continue
    const descriptor = line.slice(0, separator)
    const value = line.slice(separator + 1)
    const [rawName, ...rawParameters] = descriptor.split(";")
    const name = rawName.toUpperCase()
    if (current[name]) continue
    const timezone = rawParameters
      .find((parameter) => parameter.toUpperCase().startsWith("TZID="))
      ?.slice(5)
    current[name] = { value, timezone }
  }

  return events.flatMap((event) => {
    if (event.RRULE) {
      throw new MarketSignalProviderRequestError(
        "Official university pages",
        "Recurring iCalendar rules require a bounded recurrence collector",
        422
      )
    }
    const title = unescapeIcs(event.SUMMARY?.value ?? "")
    const start = parseDateValue(
      event.DTSTART?.value,
      event.DTSTART?.timezone ?? input.timezone
    )
    if (title.length < 2 || !start) return []
    const parsedEnd = parseDateValue(
      event.DTEND?.value,
      event.DTEND?.timezone ?? event.DTSTART?.timezone ?? input.timezone
    )
    const endDate = parsedEnd ? exclusiveDateEnd(parsedEnd, start) : null
    const location = unescapeIcs(event.LOCATION?.value ?? "") || null
    const status = unescapeIcs(event.STATUS?.value ?? "scheduled").toLowerCase()
    const uid = unescapeIcs(event.UID?.value ?? "")
    const recurrenceId = unescapeIcs(event["RECURRENCE-ID"]?.value ?? "")
    return [
      {
        externalId:
          [uid, recurrenceId].filter(Boolean).join("|").slice(0, 300) || null,
        title,
        startDate: start.iso,
        endDate,
        sourceUrl:
          safeAbsoluteUrl(event.URL?.value, input.sourceUrl) ?? input.sourceUrl,
        status,
        venueName: location,
        city: null,
        region: null,
        countryCode: null,
        publishedAt:
          parseDateValue(event.LAST_MODIFIED?.value, "UTC")?.iso ?? null,
        sourceFormat: "ics" as const,
        matchText: `${title} ${location ?? ""}`.trim(),
        eventType: null,
      },
    ]
  })
}

function jsonLdNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdNodes)
  if (!value || typeof value !== "object") return []
  const object = value as Record<string, unknown>
  return [object, ...jsonLdNodes(object["@graph"])]
}

function jsonLdValue(value: unknown) {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    if (typeof object.name === "string") return object.name
    if (typeof object["@id"] === "string") return object["@id"]
    if (typeof object.value === "string") return object.value
  }
  return null
}

function isEventNode(node: Record<string, unknown>) {
  const rawTypes = Array.isArray(node["@type"])
    ? node["@type"]
    : [node["@type"]]
  return rawTypes.some(
    (type) => typeof type === "string" && type.toLowerCase().endsWith("event")
  )
}

export function parseUniversityJsonLdDateCandidates(
  document: string,
  input: { sourceUrl: string; timezone: string }
): UniversityPageDateCandidate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(document) as unknown
  } catch {
    return []
  }

  return jsonLdNodes(parsed)
    .filter(isEventNode)
    .slice(0, MAX_PARSED_CANDIDATES)
    .flatMap((node) => {
      const title = jsonLdValue(node.name)?.trim() ?? ""
      const start = parseDateValue(node.startDate, input.timezone)
      if (title.length < 2 || !start) return []
      const parsedEnd = parseDateValue(node.endDate, input.timezone)
      const location =
        node.location && typeof node.location === "object"
          ? (node.location as Record<string, unknown>)
          : null
      const address =
        location?.address && typeof location.address === "object"
          ? (location.address as Record<string, unknown>)
          : null
      const externalId =
        jsonLdValue(node.identifier) ?? jsonLdValue(node["@id"])
      const rawStatus = jsonLdValue(node.eventStatus) ?? "scheduled"
      return [
        {
          externalId,
          title,
          startDate: start.iso,
          endDate: parsedEnd ? exclusiveDateEnd(parsedEnd, start) : null,
          sourceUrl:
            safeAbsoluteUrl(node.url, input.sourceUrl) ?? input.sourceUrl,
          status: /cancel/i.test(rawStatus)
            ? "canceled"
            : /postpon/i.test(rawStatus)
              ? "postponed"
              : "scheduled",
          venueName: jsonLdValue(location?.name),
          city: jsonLdValue(address?.addressLocality),
          region: jsonLdValue(address?.addressRegion),
          countryCode: jsonLdValue(address?.addressCountry),
          publishedAt:
            parseDateValue(node.dateModified, input.timezone)?.iso ?? null,
          sourceFormat: "json_ld" as const,
          matchText: [
            title,
            jsonLdValue(location?.name),
            jsonLdValue(address?.addressLocality),
          ]
            .filter((value): value is string => Boolean(value))
            .join(" "),
          eventType: null,
        },
      ]
    })
}

function attributeValue(attributes: string, name: string) {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  ).exec(attributes)
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim()
}

function htmlDateContext(
  document: string,
  dateIndex: number,
  dateEnd: number,
  defaultTitle?: string
) {
  const windowStart = Math.max(0, dateIndex - 20_000)
  const preceding = document.slice(windowStart, dateIndex)
  const headings = [
    ...preceding.matchAll(
      /<(?:h[1-6]|dt)\b[^>]*>([\s\S]*?)<\/(?:h[1-6]|dt)>/gi
    ),
  ]
  const heading = headings.at(-1)
  const headingTitle = plainText(heading?.[1] ?? "")

  const lowerDocument = document.toLowerCase()
  const rowStart = lowerDocument.lastIndexOf("<tr", dateIndex)
  const priorRowEnd = lowerDocument.lastIndexOf("</tr>", dateIndex)
  const rowEnd = lowerDocument.indexOf("</tr>", dateEnd)
  if (rowStart > priorRowEnd && rowEnd >= dateEnd) {
    const row = document.slice(rowStart, rowEnd + 5)
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (match) => plainText(match[1])
    )
    const rowTitle = cells.find(
      (cell) =>
        cell.length >= 2 &&
        !/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
          cell
        )
    )
    return {
      title:
        rowTitle || headingTitle || defaultTitle || "Official university event",
      yearContext: `${headingTitle} ${plainText(row)}`,
      text: plainText(row).slice(0, 2000),
    }
  }

  // Prefer the smallest nearby semantic block. This prevents a date such as
  // "ticket registration opens May 1" from inheriting every keyword in a
  // long Commencement section.
  const semanticBlocks = [...preceding.matchAll(/<(p|li|dd|h[1-6])\b[^>]*>/gi)]
  const semanticBlock = semanticBlocks.at(-1)
  if (semanticBlock?.index != null) {
    const blockTag = semanticBlock[1].toLowerCase()
    const blockStart = windowStart + semanticBlock.index
    const priorBlockEnd = lowerDocument.lastIndexOf(`</${blockTag}>`, dateIndex)
    const blockEnd = lowerDocument.indexOf(`</${blockTag}>`, dateEnd)
    if (priorBlockEnd < blockStart && blockEnd >= dateEnd) {
      const block = document.slice(blockStart, blockEnd + blockTag.length + 3)
      const blockText = plainText(block).slice(0, 1000)
      return {
        title: blockTag.startsWith("h")
          ? blockText
          : headingTitle || defaultTitle || "Official university event",
        yearContext: `${headingTitle} ${blockText}`,
        text: blockText,
      }
    }
  }

  const contextStart =
    heading?.index == null ? windowStart : windowStart + heading.index
  const followingWindowEnd = Math.min(document.length, dateEnd + 800)
  const following = document.slice(dateEnd, followingWindowEnd)
  const nextHeadingIndex = following.search(/<h[1-6]\b/i)
  const contextEnd =
    nextHeadingIndex < 0 ? followingWindowEnd : dateEnd + nextHeadingIndex
  return {
    title: headingTitle || defaultTitle || "Official university event",
    yearContext: headingTitle,
    text: plainText(
      document.slice(
        Math.max(contextStart, dateIndex - 300),
        Math.min(contextEnd, dateEnd + 300)
      )
    ).slice(0, 1000),
  }
}

export function parseUniversityHtmlDateCandidates(
  document: string,
  input: { sourceUrl: string; timezone: string; defaultTitle?: string }
): UniversityPageDateCandidate[] {
  const candidates: UniversityPageDateCandidate[] = []
  const pageTitle =
    plainText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(document)?.[1] ?? "") ||
    input.defaultTitle
  const timePattern = /<time\b([^>]*)>([\s\S]*?)<\/time>/gi
  let timeMatch: RegExpExecArray | null
  while (
    candidates.length < MAX_PARSED_CANDIDATES &&
    (timeMatch = timePattern.exec(document))
  ) {
    const rawDate = attributeValue(timeMatch[1], "datetime")
    const start = parseDateValue(rawDate, input.timezone)
    if (!start) continue
    const context = htmlDateContext(
      document,
      timeMatch.index,
      timePattern.lastIndex,
      pageTitle
    )
    const title = context.title
    if (title.length < 2) continue
    candidates.push({
      externalId: attributeValue(timeMatch[1], "id") || null,
      title,
      startDate: start.iso,
      endDate: null,
      sourceUrl: input.sourceUrl,
      status: "scheduled",
      venueName: null,
      city: null,
      region: null,
      countryCode: null,
      publishedAt: null,
      sourceFormat: "html",
      matchText: context.text,
      eventType: null,
    })
  }
  const monthNumbers: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  }
  const monthPattern = Object.keys(monthNumbers).join("|")
  const weekdayPattern =
    "(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)"
  // University pages commonly put the year only on the second date
  // ("Friday, October 16 - Sunday, October 18, 2026") or in the
  // surrounding term heading ("Spring 2027" followed by "May 8-9").
  // Requiring one of those explicit year anchors keeps us from guessing.
  const datePattern = new RegExp(
    `\\b(?:${weekdayPattern}\\s*,?\\s*)?(${monthPattern})\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?(?:\\s*(?:-|–|—|to|through)\\s*(?:${weekdayPattern}\\s*,?\\s*)?(?:(${monthPattern})\\s+)?(\\d{1,2})(?:,?\\s+(20\\d{2}))?)?\\b`,
    "gi"
  )
  // Preserve string offsets while allowing a date range to cross inline
  // markup, as it does in UT Knoxville's registrar response.
  const dateSearchDocument = document.replace(
    /<[^>]*>|&nbsp;|&#160;/gi,
    (markup) => " ".repeat(markup.length)
  )
  let dateMatch: RegExpExecArray | null
  while (
    candidates.length < MAX_PARSED_CANDIDATES &&
    (dateMatch = datePattern.exec(dateSearchDocument))
  ) {
    const context = htmlDateContext(
      document,
      dateMatch.index,
      datePattern.lastIndex,
      pageTitle
    )
    const title = context.title
    if (title.length < 2) continue
    const month = monthNumbers[dateMatch[1].toLowerCase()]
    const contextualYear = /\b(20\d{2})\b/.exec(context.yearContext)?.[1]
    const explicitStartYear = dateMatch[3]
    const explicitEndYear = dateMatch[6]
    const yearValue = explicitEndYear ?? explicitStartYear ?? contextualYear
    if (!yearValue) continue
    const startDay = Number(dateMatch[2])
    const endMonth = dateMatch[4]
      ? monthNumbers[dateMatch[4].toLowerCase()]
      : month
    const endDay = Number(dateMatch[5] ?? dateMatch[2])
    const anchorYear = Number(yearValue)
    const startYear = explicitStartYear
      ? Number(explicitStartYear)
      : explicitEndYear && endMonth < month
        ? Number(explicitEndYear) - 1
        : anchorYear
    const endYear = explicitEndYear
      ? Number(explicitEndYear)
      : endMonth < month
        ? startYear + 1
        : startYear
    const validStart = new Date(Date.UTC(startYear, month - 1, startDay))
    const validEnd = new Date(Date.UTC(endYear, endMonth - 1, endDay))
    if (
      validStart.getUTCFullYear() !== startYear ||
      validStart.getUTCMonth() !== month - 1 ||
      validStart.getUTCDate() !== startDay ||
      validEnd.getUTCFullYear() !== endYear ||
      validEnd.getUTCMonth() !== endMonth - 1 ||
      validEnd.getUTCDate() !== endDay ||
      validEnd.getTime() < validStart.getTime()
    ) {
      continue
    }
    const afterEnd = new Date(Date.UTC(endYear, endMonth - 1, endDay + 1))
    const start = parseDateValue(
      `${startYear}-${String(month).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
      input.timezone
    )
    const end = parseDateValue(
      `${afterEnd.getUTCFullYear()}-${String(afterEnd.getUTCMonth() + 1).padStart(2, "0")}-${String(afterEnd.getUTCDate()).padStart(2, "0")}`,
      input.timezone
    )
    if (!start || !end) continue
    candidates.push({
      externalId: null,
      title,
      startDate: start.iso,
      endDate: exclusiveDateEnd(end, start),
      sourceUrl: input.sourceUrl,
      status: "scheduled",
      venueName: null,
      city: null,
      region: null,
      countryCode: null,
      publishedAt: null,
      sourceFormat: "html",
      matchText: context.text,
      eventType: null,
    })
  }
  return uniqueCandidates(candidates)
}

function renderedString(value: unknown) {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record.rendered === "string") return record.rendered
  }
  return null
}

function collectJsonRecords(
  value: unknown,
  records: Record<string, unknown>[],
  htmlFragments: string[]
) {
  if (records.length >= MAX_PARSED_CANDIDATES * 4) return
  if (Array.isArray(value)) {
    for (const item of value) collectJsonRecords(item, records, htmlFragments)
    return
  }
  if (!value || typeof value !== "object") return
  const record = value as Record<string, unknown>
  records.push(record)
  for (const child of Object.values(record)) {
    const rendered = renderedString(child)
    if (rendered?.includes("<") && htmlFragments.length < 50) {
      htmlFragments.push(rendered)
    }
    if (typeof child === "object" && child !== null) {
      collectJsonRecords(child, records, htmlFragments)
    }
  }
}

export function parseUniversityRestHtmlDateCandidates(
  document: string,
  input: { sourceUrl: string; timezone: string }
): UniversityPageDateCandidate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(document) as unknown
  } catch {
    return []
  }
  const records: Record<string, unknown>[] = []
  const htmlFragments: string[] = []
  collectJsonRecords(parsed, records, htmlFragments)
  const defaultTitle = records
    .map((record) => renderedString(record.title))
    .find((title): title is string => Boolean(title?.trim()))
  const structured = records.flatMap((record) => {
    const title = plainText(
      renderedString(record.title) ??
        renderedString(record.name) ??
        renderedString(record.summary) ??
        renderedString(record.description) ??
        ""
    )
    const rawStart =
      record.startDate ??
      record.start_date ??
      record.date_start ??
      record.event_date
    const start = parseDateValue(rawStart, input.timezone)
    if (title.length < 2 || !start) return []
    const rawEnd = record.endDate ?? record.end_date ?? record.date_end
    const end = parseDateValue(rawEnd, input.timezone)
    return [
      {
        externalId: jsonLdValue(record.id) ?? jsonLdValue(record.slug) ?? null,
        title,
        startDate: start.iso,
        endDate: end ? exclusiveDateEnd(end, start) : null,
        sourceUrl:
          safeAbsoluteUrl(record.link ?? record.url, input.sourceUrl) ??
          input.sourceUrl,
        status: "scheduled",
        venueName: null,
        city: null,
        region: null,
        countryCode: null,
        publishedAt:
          parseDateValue(record.modified ?? record.dateModified, input.timezone)
            ?.iso ?? null,
        sourceFormat: "rest_html" as const,
        matchText: plainText(JSON.stringify(record)).slice(0, 2000),
        eventType: null,
      },
    ]
  })
  const envelopeUpdatedAt =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parseDateValue(
          (parsed as Record<string, unknown>).lastUpdated,
          input.timezone
        )?.iso ?? null)
      : null
  const fromHtml = htmlFragments.flatMap((fragment) =>
    parseUniversityHtmlDateCandidates(fragment, {
      ...input,
      defaultTitle: plainText(defaultTitle ?? "") || undefined,
    }).map((candidate) => ({
      ...candidate,
      sourceFormat: "rest_html" as const,
      publishedAt: candidate.publishedAt ?? envelopeUpdatedAt,
    }))
  )
  return uniqueCandidates([...structured, ...fromHtml]).slice(
    0,
    MAX_PARSED_CANDIDATES
  )
}

function extractJsonLdScripts(document: string) {
  return [
    ...document.matchAll(
      /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ].map((match) => match[1])
}

function stableHash(input: string) {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function stableExternalId(
  candidate: UniversityPageDateCandidate,
  queryConfig: UniversityPageQueryConfig
) {
  if (candidate.externalId) return candidate.externalId.slice(0, 300)
  const occurrenceDate = new Date(candidate.startDate)
  const occurrenceYear = occurrenceDate.getUTCFullYear()
  const occurrenceQuarter = Math.floor(occurrenceDate.getUTCMonth() / 3) + 1
  return `official-page-${stableHash(
    `${queryConfig.institution_slug}|${candidate.eventType}|${candidate.title}|${occurrenceYear}|q${occurrenceQuarter}`
  )}`
}

function normalizedMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function matchRuleFor(
  candidate: UniversityPageDateCandidate,
  queryConfig: UniversityPageQueryConfig
) {
  const haystack = normalizedMatchText(
    `${candidate.title} ${candidate.matchText}`
  )
  return (
    queryConfig.match_rules.find((rule) => {
      const included = rule.include_terms.some((term) =>
        haystack.includes(normalizedMatchText(term))
      )
      const excluded = rule.exclude_terms.some((term) =>
        haystack.includes(normalizedMatchText(term))
      )
      return included && !excluded
    }) ?? null
  )
}

function uniqueCandidates(candidates: UniversityPageDateCandidate[]) {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.title.toLowerCase()}|${candidate.startDate}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function collapseContainedDateWindows(
  candidates: UniversityPageDateCandidate[]
) {
  return candidates.filter((candidate, index) => {
    const start = new Date(candidate.startDate).getTime()
    const end = new Date(candidate.endDate ?? candidate.startDate).getTime()
    return !candidates.some((other, otherIndex) => {
      if (otherIndex === index || other.eventType !== candidate.eventType) {
        return false
      }
      const otherStart = new Date(other.startDate).getTime()
      const otherEnd = new Date(other.endDate ?? other.startDate).getTime()
      return (
        otherStart <= start &&
        otherEnd >= end &&
        (otherStart < start || otherEnd > end)
      )
    })
  })
}

function assertOfficialUrl(sourceUrl: string, officialDomain: string) {
  let url: URL
  try {
    url = new URL(sourceUrl)
  } catch {
    throw new MarketSignalProviderRequestError(
      "Official university pages",
      "Official university source URL is invalid",
      400
    )
  }
  const hostname = url.hostname.toLowerCase()
  const normalizedDomain = officialDomain
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
  const validDomain =
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      normalizedDomain
    )
  const allowed =
    validDomain &&
    (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`))
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    hostname === "localhost" ||
    !allowed
  ) {
    throw new MarketSignalProviderRequestError(
      "Official university pages",
      "Official university source is outside its reviewed HTTPS host allowlist",
      400
    )
  }
  return url
}

function assertReviewedInstitutionDomain(
  institutionSlug: string,
  officialDomain: string
) {
  const reviewedDomain = REVIEWED_INSTITUTION_DOMAINS[institutionSlug]
  const normalizedDomain = officialDomain
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
  if (!reviewedDomain || normalizedDomain !== reviewedDomain) {
    throw new MarketSignalProviderRequestError(
      "Official university pages",
      "Institution domain is not in the reviewed application allowlist",
      400
    )
  }
}

function officialEvidenceUrl(
  candidateUrl: string | null,
  fetchedUrl: URL,
  officialDomain: string
) {
  if (!candidateUrl) return fetchedUrl.toString()
  try {
    return assertOfficialUrl(candidateUrl, officialDomain).toString()
  } catch {
    // Third-party ticket/calendar links can be useful outbound metadata, but
    // they are not Tier-1 evidence. Keep the fetched official page as the
    // auditable evidence URL and publisher.
    return fetchedUrl.toString()
  }
}

async function boundedResponseText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new MarketSignalProviderRequestError(
      "Official university pages",
      "Official university response exceeded the byte limit",
      413
    )
  }
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let document = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new MarketSignalProviderRequestError(
        "Official university pages",
        "Official university response exceeded the byte limit",
        413
      )
    }
    document += decoder.decode(value, { stream: true })
  }
  return document + decoder.decode()
}

function detectedFormat(
  configured: UniversityPageQueryConfig["format"],
  contentType: string,
  sourceUrl: URL
): UniversityPageFormat {
  if (configured !== "auto") return configured
  const type = contentType.toLowerCase()
  if (type.includes("text/calendar") || sourceUrl.pathname.endsWith(".ics")) {
    return "ics"
  }
  if (
    type.includes("application/ld+json") ||
    type.includes("application/json")
  ) {
    return "json_ld"
  }
  if (type.includes("text/html") || type.includes("application/xhtml+xml")) {
    return "html"
  }
  throw new MarketSignalProviderRequestError(
    "Official university pages",
    "Official university response has an unsupported content type",
    415
  )
}

export async function fetchUniversityPageEvents(input: {
  sourceUrl: string
  officialDomain: string
  queryConfig: UniversityPageQueryConfig
  market: MarketSignalMarket
  now?: Date
  fetchImpl?: typeof fetch
}): Promise<MarketSignalProviderFetchResult<UniversityPageDateCandidate>> {
  if (input.queryConfig.collection_status !== "enabled") {
    throw new MarketSignalProviderRequestError(
      "Official university pages",
      "Official university source remains registry-only",
      409
    )
  }
  assertReviewedInstitutionDomain(
    input.queryConfig.institution_slug,
    input.officialDomain
  )
  let url = assertOfficialUrl(input.sourceUrl, input.officialDomain)
  if (input.queryConfig.endpoint_path) {
    url = assertOfficialUrl(
      new URL(input.queryConfig.endpoint_path, `${url.origin}/`).toString(),
      input.officialDomain
    )
  }
  for (const parameter of input.queryConfig.endpoint_query) {
    url.searchParams.set(parameter.name, parameter.value)
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const requestSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  let response: Response | null = null
  for (let redirectCount = 0; redirectCount <= 2; redirectCount += 1) {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept:
          "text/calendar, application/ld+json, application/json, text/html;q=0.9",
        "User-Agent": "RevFactor-Market-Signals/1.0 (info@revfactor.io)",
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal: requestSignal,
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    await response.body?.cancel()
    const location = response.headers.get("location")
    if (!location || redirectCount === 2) {
      throw new MarketSignalProviderRequestError(
        "Official university pages",
        "Official university source exceeded the redirect limit",
        502
      )
    }
    url = assertOfficialUrl(
      new URL(location, url).toString(),
      input.officialDomain
    )
  }
  if (!response) {
    throw new MarketSignalProviderRequestError(
      "Official university pages",
      "Official university source returned no response",
      502
    )
  }
  if (!response.ok) {
    const label = response.status === 429 ? "rate limited" : "request failed"
    throw new MarketSignalProviderRequestError(
      "Official university pages",
      `Official university source ${label} with status ${response.status}`,
      response.status
    )
  }
  const document = await boundedResponseText(response)
  const format = detectedFormat(
    input.queryConfig.format,
    response.headers.get("content-type") ?? "",
    url
  )
  const timezone = input.queryConfig.timezone ?? input.market.timezone
  const parsed =
    format === "ics"
      ? parseUniversityIcsDateCandidates(document, {
          sourceUrl: url.toString(),
          timezone,
        })
      : format === "json_ld"
        ? parseUniversityJsonLdDateCandidates(document, {
            sourceUrl: url.toString(),
            timezone,
          })
        : format === "rest_html"
          ? parseUniversityRestHtmlDateCandidates(document, {
              sourceUrl: url.toString(),
              timezone,
            })
          : [
              ...extractJsonLdScripts(document).flatMap((script) =>
                parseUniversityJsonLdDateCandidates(script, {
                  sourceUrl: url.toString(),
                  timezone,
                })
              ),
              ...parseUniversityHtmlDateCandidates(document, {
                sourceUrl: url.toString(),
                timezone,
              }),
            ]
  const officialCandidates = parsed.map((candidate) => ({
    ...candidate,
    sourceUrl: officialEvidenceUrl(
      candidate.sourceUrl,
      url,
      input.officialDomain
    ),
  }))
  const now = input.now ?? new Date()
  const cutoff = new Date(now)
  cutoff.setUTCDate(cutoff.getUTCDate() + input.queryConfig.days_forward)
  const matched = uniqueCandidates(officialCandidates)
    .filter((candidate) => {
      const end = new Date(candidate.endDate ?? candidate.startDate).getTime()
      const start = new Date(candidate.startDate).getTime()
      return end >= now.getTime() && start <= cutoff.getTime()
    })
    .flatMap((candidate) => {
      const rule = matchRuleFor(candidate, input.queryConfig)
      if (!rule) return []
      return [
        {
          ...candidate,
          // The reviewed event name is the stable series identity. The page's
          // raw heading remains in matchText/evidence, but cosmetic heading
          // edits must not create a new canonical event.
          title: rule.event_name,
          eventType: rule.event_type,
        },
      ]
    })
    .filter((candidate, index, candidates) => {
      const key = `${candidate.eventType}|${candidate.title.toLowerCase()}|${candidate.startDate}|${candidate.endDate ?? ""}`
      return (
        candidates.findIndex(
          (other) =>
            `${other.eventType}|${other.title.toLowerCase()}|${other.startDate}|${other.endDate ?? ""}` ===
            key
        ) === index
      )
    })
  const current = collapseContainedDateWindows(matched).sort(
    (first, second) =>
      new Date(first.startDate).getTime() - new Date(second.startDate).getTime()
  )
  const occurrenceCounts = new Map<string, number>()
  const identified = current.map((candidate) => {
    if (candidate.externalId) return candidate
    const occurrenceDate = new Date(candidate.startDate)
    const year = occurrenceDate.getUTCFullYear()
    const quarter = Math.floor(occurrenceDate.getUTCMonth() / 3) + 1
    const group = `${candidate.eventType}|${candidate.title}|${year}|q${quarter}`
    const occurrence = (occurrenceCounts.get(group) ?? 0) + 1
    occurrenceCounts.set(group, occurrence)
    return {
      ...candidate,
      externalId: `official-page-${stableHash(
        `${input.queryConfig.institution_slug}|${group}|${occurrence}`
      )}`,
    }
  })
  if (identified.length < input.queryConfig.min_expected_events) {
    throw new MarketSignalProviderRequestError(
      "Official university pages",
      `Official university parser found ${identified.length} matching event(s); expected at least ${input.queryConfig.min_expected_events}`,
      422
    )
  }
  return {
    events: identified.slice(0, input.queryConfig.max_events),
    totalAvailable: identified.length,
    overflow: identified.length > input.queryConfig.max_events,
  }
}

export function normalizeUniversityPageEvent(
  event: UniversityPageDateCandidate,
  market: MarketSignalMarket,
  queryConfig: UniversityPageQueryConfig,
  observedAt = new Date().toISOString()
): MarketSignalProviderCandidate {
  const timezone = queryConfig.timezone ?? market.timezone
  const category = event.eventType
  if (!category) {
    throw new Error(
      "Official university event does not match the configured event types"
    )
  }
  const evidenceTimestamp = event.publishedAt ?? observedAt
  const normalized = normalizedProviderEventSchema.parse({
    sourceType: "official_feed",
    externalId: stableExternalId(event, queryConfig),
    sourceUrl: event.sourceUrl,
    title: event.title,
    category,
    startDate: event.startDate,
    endDate: event.endDate ?? event.startDate,
    timezone,
    venueName: event.venueName ?? queryConfig.venue_name ?? null,
    city: event.city ?? queryConfig.city ?? market.name.split(",")[0].trim(),
    region: event.region ?? queryConfig.region ?? null,
    countryCode:
      event.countryCode ?? queryConfig.country_code ?? market.countryCode,
    latitude: queryConfig.latitude ?? null,
    longitude: queryConfig.longitude ?? null,
    providerStatus: event.status,
    attendance: null,
    localRank: null,
    firstSeenAt: evidenceTimestamp,
    updatedAt: evidenceTimestamp,
  })
  const publisher = new URL(event.sourceUrl ?? "https://invalid.example")
    .hostname
  return {
    normalized,
    providerState:
      queryConfig.source_role === "canonical" ? event.status : "predicted",
    rank: null,
    accommodationSpend: null,
    impactStart: normalized.startDate.slice(0, 10),
    impactEnd: normalized.endDate.slice(0, 10),
    publisher,
    authorityTier: queryConfig.source_role === "canonical" ? 1 : 2,
    verificationState:
      queryConfig.source_role === "canonical" ? "verified" : "corroborating",
    evidenceSummary: `Official university ${event.sourceFormat} source lists ${event.title} for ${normalized.startDate.slice(0, 10)}; attendance was not inferred.`,
    retentionFloor: 0,
    timestampsFromObservation: event.publishedAt == null,
  }
}
