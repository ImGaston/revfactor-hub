import { describe, expect, it, vi } from "vitest"
import { SupabaseGranolaPersistence } from "@/lib/granola/store.server"

describe("SupabaseGranolaPersistence", () => {
  it("queries only explicitly eligible appointments and labels them sales", async () => {
    const predicates: Array<[string, unknown]> = []
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((field: string, value: unknown) => {
        predicates.push([field, value])
        return builder
      }),
      limit: vi.fn(async () => ({
        data: [
          {
            appointment_id: "appointment-1",
            calendar_event_id: "event-1",
            rep_email: "rep@example.com",
            scheduled_start_at: "2026-09-01T14:00:00Z",
            attendee_emails: ["lead@example.com"],
          },
        ],
        error: null,
      })),
    }
    const client = { from: vi.fn(() => builder) }
    const persistence = new SupabaseGranolaPersistence(client as never)

    const appointments = await persistence.findEligibleSalesAppointments({
      sourceId: "rep-one",
      calendarEventId: "event-1",
      repEmail: "rep@example.com",
      scheduledStartAt: "2026-09-01T14:00:00Z",
      attendeeEmails: ["lead@example.com"],
    })

    expect(predicates).toContainEqual(["eligible_for_granola_import", true])
    expect(predicates).toContainEqual(["rep_email", "rep@example.com"])
    expect(appointments).toEqual([
      {
        id: "appointment-1",
        kind: "revfactor_sales",
        calendarEventId: "event-1",
        repEmail: "rep@example.com",
        scheduledStartAt: "2026-09-01T14:00:00Z",
        attendeeEmails: ["lead@example.com"],
      },
    ])
  })

  it("does not claim a unique match when fallback candidates were truncated", async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue({
          data: Array.from({ length: 25 }, (_, i) => ({
            appointment_id: `appointment-${i}`,
            calendar_event_id: null,
            rep_email: "rep@example.com",
            scheduled_start_at: "2026-09-01T14:00:00Z",
            attendee_emails: ["lead@example.com"],
          })),
          error: null,
        }),
    }
    const persistence = new SupabaseGranolaPersistence({
      from: () => builder,
    } as never)
    await expect(
      persistence.findEligibleSalesAppointments({
        sourceId: "rep",
        calendarEventId: null,
        repEmail: "rep@example.com",
        scheduledStartAt: "2026-09-01T14:00:00Z",
        attendeeEmails: ["lead@example.com"],
      })
    ).rejects.toThrow("Granola appointment candidates truncated")
  })

  it("stores only the internal summary projection and drops an unsafe URL", async () => {
    const writes: unknown[] = []
    const builder = {
      upsert: vi.fn(async (value: unknown) => {
        writes.push(value)
        return { error: null }
      }),
    }
    const client = { from: vi.fn(() => builder) }
    const persistence = new SupabaseGranolaPersistence(client as never)

    await persistence.upsertInternalSummary({
      sourceId: "rep-one",
      appointmentId: "appointment-1",
      noteId: "note-1",
      noteUpdatedAt: "2026-09-01T15:00:00Z",
      sourceUrl: "https://attacker.example/private",
      summaryText: "Safe summary",
      summaryMarkdown: null,
    })

    expect(client.from).toHaveBeenCalledWith("granola_appointment_summaries")
    expect(writes[0]).toMatchObject({
      appointment_id: "appointment-1",
      source_url: null,
      summary_text: "Safe summary",
    })
    expect(writes[0]).not.toHaveProperty("transcript")
    expect(writes[0]).not.toHaveProperty("private_notes_text")
  })
})
