import { describe, it, expect } from "vitest"
import { verifyJourneyIdentity } from "@/lib/ghl-onboarding-v1/identity"
const input = {
  contactId: "contact",
  opportunityId: "opp",
  appointmentId: "call",
  ownerId: "rep",
  email: "owner@example.invalid",
}
const config = {
  locationId: "location",
  pipelineId: "sales",
  salesCalendarIds: ["calendar"],
}
function evidence() {
  return {
    contact: {
      contact: {
        id: "contact",
        locationId: "location",
        email: "Owner@example.invalid",
        firstName: "Test",
        lastName: "Owner",
      },
    },
    opportunity: {
      opportunity: {
        id: "opp",
        contactId: "contact",
        locationId: "location",
        pipelineId: "sales",
      },
    },
    appointments: {
      events: [
        {
          id: "call",
          assignedUserId: "rep",
          calendarId: "calendar",
          status: "showed",
        },
      ],
    },
  }
}
describe("provider-bound onboarding owner", () => {
  it("takes invitation email/name only from the verified CRM contact", () => {
    expect(verifyJourneyIdentity(input, config, evidence())).toEqual({
      email: "owner@example.invalid",
      name: "Test Owner",
    })
  })
  it("rejects webhook email substitution", () => {
    expect(() =>
      verifyJourneyIdentity(
        { ...input, email: "other@example.invalid" },
        config,
        evidence()
      )
    ).toThrow("journey_contact_mismatch")
  })
  it("rejects opportunities from another contact, location or pipeline", () => {
    for (const key of ["contactId", "locationId", "pipelineId"] as const) {
      const e = evidence()
      e.opportunity.opportunity[key] = "other"
      expect(() => verifyJourneyIdentity(input, config, e)).toThrow(
        "journey_opportunity_mismatch"
      )
    }
  })
  it("rejects foreign appointment, non-sales calendar, wrong rep or cancellation", () => {
    for (const [key, value] of [
      ["id", "other"],
      ["calendarId", "other"],
      ["assignedUserId", "other"],
      ["status", "cancelled"],
    ] as const) {
      const e = evidence()
      e.appointments.events[0][key] = value
      expect(() => verifyJourneyIdentity(input, config, e)).toThrow(
        "journey_appointment_mismatch"
      )
    }
  })
  it("does not guess a family name for portal creation", () => {
    const e = evidence()
    e.contact.contact.lastName = ""
    expect(() => verifyJourneyIdentity(input, config, e)).toThrow(
      "owner_name_confirmation_required"
    )
  })
})
