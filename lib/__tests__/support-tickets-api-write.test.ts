import type { SupabaseClient } from "@supabase/supabase-js"
import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

let updateSupportTicketForApi: typeof import("@/lib/support-tickets.server").updateSupportTicketForApi

beforeAll(async () => {
  ;({ updateSupportTicketForApi } = await import("@/lib/support-tickets.server"))
})

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  ticket_number: 42,
  status: "open",
  merged_into: null,
  hand_managed: false,
  client_id: "22222222-2222-4222-8222-222222222222",
}

function fakeAdmin(
  ticket: typeof row | null,
  rpcResult: { data: unknown; error: { message: string } | null },
  priorEvent: { id: string; ticket_id: string } | null = null
) {
  const eventEq = vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: priorEvent, error: null }) }))
  const ticketEq = vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: ticket, error: null }) }))
  const select = vi.fn(() => ({ eq: ticketEq }))
  const from = vi.fn((table: string) =>
    table === "support_ticket_events" ? { select: vi.fn(() => ({ eq: eventEq })) } : { select }
  )
  const rpc = vi.fn().mockResolvedValue(rpcResult)
  return { admin: { from, rpc } as unknown as SupabaseClient, rpc, select, eventEq }
}

describe("updateSupportTicketForApi", () => {
  it("returns 404 before calling the RPC", async () => {
    const fake = fakeAdmin(null, { data: null, error: null })
    await expect(updateSupportTicketForApi(fake.admin, row.id, { note: "Checked" }, { keyId: "key-id" })).resolves.toEqual({
      status: 404,
      body: { error: "No support ticket with this id" },
    })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it("returns the public success shape and passes normalized RPC args", async () => {
    const fake = fakeAdmin(row, {
      data: { ...row, ticket_id: row.id, event_id: "event-id", previous_status: "open", status: "in_progress", replayed: false },
      error: null,
    })
    const result = await updateSupportTicketForApi(
      fake.admin,
      row.id,
      { note: "  Started work  ", status: "in_progress", actor_label: "Martín", idempotency_key: "sweep:42" },
      { keyId: "33333333-3333-4333-8333-333333333333" }
    )
    expect(fake.select).toHaveBeenCalledWith("id, ticket_number, status, merged_into, hand_managed, client_id")
    expect(fake.rpc).toHaveBeenCalledWith("apply_support_ticket_bot_update", expect.objectContaining({
      p_actor_label: "Bot: Martín",
      p_api_key_id: "33333333-3333-4333-8333-333333333333",
      p_external_key: "api:33333333-3333-4333-8333-333333333333:sweep:42",
      p_note: "Started work",
      p_status: "in_progress",
    }))
    expect(result).toEqual({
      status: 200,
      body: { ticket_id: row.id, ticket_number: 42, status: "in_progress", previous_status: "open", event_id: "event-id", replayed: false },
    })
  })

  it.each([
    ["Ticket not found", 404],
    ["This ticket was merged; change the ticket it was merged into", 409],
    ["The ticket is already in that status; add a note instead", 409],
    ["This ticket is hand-managed; only a person can change its status", 409],
    ["Add a note (3 to 1,000 characters)", 400],
    ["Pick a reason for dismissing", 400],
  ])("maps database error %s to %i", async (message, status) => {
    const fake = fakeAdmin(row, { data: null, error: { message } })
    const result = await updateSupportTicketForApi(fake.admin, row.id, { note: "Valid note", status: "resolved" }, { keyId: "key-id" })
    expect(result.status).toBe(status)
  })

  it("throws unknown database errors", async () => {
    const fake = fakeAdmin(row, { data: null, error: { message: "connection failed" } })
    await expect(updateSupportTicketForApi(fake.admin, row.id, { note: "Valid note" }, { keyId: "key-id" })).rejects.toThrow("connection failed")
  })
  it("replays a retried request before the same-status check", async () => {
    const fake = fakeAdmin({ ...row, status: "resolved" }, { data: null, error: null }, { id: "event-id", ticket_id: row.id })
    const result = await updateSupportTicketForApi(
      fake.admin,
      row.id,
      { note: "Closed after approval", status: "closed", idempotency_key: "sweep:42" },
      { keyId: "key-id" }
    )
    expect(fake.eventEq).toHaveBeenCalledWith("external_key", "api:key-id:sweep:42")
    expect(fake.rpc).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 200,
      body: { ticket_id: row.id, ticket_number: 42, status: "resolved", previous_status: "resolved", event_id: "event-id", replayed: true },
    })
  })

  it("refuses an idempotency key already used on another ticket", async () => {
    const other = "44444444-4444-4444-8444-444444444444"
    const fake = fakeAdmin(row, { data: null, error: null }, { id: "event-id", ticket_id: other })
    const result = await updateSupportTicketForApi(fake.admin, row.id, { note: "Checked", idempotency_key: "sweep:42" }, { keyId: "key-id" })
    expect(result.status).toBe(409)
    expect(fake.rpc).not.toHaveBeenCalled()
  })
})
