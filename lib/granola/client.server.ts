import type {
  GranolaApi,
  GranolaCalendarEvent,
  GranolaNote,
  GranolaNoteListItem,
  GranolaNotesPage,
  GranolaPerson,
} from "@/lib/granola/types"

const DEFAULT_BASE_URL = "https://public-api.granola.ai"
const DEFAULT_TIMEOUT_MS = 15_000

export class GranolaApiError extends Error {
  constructor(
    readonly code: "network_error" | "http_error" | "invalid_response",
    readonly operation: "list_notes" | "get_note",
    readonly status: number | null = null
  ) {
    super(`Granola ${operation} failed (${code})`)
    this.name = "GranolaApiError"
  }
}

export class GranolaApiClient implements GranolaApi {
  private readonly token: string
  private readonly fetcher: typeof fetch
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(input: {
    token: string
    fetcher?: typeof fetch
    baseUrl?: string
    timeoutMs?: number
  }) {
    const token = input.token.trim()
    if (!token) throw new Error("Granola API token is required")
    this.token = token
    this.fetcher = input.fetcher ?? fetch
    this.baseUrl = (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")
    this.timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async listNotes(input: {
    updatedAfter: string
    cursor?: string | null
    pageSize: number
  }): Promise<GranolaNotesPage> {
    if (
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 30
    ) {
      throw new RangeError(
        "Granola pageSize must be an integer from 1 through 30"
      )
    }

    const url = new URL(`${this.baseUrl}/v1/notes`)
    url.searchParams.set("updated_after", input.updatedAfter)
    url.searchParams.set("page_size", String(input.pageSize))
    if (input.cursor) url.searchParams.set("cursor", input.cursor)

    const payload = await this.request(url, "list_notes")
    const page = parseNotesPage(payload)
    if (page.notes.length > input.pageSize) {
      throw new GranolaApiError("invalid_response", "list_notes")
    }
    return page
  }

  async getNote(noteId: string): Promise<GranolaNote> {
    const payload = await this.request(
      new URL(`${this.baseUrl}/v1/notes/${encodeURIComponent(noteId)}`),
      "get_note"
    )
    return parseNote(payload)
  }

  private async request(
    url: URL,
    operation: "list_notes" | "get_note"
  ): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    let response: Response
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      })
    } catch {
      throw new GranolaApiError("network_error", operation)
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      throw new GranolaApiError("http_error", operation, response.status)
    }

    try {
      return (await response.json()) as unknown
    } catch {
      throw new GranolaApiError("invalid_response", operation, response.status)
    }
  }
}

function parseNotesPage(value: unknown): GranolaNotesPage {
  const record = asRecord(value)
  if (
    !record ||
    !Array.isArray(record.notes) ||
    typeof record.hasMore !== "boolean"
  ) {
    throw new GranolaApiError("invalid_response", "list_notes")
  }
  const cursor = nullableString(record.cursor)
  if (record.hasMore && !cursor) {
    throw new GranolaApiError("invalid_response", "list_notes")
  }
  return {
    notes: record.notes.map((note) => parseListItem(note, "list_notes")),
    hasMore: record.hasMore,
    cursor,
  }
}

function parseNote(value: unknown): GranolaNote {
  const record = asRecord(value)
  if (!record) throw new GranolaApiError("invalid_response", "get_note")
  const listItem = parseListItem(record, "get_note")
  const attendees = Array.isArray(record.attendees)
    ? record.attendees.map((person) => parsePerson(person, "get_note"))
    : []

  return {
    ...listItem,
    webUrl: nullableString(record.web_url),
    calendarEvent: parseCalendarEvent(record.calendar_event),
    attendees,
    summaryText: nullableString(record.summary_text),
    summaryMarkdown: nullableString(record.summary_markdown),
  }
}

function parseListItem(
  value: unknown,
  operation: "list_notes" | "get_note"
): GranolaNoteListItem {
  const record = asRecord(value)
  if (!record) throw new GranolaApiError("invalid_response", operation)
  const id = requiredString(record.id)
  const createdAt = validDateString(record.created_at)
  const updatedAt = validDateString(record.updated_at)
  if (!id || !createdAt || !updatedAt) {
    throw new GranolaApiError("invalid_response", operation)
  }
  return {
    id,
    title: nullableString(record.title),
    owner: parsePerson(record.owner, operation),
    createdAt,
    updatedAt,
  }
}

function parsePerson(
  value: unknown,
  operation: "list_notes" | "get_note"
): GranolaPerson {
  const record = asRecord(value)
  if (!record) throw new GranolaApiError("invalid_response", operation)
  return {
    name: nullableString(record.name),
    email: nullableString(record.email),
  }
}

function parseCalendarEvent(value: unknown): GranolaCalendarEvent | null {
  if (value === null || value === undefined) return null
  const record = asRecord(value)
  if (!record) throw new GranolaApiError("invalid_response", "get_note")
  const invitees = Array.isArray(record.invitees) ? record.invitees : []
  return {
    title: nullableString(record.event_title),
    inviteeEmails: invitees
      .map(asRecord)
      .map((invitee) => nullableString(invitee?.email))
      .filter((email): email is string => email !== null),
    organiserEmail: nullableString(record.organiser),
    calendarEventId: nullableString(record.calendar_event_id),
    scheduledStartAt: nullableDateString(record.scheduled_start_time),
    scheduledEndAt: nullableDateString(record.scheduled_end_time),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function validDateString(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return null
  return value
}

function nullableDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const parsed = validDateString(value)
  if (!parsed) throw new GranolaApiError("invalid_response", "get_note")
  return parsed
}
