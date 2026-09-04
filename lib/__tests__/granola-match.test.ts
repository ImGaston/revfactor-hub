import { describe, expect, it } from "vitest"
import { matchGranolaNoteToAppointment } from "@/lib/granola/match"
import type {
  GranolaAppointmentLookup,
  GranolaSalesAppointment,
} from "@/lib/granola/types"

const lookup: GranolaAppointmentLookup = {
  sourceId: "rep-one",
  calendarEventId: " event-123 ",
  repEmail: "REP@EXAMPLE.COM",
  scheduledStartAt: "2026-09-01T10:00:00-04:00",
  attendeeEmails: ["LEAD@example.com"],
}

function appointment(
  overrides: Partial<GranolaSalesAppointment> = {}
): GranolaSalesAppointment {
  return {
    id: "appointment-1",
    kind: "revfactor_sales",
    calendarEventId: "event-123",
    repEmail: "rep@example.com",
    scheduledStartAt: "2026-09-01T14:00:00Z",
    attendeeEmails: ["lead@example.com"],
    ...overrides,
  }
}

describe("matchGranolaNoteToAppointment", () => {
  it("prefers a unique exact calendar event ID", () => {
    const result = matchGranolaNoteToAppointment(lookup, [
      appointment(),
      appointment({
        id: "appointment-2",
        calendarEventId: "different",
      }),
    ])
    expect(result).toMatchObject({
      status: "matched",
      method: "calendar_event_id",
      appointment: { id: "appointment-1" },
    })
  })

  it("falls back to normalized rep, exact instant, and attendee intersection", () => {
    const result = matchGranolaNoteToAppointment(
      { ...lookup, calendarEventId: null },
      [appointment({ calendarEventId: null })]
    )
    expect(result).toMatchObject({
      status: "matched",
      method: "rep_time_attendee",
    })
  })

  it("does not attach an ambiguous fallback match", () => {
    const result = matchGranolaNoteToAppointment(
      { ...lookup, calendarEventId: null },
      [
        appointment({ calendarEventId: null }),
        appointment({ id: "appointment-2", calendarEventId: null }),
      ]
    )
    expect(result).toEqual({
      status: "unmatched",
      reason: "ambiguous_rep_time_attendee",
    })
  })

  it("does not attach non-sales or attendee-mismatched appointments", () => {
    const result = matchGranolaNoteToAppointment(
      { ...lookup, calendarEventId: null },
      [
        appointment({ kind: "onboarding", calendarEventId: null }),
        appointment({
          id: "appointment-2",
          calendarEventId: null,
          attendeeEmails: ["someone-else@example.com"],
        }),
      ]
    )
    expect(result).toEqual({
      status: "unmatched",
      reason: "no_eligible_appointment",
    })
  })

  it("does not use fallback to resolve a duplicated exact event ID", () => {
    const result = matchGranolaNoteToAppointment(lookup, [
      appointment(),
      appointment({
        id: "appointment-2",
        repEmail: "other@example.com",
        attendeeEmails: ["other-lead@example.com"],
      }),
    ])
    expect(result).toEqual({
      status: "unmatched",
      reason: "ambiguous_calendar_event_id",
    })
  })
})
