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
