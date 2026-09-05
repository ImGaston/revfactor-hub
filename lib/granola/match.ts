import {
  normalizeCalendarEventId,
  normalizeEmail,
  normalizeEmails,
  normalizeInstant,
  normalizeSalesAppointment,
} from "@/lib/granola/normalize"
import type {
  GranolaAppointmentLookup,
  GranolaMatch,
  GranolaSalesAppointment,
} from "@/lib/granola/types"

export function matchGranolaNoteToAppointment(
  lookup: GranolaAppointmentLookup,
  candidates: GranolaSalesAppointment[]
): GranolaMatch {
  const eligible = candidates
    .filter((appointment) => appointment.kind === "revfactor_sales")
    .map(normalizeSalesAppointment)

  const calendarEventId = normalizeCalendarEventId(lookup.calendarEventId)
  if (calendarEventId) {
    const exact = eligible.filter(
      (appointment) => appointment.calendarEventId === calendarEventId
    )
    if (exact.length === 1) {
      return {
        status: "matched",
        method: "calendar_event_id",
        appointment: exact[0],
      }
    }
    if (exact.length > 1) {
      return { status: "unmatched", reason: "ambiguous_calendar_event_id" }
    }
  }

  const repEmail = normalizeEmail(lookup.repEmail)
  const scheduledStartAt = normalizeInstant(lookup.scheduledStartAt)
  const attendeeEmails = normalizeEmails(lookup.attendeeEmails)
  if (!repEmail || !scheduledStartAt || attendeeEmails.length === 0) {
    return { status: "unmatched", reason: "missing_match_fields" }
  }

  const attendeeSet = new Set(attendeeEmails)
  const fallback = eligible.filter(
    (appointment) =>
      appointment.repEmail === repEmail &&
      normalizeInstant(appointment.scheduledStartAt) === scheduledStartAt &&
      appointment.attendeeEmails.some((email) => attendeeSet.has(email))
  )

  if (fallback.length === 1) {
    return {
      status: "matched",
      method: "rep_time_attendee",
      appointment: fallback[0],
    }
  }
  if (fallback.length > 1) {
    return { status: "unmatched", reason: "ambiguous_rep_time_attendee" }
  }
  return { status: "unmatched", reason: "no_eligible_appointment" }
}
