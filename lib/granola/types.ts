export type GranolaPerson = {
  name: string | null
  email: string | null
}

export type GranolaNoteListItem = {
  id: string
  title: string | null
  owner: GranolaPerson
  createdAt: string
  updatedAt: string
}

export type GranolaCalendarEvent = {
  title: string | null
  inviteeEmails: string[]
  organiserEmail: string | null
  calendarEventId: string | null
  scheduledStartAt: string | null
  scheduledEndAt: string | null
}

/**
 * Deliberately excludes transcript and private-note fields from Granola's
 * response. Downstream code cannot accidentally send them to a CRM sink.
 */
export type GranolaNote = GranolaNoteListItem & {
  webUrl: string | null
  calendarEvent: GranolaCalendarEvent | null
  attendees: GranolaPerson[]
  summaryText: string | null
  summaryMarkdown: string | null
}

export type GranolaNotesPage = {
  notes: GranolaNoteListItem[]
  hasMore: boolean
  cursor: string | null
}

export interface GranolaApi {
  listNotes(input: {
    updatedAfter: string
    cursor?: string | null
    pageSize: number
  }): Promise<GranolaNotesPage>
  getNote(noteId: string): Promise<GranolaNote>
}

export type GranolaSalesAppointment = {
  id: string
  kind: "revfactor_sales" | string
  calendarEventId: string | null
  repEmail: string | null
  scheduledStartAt: string
  attendeeEmails: string[]
}

export type GranolaMatch =
  | {
      status: "matched"
      method: "calendar_event_id" | "rep_time_attendee"
      appointment: GranolaSalesAppointment
    }
  | {
      status: "unmatched"
      reason:
        | "missing_match_fields"
        | "no_eligible_appointment"
        | "ambiguous_calendar_event_id"
        | "ambiguous_rep_time_attendee"
    }

export type GranolaImportCheckpoint = {
  /** Query boundary for a completed scan, or the fixed boundary of a paged scan. */
  updatedAfter: string
  /** Granola cursor when a bounded scan needs another invocation. */
  cursor: string | null
  /** Boundary to commit only after every page in the current scan succeeds. */
  pendingHighWatermark: string | null
}

export type GranolaProcessedNote = {
  sourceId: string
  noteId: string
  updatedAt: string
  outcome: "imported" | "unmatched" | "missing_summary"
}

export type GranolaAppointmentLookup = {
  sourceId: string
  calendarEventId: string | null
  repEmail: string | null
  scheduledStartAt: string | null
  attendeeEmails: string[]
}

export interface GranolaImportStore {
  getCheckpoint(sourceId: string): Promise<GranolaImportCheckpoint | null>
  saveCheckpoint(
    sourceId: string,
    checkpoint: GranolaImportCheckpoint
  ): Promise<void>
  hasProcessedNote(input: {
    noteId: string
    updatedAt: string
  }): Promise<boolean>
  findEligibleSalesAppointments(
    lookup: GranolaAppointmentLookup
  ): Promise<GranolaSalesAppointment[]>
  recordProcessedNote(input: GranolaProcessedNote): Promise<void>
}

export type GranolaInternalSummary = {
  sourceId: string
  appointmentId: string
  noteId: string
  noteUpdatedAt: string
  sourceUrl: string | null
  summaryText: string | null
  summaryMarkdown: string | null
}

/** Internal persistence only. This interface intentionally has no GHL method. */
export interface GranolaSummarySink {
  upsertInternalSummary(summary: GranolaInternalSummary): Promise<void>
}

export type GranolaLogEvent = {
  event:
    | "scan_started"
    | "scan_continuing"
    | "scan_completed"
    | "scan_deferred"
    | "note_failed"
  sourceId: string
  noteId?: string
  errorCode?: string
}

export interface GranolaSafeLogger {
  info(event: GranolaLogEvent): void
  error(event: GranolaLogEvent): void
}

export type GranolaImportResult = {
  status: "completed" | "deferred" | "failed"
  fetched: number
  imported: number
  deduplicated: number
  unmatched: number
  missingSummary: number
  failures: number
  checkpoint: GranolaImportCheckpoint | null
}
