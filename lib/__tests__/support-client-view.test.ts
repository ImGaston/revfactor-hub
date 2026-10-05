import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  SUPPORT_CONTEXT_IN_FLIGHT_STATUSES,
  loadSupportClientContext,
} from "@/lib/support-client-context.server"
import {
  awaitingOurReply,
  clientGaps,
  clientOpenPromises,
  compareClientGroups,
  groupTicketsByClient,
  isPropertyValidated,
  type SupportClientGroup,
} from "@/lib/support-client-view"
import { supportStats, type SupportTicket, type SupportTicketCommitment } from "@/lib/support-tickets"

const NOW = new Date("2026-10-05T12:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

let seq = 0
function ticket(patch: Partial<SupportTicket> = {}): SupportTicket {
  seq += 1
  const clientId = patch.client_id ?? "c-acme"
  return {
    id: `t${seq}`,
    ticket_number: seq,
    client_id: clientId,
    property_scope: "listings",
    property_validated_at: hoursAgo(1),
    category: "pricing",
    request_type: "question",
    summary: "Ask",
    client_message: null,
    requested_by_name: null,
    requested_at: hoursAgo(2),
    time_window: null,
    source: "assembly",
    source_message_id: null,
    external_key: null,
    needs_attachment_review: false,
    status: "open",
    priority: "medium",
    priority_source: "rule",
    client_sentiment: "neutral",
    money_at_stake: false,
    hand_managed: false,
    assignee_id: null,
    possible_duplicate_of: null,
    merged_into: null,
    first_response_at: null,
    // Asked 2h ago, no reply yet: the reply clock is running but not overdue
    last_client_message_at: hoursAgo(2),
    last_team_message_at: null,
    sla_anchor_at: null,
    client_chase_count: 0,
    client_nudge_count: 0,
    answer_summary: null,
    answered_at: null,
    answer_check_verdict: null,
    answer_check_asked: null,
    answer_check_replied: null,
    answer_check_gap: null,
    answer_check_at: null,
    client_told_live_at: null,
    client_acknowledged_at: null,
    verification: {},
    resolved_at: null,
    dismiss_reason: null,
    dismiss_note: null,
    backfilled: false,
    backfill_batch: null,
    ai_classification: {},
    created_at: hoursAgo(2),
    updated_at: hoursAgo(1),
    clients: { id: clientId, name: clientId === "c-acme" ? "Acme" : clientId },
    assignee: null,
    support_ticket_listings: [],
    support_ticket_commitments: [],
    adjustments: [],
    ...patch,
  } as SupportTicket
}

function promise(patch: Partial<SupportTicketCommitment> = {}): SupportTicketCommitment {
  seq += 1
  return {
    id: `p${seq}`,
    ticket_id: "t",
    description: "Send the report",
    due_at: hoursAgo(-24),
    due_source: "explicit",
    rescheduled_to: null,
    status: "open",
    made_by_name: "Fede",
    made_at: hoursAgo(30),
    source: "bot",
    closed_at: null,
    close_note: null,
    created_at: hoursAgo(30),
    ...patch,
  } as SupportTicketCommitment
}

const replied = { last_client_message_at: hoursAgo(5), last_team_message_at: hoursAgo(4) }
const fede = { assignee_id: "u-fede", assignee: { full_name: "Fede Z", email: "f@x.test" } }
const gaston = { assignee_id: "u-gaston", assignee: { full_name: "Gaston R", email: "g@x.test" } }

describe("groupTicketsByClient", () => {
  // Acme: one overdue promise ticket + one in triage
  const acmeOverdue = ticket({
    client_id: "c-acme",
    ...replied,
    ...fede,
    requested_at: hoursAgo(72),
    support_ticket_commitments: [promise({ due_at: hoursAgo(24) }), promise({ due_at: hoursAgo(-48) })],
  })
  const acmeTriage = ticket({ client_id: "c-acme", status: "new", requested_at: hoursAgo(3) })
  // Cedar: one ticket overdue on the 24h reply clock
  const cedar = ticket({
    client_id: "c-cedar",
    clients: { id: "c-cedar", name: "Cedar" },
    ...gaston,
    last_client_message_at: hoursAgo(30),
    requested_at: hoursAgo(30),
  })
  // Birch: three open, nothing overdue
  const birch = [
    ticket({ client_id: "c-birch", clients: { id: "c-birch", name: "Birch" }, ...replied, requested_at: hoursAgo(10) }),
    ticket({ client_id: "c-birch", clients: { id: "c-birch", name: "Birch" }, status: "awaiting_client", ...replied }),
    ticket({ client_id: "c-birch", clients: { id: "c-birch", name: "Birch" }, status: "answered", ...replied, ...fede }),
  ]
  // Elm: three open, nothing overdue, an older ask than Birch
  const elm = [0, 1, 2].map(() =>
    ticket({ client_id: "c-elm", clients: { id: "c-elm", name: "Elm" }, ...replied, requested_at: hoursAgo(40) })
  )
  // Dune: only closed tickets
  const dune = ticket({ client_id: "c-dune", status: "resolved", resolved_at: hoursAgo(1) })

  const groups = groupTicketsByClient([birch[0], acmeTriage, dune, cedar, ...elm, acmeOverdue, birch[1], birch[2]], NOW)

  it("makes one group per client with an open ticket, leaving closed tickets out", () => {
    expect(groups.map((g) => g.clientName)).not.toContain("c-dune")
    expect(groups).toHaveLength(4)
    expect(groups.flatMap((g) => g.tickets).every((t) => t.status !== "resolved")).toBe(true)
  })

  it("sorts most open tickets first, then most overdue, then the oldest ask", () => {
    // Elm and Birch tie on 3 open and 0 overdue; Elm's oldest ask is older.
    // Acme (2 open) comes before Cedar (1 open) even though both have 1 overdue.
    expect(groups.map((g) => g.clientId)).toEqual(["c-elm", "c-birch", "c-acme", "c-cedar"])
  })

  it("puts more open tickets ahead of more overdue ones", () => {
    const busy: SupportClientGroup = {
      clientId: "busy",
      clientName: "Busy",
      tickets: [],
      open: 5,
      overdue: 0,
      triage: 0,
      awaitingClient: 0,
      overduePromises: 0,
      oldestAskAt: hoursAgo(5),
      owners: [],
    }
    const late = { ...busy, clientId: "late", clientName: "Late", open: 2, overdue: 2 }
    expect([late, busy].sort(compareClientGroups).map((g) => g.clientId)).toEqual(["busy", "late"])
  })

  it("breaks full ties by name", () => {
    const base: SupportClientGroup = {
      clientId: "b",
      clientName: "Zed",
      tickets: [],
      open: 1,
      overdue: 0,
      triage: 0,
      awaitingClient: 0,
      overduePromises: 0,
      oldestAskAt: hoursAgo(5),
      owners: [],
    }
    const other = { ...base, clientId: "a", clientName: "alpha" }
    expect([base, other].sort(compareClientGroups).map((g) => g.clientName)).toEqual(["alpha", "Zed"])
  })

  it("counts the header chips with the queue's own rules", () => {
    const acme = groups.find((g) => g.clientId === "c-acme")!
    expect(acme).toMatchObject({
      clientName: "Acme",
      open: 2,
      overdue: 1,
      triage: 1,
      awaitingClient: 0,
      overduePromises: 1,
      oldestAskAt: hoursAgo(72),
      owners: ["Fede", "Unassigned"],
    })
    // Queue order inside a group: triage, then overdue
    expect(acme.tickets.map((t) => t.id)).toEqual([acmeTriage.id, acmeOverdue.id])

    const birchGroup = groups.find((g) => g.clientId === "c-birch")!
    expect(birchGroup).toMatchObject({ open: 3, overdue: 0, triage: 0, awaitingClient: 1, overduePromises: 0 })
    expect(birchGroup.owners).toEqual(["Fede", "Unassigned"])

    expect(groups.find((g) => g.clientId === "c-cedar")!).toMatchObject({ overdue: 1, owners: ["Gaston"] })
  })

  it("agrees with the header Overdue stat", () => {
    const all = [birch[0], acmeTriage, cedar, ...elm, acmeOverdue, birch[1], birch[2]]
    const stats = supportStats(all, [], { sentBack30d: 0, clientRejected30d: 0 }, NOW)
    expect(groups.reduce((sum, g) => sum + g.overdue, 0)).toBe(stats.overdue)
  })

  it("respects the owner filter by grouping only what it is given", () => {
    const fedeOnly = [acmeOverdue, acmeTriage, cedar, ...birch].filter((t) => t.assignee_id === "u-fede")
    const filtered = groupTicketsByClient(fedeOnly, NOW)
    expect(filtered.map((g) => [g.clientId, g.open])).toEqual([
      ["c-acme", 1],
      ["c-birch", 1],
    ])
    expect(filtered[0].owners).toEqual(["Fede"])
  })

  it("returns no groups when nothing is open", () => {
    expect(groupTicketsByClient([dune], NOW)).toEqual([])
  })
})

describe("client gaps", () => {
  it("applies the reply-clock rule for 'no reply yet'", () => {
    expect(awaitingOurReply(ticket())).toBe(true)
    expect(awaitingOurReply(ticket(replied))).toBe(false)
    expect(awaitingOurReply(ticket({ status: "awaiting_client" }))).toBe(false)
    expect(awaitingOurReply(ticket({ status: "resolved" }))).toBe(false)
    // A check-in starts with our outreach: no clock until the client writes
    expect(awaitingOurReply(ticket({ request_type: "check_in", last_client_message_at: null }))).toBe(false)
    // Any other ask with no recorded message falls back to the ask itself
    expect(awaitingOurReply(ticket({ last_client_message_at: null }))).toBe(true)
    // A client message after our reply reopens it
    expect(awaitingOurReply(ticket({ last_client_message_at: hoursAgo(1), last_team_message_at: hoursAgo(3) }))).toBe(true)
  })

  it("counts every gap and links its tickets", () => {
    const noReply = ticket({ requested_at: hoursAgo(9) })
    const twoLatePromises = ticket({
      ...replied,
      requested_at: hoursAgo(50),
      support_ticket_commitments: [
        promise({ due_at: hoursAgo(5) }),
        promise({ due_at: hoursAgo(1) }),
        promise({ due_at: hoursAgo(-5) }),
        promise({ due_at: hoursAgo(10), status: "kept", closed_at: hoursAgo(11) }),
      ],
    })
    const triage = ticket({ status: "new", ...replied })
    const verify = ticket({ status: "answered", ...replied, answered_at: hoursAgo(1) })
    const notTold = ticket({
      status: "answered",
      ...replied,
      request_type: "change",
      adjustments: [{ id: "a1", type: "x", status: "controlled", target_value: null, controlled_at: hoursAgo(2), listings: null }],
    })
    const waiting = ticket({ status: "awaiting_client" })
    const closed = ticket({ status: "resolved", support_ticket_commitments: [promise({ due_at: hoursAgo(5) })] })

    const gaps = clientGaps([noReply, twoLatePromises, triage, verify, notTold, waiting, closed], NOW)
    const byKey = Object.fromEntries(gaps.map((g) => [g.key, g]))

    expect(gaps.map((g) => g.key)).toEqual(["noReply", "overduePromises", "triage", "toVerify", "doneNotTold"])
    expect(byKey.noReply.tickets.map((t) => t.id)).toEqual([noReply.id])
    expect(byKey.overduePromises.count).toBe(2)
    expect(byKey.overduePromises.tickets.map((t) => t.id)).toEqual([twoLatePromises.id])
    expect(byKey.triage.tickets.map((t) => t.id)).toEqual([triage.id])
    expect(byKey.toVerify.tickets.map((t) => t.id).sort()).toEqual([notTold.id, verify.id].sort())
    expect(byKey.doneNotTold.tickets.map((t) => t.id)).toEqual([notTold.id])

    // Same numbers as the header stats for the same tickets
    const stats = supportStats([noReply, twoLatePromises, triage, verify, notTold, waiting, closed], [], { sentBack30d: 0, clientRejected30d: 0 }, NOW)
    expect(byKey.toVerify.count).toBe(stats.toVerify)
    expect(byKey.doneNotTold.count).toBe(stats.doneNotTold)
  })

  it("is all zero for a client with nothing open", () => {
    const gaps = clientGaps([ticket({ status: "resolved" })], NOW)
    expect(gaps.every((g) => g.count === 0 && g.tickets.length === 0)).toBe(true)
  })

  it("lists open promises soonest first, with overdue and likely-kept flags", () => {
    const late = promise({ due_at: hoursAgo(3), made_at: hoursAgo(20) })
    const rescheduled = promise({ due_at: hoursAgo(10), rescheduled_to: hoursAgo(-10) })
    const t1 = ticket({
      support_ticket_commitments: [rescheduled, promise({ status: "cancelled" })],
    })
    const t2 = ticket({
      support_ticket_commitments: [late],
      adjustments: [{ id: "a2", type: "x", status: "controlled", target_value: null, controlled_at: hoursAgo(5), listings: null }],
    })
    const closed = ticket({ status: "dismissed", dismiss_reason: "duplicate", support_ticket_commitments: [promise()] })

    const promises = clientOpenPromises([t1, t2, closed], NOW)
    expect(promises.map((p) => p.commitment.id)).toEqual([late.id, rescheduled.id])
    expect(promises[0]).toMatchObject({ overdue: true, likelyKept: true, dueAt: late.due_at })
    expect(promises[1]).toMatchObject({ overdue: false, likelyKept: false, dueAt: rescheduled.rescheduled_to })
  })

  it("treats a property as validated only when confirmed and not unknown", () => {
    expect(isPropertyValidated(ticket())).toBe(true)
    expect(isPropertyValidated(ticket({ property_validated_at: null }))).toBe(false)
    expect(isPropertyValidated(ticket({ property_scope: "unknown" }))).toBe(false)
    expect(isPropertyValidated(ticket({ property_scope: "portfolio" }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Context loader, against a recording fake of the Supabase client
// ---------------------------------------------------------------------------

type Call = { method: string; args: unknown[] }
type Query = { table: string; calls: Call[] }
type Result = { data: unknown[] | null; error: { message: string } | null }

const arg = (q: Query, method: string) => q.calls.find((c) => c.method === method)?.args
const calls = (q: Query, method: string) => q.calls.filter((c) => c.method === method).map((c) => c.args)

function fakeSupabase(resolve: (q: Query) => Result) {
  const queries: Query[] = []
  const client = {
    from(table: string) {
      const query: Query = { table, calls: [] }
      queries.push(query)
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              return (onFulfilled: (r: Result) => unknown, onRejected: (e: unknown) => unknown) =>
                Promise.resolve(resolve(query)).then(onFulfilled, onRejected)
            }
            return (...args: unknown[]) => {
              query.calls.push({ method: String(prop), args })
              return builder
            }
          },
        }
      )
      return builder
    },
  }
  return { supabase: client as unknown as SupabaseClient, queries }
}

const CLIENT = "7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f"
const adjustment = (id: string, status: string) => ({
  id,
  type: "min_price",
  status,
  origin: "internal",
  urgency: "medium",
  date_from: "2026-10-10",
  date_to: "2026-10-12",
  created_at: hoursAgo(10),
  resolved_at: null,
  controlled_at: status === "controlled" ? hoursAgo(5) : null,
  support_ticket_id: null,
  listings: { name: "Casa Azul | AZ | Fede" },
})

function contextResolver(overrides: { adjustments?: Result; listings?: Result } = {}) {
  return (q: Query): Result => {
    if (q.table === "listings")
      return overrides.listings ?? { data: [{ id: "l1", name: "Casa Azul", status: "active" }], error: null }
    if (q.table === "adjustments") {
      if (overrides.adjustments) return overrides.adjustments
      const controlled = calls(q, "eq").some((a) => a[0] === "status" && a[1] === "controlled")
      return { data: [adjustment(controlled ? "a-done" : "a-open", controlled ? "controlled" : "needs_info")], error: null }
    }
    if (q.table === "support_tickets") {
      const column = String(arg(q, "order")?.[0])
      return {
        data: [{ id: "t-9", ticket_number: 9, at: column === "last_client_message_at" ? hoursAgo(3) : hoursAgo(1) }],
        error: null,
      }
    }
    return { data: [], error: null }
  }
}

describe("loadSupportClientContext", () => {
  it("reads listings, both Adjustments lists, and the latest messages for the client", async () => {
    const { supabase, queries } = fakeSupabase(contextResolver())
    const context = await loadSupportClientContext(supabase, CLIENT, NOW, { listings: true, adjustments: true })

    expect(queries.map((q) => q.table).sort()).toEqual(
      ["adjustments", "adjustments", "listings", "support_tickets", "support_tickets"].sort()
    )
    expect(queries.map((q) => q.table)).not.toContain("clients")
    for (const q of queries) expect(calls(q, "eq")).toContainEqual(["client_id", CLIENT])

    const [inFlight, controlled] = queries.filter((q) => q.table === "adjustments")
    expect(arg(inFlight, "in")).toEqual(["status", SUPPORT_CONTEXT_IN_FLIGHT_STATUSES])
    expect(SUPPORT_CONTEXT_IN_FLIGHT_STATUSES).toEqual(
      expect.arrayContaining(["open", "needs_info", "in_progress", "issue", "resolved"])
    )
    expect(SUPPORT_CONTEXT_IN_FLIGHT_STATUSES).not.toContain("controlled")
    expect(calls(controlled, "eq")).toContainEqual(["status", "controlled"])
    expect(arg(controlled, "gte")).toEqual(["controlled_at", new Date(NOW.getTime() - 30 * 86_400_000).toISOString()])
    // Never the request text or the requester
    for (const q of [inFlight, controlled]) {
      expect(String(arg(q, "select")?.[0])).not.toMatch(/origin_message|requested_by|public_token/)
    }

    expect(context.listings).toEqual([{ id: "l1", name: "Casa Azul", status: "active" }])
    expect(context.adjustments?.inFlight.map((a) => a.id)).toEqual(["a-open"])
    expect(context.adjustments?.recentlyControlled.map((a) => a.id)).toEqual(["a-done"])
    expect(context.lastClientMessage).toEqual({ at: hoursAgo(3), ticketId: "t-9", ticketNumber: 9 })
    expect(context.lastTeamMessage).toEqual({ at: hoursAgo(1), ticketId: "t-9", ticketNumber: 9 })
  })

  it("skips the Adjustments read without adjustments:view and hides the section", async () => {
    const { supabase, queries } = fakeSupabase(contextResolver())
    const context = await loadSupportClientContext(supabase, CLIENT, NOW, { listings: true, adjustments: false })
    expect(queries.map((q) => q.table)).not.toContain("adjustments")
    expect(context.adjustments).toBeNull()
    expect(context.listings).not.toBeNull()
  })

  it("hides the Adjustments section quietly when RLS or the read errors", async () => {
    const { supabase } = fakeSupabase(
      contextResolver({ adjustments: { data: null, error: { message: "permission denied for table adjustments" } } })
    )
    const context = await loadSupportClientContext(supabase, CLIENT, NOW, { listings: true, adjustments: true })
    expect(context.adjustments).toBeNull()
    expect(context.lastClientMessage).not.toBeNull()
  })

  it("skips listings without read access and hides them on error", async () => {
    const skipped = fakeSupabase(contextResolver())
    const noAccess = await loadSupportClientContext(skipped.supabase, CLIENT, NOW, { listings: false, adjustments: false })
    expect(skipped.queries.map((q) => q.table)).toEqual(["support_tickets", "support_tickets"])
    expect(noAccess.listings).toBeNull()

    const failing = fakeSupabase(contextResolver({ listings: { data: null, error: { message: "boom" } } }))
    const failed = await loadSupportClientContext(failing.supabase, CLIENT, NOW, { listings: true, adjustments: false })
    expect(failed.listings).toBeNull()
  })

  it("reads the latest messages across every ticket, closed ones included", async () => {
    const { supabase, queries } = fakeSupabase(contextResolver())
    await loadSupportClientContext(supabase, CLIENT, NOW, { listings: false, adjustments: false })
    for (const q of queries.filter((q) => q.table === "support_tickets")) {
      expect(arg(q, "in")).toBeUndefined()
      const column = String(arg(q, "order")?.[0])
      expect(arg(q, "not")).toEqual([column, "is", null])
      expect(arg(q, "order")?.[1]).toEqual({ ascending: false })
      expect(arg(q, "limit")).toEqual([1])
    }
  })

  it("returns no message when none is recorded", async () => {
    const { supabase } = fakeSupabase((q) =>
      q.table === "support_tickets" ? { data: [], error: null } : { data: [], error: null }
    )
    const context = await loadSupportClientContext(supabase, CLIENT, NOW, { listings: false, adjustments: false })
    expect(context.lastClientMessage).toBeNull()
    expect(context.lastTeamMessage).toBeNull()
  })
})
