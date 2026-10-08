import { describe, expect, it } from "vitest"

import { prepareSupportTicketUpdate, supportTicketUpdateSchema } from "@/lib/support-api-write"

const ticket = { status: "open" as const, merged_into: null, hand_managed: false }

describe("supportTicketUpdateSchema", () => {
  it("rejects unknown keys, new status, and invalid idempotency keys", () => {
    expect(supportTicketUpdateSchema.safeParse({ note: "Useful note", extra: true }).success).toBe(false)
    expect(supportTicketUpdateSchema.safeParse({ note: "Useful note", status: "new" }).success).toBe(false)
    expect(supportTicketUpdateSchema.safeParse({ note: "Useful note", idempotency_key: "bad key" }).success).toBe(
      false
    )
    expect(supportTicketUpdateSchema.safeParse({ note: "Useful note", idempotency_key: "sweep:ticket_1-v2" }).success).toBe(
      true
    )
  })
})

describe("prepareSupportTicketUpdate", () => {
  it("allows a note-only update", () => {
    expect(prepareSupportTicketUpdate({ note: "  Checked the account  " }, ticket)).toMatchObject({
      ok: true,
      value: { note: "Checked the account", status: null, actorLabel: "Bot: Support API bot" },
    })
  })

  it("requires a note for status and aliases closed to resolved", () => {
    expect(prepareSupportTicketUpdate({ status: "resolved" }, ticket)).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining("Add a note"),
    })
    expect(prepareSupportTicketUpdate({ status: "closed", note: "Approved close" }, ticket)).toMatchObject({
      ok: true,
      value: { status: "resolved" },
    })
  })

  it("enforces dismissal and answer-summary pairing", () => {
    expect(prepareSupportTicketUpdate({ status: "dismissed", note: "Not an ask" }, ticket)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Pick a reason"),
    })
    expect(prepareSupportTicketUpdate({ note: "Still open", dismiss_reason: "not_an_ask" }, ticket)).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(prepareSupportTicketUpdate({ note: "Still open", answer_summary: "Answer sent" }, ticket)).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(
      prepareSupportTicketUpdate(
        { status: "answered", note: "Reply sent", answer_summary: "The requested answer" },
        ticket
      )
    ).toMatchObject({ ok: true, value: { answerSummary: "The requested answer" } })
  })

  it("rejects credentials without echoing them", () => {
    const result = prepareSupportTicketUpdate({ note: "Reset it with pw: hunter22" }, ticket)
    expect(result).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("Remove the") })
    if (!result.ok) expect(result.error).not.toContain("hunter22")
  })

  it("blocks merged, no-op, and hand-managed status changes", () => {
    expect(
      prepareSupportTicketUpdate({ note: "Close it", status: "resolved" }, { ...ticket, merged_into: "other" })
    ).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("was merged") })
    expect(prepareSupportTicketUpdate({ note: "No change", status: "open" }, ticket)).toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining("already in that status"),
    })
    const handManaged = { ...ticket, hand_managed: true }
    expect(prepareSupportTicketUpdate({ note: "Move it", status: "in_progress" }, handManaged)).toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining("hand-managed"),
    })
    expect(prepareSupportTicketUpdate({ note: "Human is handling this" }, handManaged)).toMatchObject({ ok: true })
  })

  it("prefixes, trims, and bounds actor labels", () => {
    expect(prepareSupportTicketUpdate({ note: "Checked", actor_label: "  Martín  " }, ticket)).toMatchObject({
      ok: true,
      value: { actorLabel: "Bot: Martín" },
    })
    const result = prepareSupportTicketUpdate({ note: "Checked", actor_label: "x".repeat(80) }, ticket)
    expect(result.ok && result.value.actorLabel).toHaveLength(85)
  })
})
