import { z } from "zod"
const ContactSchema = z.object({
  contact: z.object({
    id: z.string(),
    locationId: z.string(),
    email: z.email(),
    firstName: z.string(),
    lastName: z.string(),
  }),
})
const OpportunitySchema = z.object({
  opportunity: z.object({
    id: z.string(),
    locationId: z.string(),
    contactId: z.string(),
    pipelineId: z.string(),
  }),
})
const AppointmentsSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      calendarId: z.string(),
      assignedUserId: z.string(),
      status: z.string(),
    })
  ),
})
export function verifyJourneyIdentity(
  input: {
    contactId: string
    opportunityId: string
    appointmentId: string
    ownerId: string
    email: string
  },
  config: {
    locationId: string
    pipelineId: string
    salesCalendarIds: string[]
  },
  evidence: { contact: unknown; opportunity: unknown; appointments: unknown }
) {
  const c = ContactSchema.parse(evidence.contact).contact,
    o = OpportunitySchema.parse(evidence.opportunity).opportunity
  const matches = AppointmentsSchema.parse(evidence.appointments).events.filter(
    (e) => e.id === input.appointmentId
  )
  if (
    c.id !== input.contactId ||
    c.locationId !== config.locationId ||
    c.email.toLowerCase() !== input.email.toLowerCase()
  )
    throw new Error("journey_contact_mismatch")
  if (
    o.id !== input.opportunityId ||
    o.locationId !== config.locationId ||
    o.contactId !== c.id ||
    o.pipelineId !== config.pipelineId
  )
    throw new Error("journey_opportunity_mismatch")
  if (
    matches.length !== 1 ||
    !config.salesCalendarIds.includes(matches[0].calendarId) ||
    matches[0].assignedUserId !== input.ownerId ||
    ["cancelled", "canceled", "invalid", "noshow", "no_show"].includes(
      matches[0].status.toLowerCase()
    )
  )
    throw new Error("journey_appointment_mismatch")
  const name = [c.firstName.trim(), c.lastName.trim()].filter(Boolean).join(" ")
  if (!c.firstName.trim() || !c.lastName.trim())
    throw new Error("owner_name_confirmation_required")
  return { email: c.email.toLowerCase(), name }
}
