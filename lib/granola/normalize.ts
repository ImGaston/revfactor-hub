import type {
  GranolaAppointmentLookup,
  GranolaNote,
  GranolaSalesAppointment,
} from "@/lib/granola/types"

export function normalizeEmail(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim().toLowerCase()
  return normalized || null
}

export function normalizeCalendarEventId(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim()
  return normalized || null
}

export function normalizeInstant(
  value: string | null | undefined
): string | null {
  if (!value) return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null
}

export function normalizeEmails(
  values: Array<string | null | undefined>
): string[] {
  return [
    ...new Set(values.map(normalizeEmail).filter((value) => value !== null)),
  ].sort()
}

export function buildAppointmentLookup(
  sourceId: string,
  note: GranolaNote
): GranolaAppointmentLookup {
  return {
    sourceId,
    calendarEventId: normalizeCalendarEventId(
      note.calendarEvent?.calendarEventId
    ),
    repEmail: normalizeEmail(note.owner.email),
    scheduledStartAt: normalizeInstant(note.calendarEvent?.scheduledStartAt),
    attendeeEmails: normalizeEmails([
      ...note.attendees.map((attendee) => attendee.email),
      ...(note.calendarEvent?.inviteeEmails ?? []),
    ]),
  }
}

export function normalizeSalesAppointment(
  appointment: GranolaSalesAppointment
): GranolaSalesAppointment {
  return {
    ...appointment,
    calendarEventId: normalizeCalendarEventId(appointment.calendarEventId),
    repEmail: normalizeEmail(appointment.repEmail),
    scheduledStartAt:
      normalizeInstant(appointment.scheduledStartAt) ??
      appointment.scheduledStartAt,
    attendeeEmails: normalizeEmails(appointment.attendeeEmails),
  }
}
