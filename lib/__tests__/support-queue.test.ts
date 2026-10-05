import { describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  SUPPORT_CLIENT_CLOSED_CAP,
  SUPPORT_RECENT_CLOSED_LIMIT,
  buildSupportClientOptions,
  countOpenTicketsByClient,
  parseSupportQueueParams,
  supportQueueHref,
} from "@/lib/support-queue"
import { loadSupportQueue } from "@/lib/support-queue.server"
import { SUPPORT_ACTIVE_STATUSES, SUPPORT_CLOSED_STATUSES, supportStats } from "@/lib/support-tickets"

const CLIENT = "7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f"
const OTHER = "0a0b0c0d-1e1f-4a2b-9c3d-4e5f6a7b8c9d"

describe("parseSupportQueueParams", () => {
  it("reads a uuid client and the closed toggle", () => {
    expect(parseSupportQueueParams({ client: CLIENT })).toEqual({ clientId: CLIENT, showClosed: false })
    expect(parseSupportQueueParams({ client: CLIENT, closed: "1" })).toEqual({
      clientId: CLIENT,
      showClosed: true,
    })
  })

  it("normalizes case and surrounding whitespace", () => {
    expect(parseSupportQueueParams({ client: `  ${CLIENT.toUpperCase()} ` }).clientId).toBe(CLIENT)
  })

  it("takes the first value when a param repeats", () => {
    expect(parseSupportQueueParams({ client: [CLIENT, OTHER], closed: ["1", "0"] })).toEqual({
      clientId: CLIENT,
      showClosed: true,
    })
  })

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a name", "Acme Rentals"],
    ["a truncated uuid", CLIENT.slice(0, 30)],
    ["a uuid with a suffix", `${CLIENT}x`],
    ["a filter injection", `${CLIENT},status.eq.resolved`],
    ["a quoted uuid", `'${CLIENT}'`],
  ])("ignores %s as the client", (_label, client) => {
    expect(parseSupportQueueParams({ client, closed: "1" })).toEqual({ clientId: null, showClosed: false })
  })

  it("only treats closed=1 as on, and only with a client", () => {
    expect(parseSupportQueueParams({ closed: "1" }).showClosed).toBe(false)
    for (const closed of ["true", "yes", "0", ""]) {
      expect(parseSupportQueueParams({ client: CLIENT, closed }).showClosed).toBe(false)
    }
  })
})

describe("supportQueueHref", () => {
  it("round-trips through the parser", () => {
    expect(supportQueueHref({ clientId: null, showClosed: false })).toBe("/support")
    expect(supportQueueHref({ clientId: CLIENT, showClosed: false })).toBe(`/support?client=${CLIENT}`)
    const href = supportQueueHref({ clientId: CLIENT, showClosed: true })
    expect(href).toBe(`/support?client=${CLIENT}&closed=1`)
    const params = Object.fromEntries(new URL(href, "https://hub.test").searchParams)
    expect(parseSupportQueueParams(params)).toEqual({ clientId: CLIENT, showClosed: true })
  })

  it("drops the closed toggle without a client", () => {
    expect(supportQueueHref({ clientId: null, showClosed: true })).toBe("/support")
  })
})

describe("client picker counts", () => {
  it("counts open tickets per client", () => {
    const counts = countOpenTicketsByClient([
      { client_id: CLIENT },
      { client_id: OTHER },
      { client_id: CLIENT },
    ])
    expect(Object.fromEntries(counts)).toEqual({ [CLIENT]: 2, [OTHER]: 1 })
    expect(countOpenTicketsByClient([]).size).toBe(0)
  })

  it("lists active clients plus any with open tickets or picked, sorted by name", () => {
    const clients = [
      { id: "c-zed", name: "Zed Stays", status: "active" },
      { id: "c-old", name: "old cabins", status: "inactive" },
      { id: "c-gone", name: "Gone Co", status: "inactive" },
      { id: "c-new", name: "Bright Onboarding", status: "onboarding" },
      { id: "c-acme", name: "acme rentals", status: "active" },
      { id: "c-test", name: "Test Client", status: "test" },
    ]
    const counts = new Map([
      ["c-zed", 3],
      ["c-old", 1],
    ])

    const options = buildSupportClientOptions(clients, counts, "c-new")
    expect(options.map((o) => o.id)).toEqual(["c-acme", "c-new", "c-old", "c-zed"])
    expect(options.find((o) => o.id === "c-zed")?.openCount).toBe(3)
    expect(options.find((o) => o.id === "c-acme")?.openCount).toBe(0)
    expect(options.find((o) => o.id === "c-old")?.status).toBe("inactive")

    // Without the pick, a non-active client with nothing open drops out
    expect(buildSupportClientOptions(clients, counts, null).map((o) => o.id)).not.toContain("c-new")
  })
})

// ---------------------------------------------------------------------------
// Loader query building, against a recording fake of the Supabase client
// ---------------------------------------------------------------------------

type Call = { method: string; args: unknown[] }
type Query = { table: string; calls: Call[] }
type Result = { data: unknown[] | null; error: { message: string } | null; count?: number | null }

const arg = (q: Query, method: string) => q.calls.find((c) => c.method === method)?.args
const calls = (q: Query, method: string) => q.calls.filter((c) => c.method === method).map((c) => c.args)
const selectOf = (q: Query) => String(arg(q, "select")?.[0] ?? "")

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

const statusesOf = (q: Query) => arg(q, "in")?.[1] as string[] | undefined
const isOpenCountQuery = (q: Query) => q.table === "support_tickets" && selectOf(q).trim() === "client_id"
const isActiveQuery = (q: Query) =>
  q.table === "support_tickets" && !isOpenCountQuery(q) && statusesOf(q)?.includes("open") === true
const isClosedQuery = (q: Query) =>
  q.table === "support_tickets" && statusesOf(q)?.includes("resolved") === true

function ticket(id: string, clientId: string, status: string) {
  return {
    id,
    ticket_number: 1,
    client_id: clientId,
    status,
    priority: "medium",
    client_sentiment: "neutral",
    requested_at: "2026-10-01T12:00:00Z",
    // We replied after the ask, so no reply clock is running
    last_client_message_at: "2026-10-01T12:00:00Z",
    last_team_message_at: "2026-10-01T13:00:00Z",
    updated_at: "2026-10-02T12:00:00Z",
    resolved_at: status === "resolved" ? "2026-10-02T12:00:00Z" : null,
    answered_at: null,
    assignee_id: null,
    client_chase_count: 0,
    backfilled: false,
    support_ticket_commitments: [],
    adjustments: [],
    clients: { id: clientId, name: "Acme" },
  }
}

function defaultResolver(overrides: Partial<Record<"active" | "closed" | "openCounts", Result>> = {}) {
  return (q: Query): Result => {
    if (q.table === "clients_basic") {
      return {
        data: [
          { id: CLIENT, name: "Acme", status: "active" },
          { id: OTHER, name: "Birch", status: "active" },
        ],
        error: null,
      }
    }
    if (isOpenCountQuery(q))
      return overrides.openCounts ?? { data: [{ client_id: CLIENT }, { client_id: OTHER }, { client_id: OTHER }], error: null }
    if (isActiveQuery(q)) return overrides.active ?? { data: [ticket("t1", CLIENT, "open")], error: null }
    if (isClosedQuery(q)) return overrides.closed ?? { data: [], error: null, count: 0 }
    if (q.table === "support_ticket_events") return { data: null, error: null, count: 2 }
    return { data: [], error: null }
  }
}

const NOW = new Date("2026-10-05T12:00:00Z")
const SINCE = new Date(NOW.getTime() - 30 * 86_400_000).toISOString()

describe("loadSupportQueue query building", () => {
  it("keeps the all-clients view: every open ticket plus 30 days of closed", async () => {
    const { supabase, queries } = fakeSupabase(defaultResolver())
    const data = await loadSupportQueue(supabase, NOW)

    const active = queries.find(isActiveQuery)!
    expect(statusesOf(active)).toEqual(SUPPORT_ACTIVE_STATUSES)
    expect(calls(active, "eq")).toEqual([])

    const closed = queries.find(isClosedQuery)!
    expect(statusesOf(closed)).toEqual(SUPPORT_CLOSED_STATUSES)
    expect(arg(closed, "gte")).toEqual(["updated_at", SINCE])
    expect(arg(closed, "limit")).toEqual([SUPPORT_RECENT_CLOSED_LIMIT])
    expect(calls(closed, "eq")).toEqual([])

    const commitments = queries.find((q) => q.table === "support_ticket_commitments")!
    expect(selectOf(commitments)).not.toContain("client_id")
    for (const events of queries.filter((q) => q.table === "support_ticket_events")) {
      expect(selectOf(events)).toBe("id")
      expect(calls(events, "eq").map((a) => a[0])).toEqual(["event_type"])
    }

    expect(data.closedScope).toBe("recent")
    expect(data.closedTotal).toBeNull()
  })

  it("loads only the picked client's open tickets and skips closed ones by default", async () => {
    const { supabase, queries } = fakeSupabase(defaultResolver())
    const data = await loadSupportQueue(supabase, NOW, { clientId: CLIENT, showClosed: false })

    const active = queries.find(isActiveQuery)!
    expect(calls(active, "eq")).toEqual([["client_id", CLIENT]])
    expect(arg(active, "order")).toEqual(["requested_at", { ascending: true }])
    expect(queries.some(isClosedQuery)).toBe(false)

    expect(data.closedScope).toBe("hidden")
    expect(data.closedTotal).toBeNull()
    expect(data.tickets.map((t) => t.id)).toEqual(["t1"])
  })

  it("loads every closed ticket of the picked client, newest first, capped and counted", async () => {
    const closedRows = [ticket("t9", CLIENT, "resolved"), ticket("t8", CLIENT, "dismissed")]
    const { supabase, queries } = fakeSupabase(
      defaultResolver({ closed: { data: closedRows, error: null, count: 312 } })
    )
    const data = await loadSupportQueue(supabase, NOW, { clientId: CLIENT, showClosed: true })

    const closed = queries.find(isClosedQuery)!
    expect(statusesOf(closed)).toEqual(["resolved", "dismissed"])
    expect(calls(closed, "eq")).toEqual([["client_id", CLIENT]])
    expect(arg(closed, "gte")).toBeUndefined()
    expect(calls(closed, "order")).toEqual([
      ["updated_at", { ascending: false }],
      ["id", { ascending: false }],
    ])
    expect(arg(closed, "limit")).toEqual([SUPPORT_CLIENT_CLOSED_CAP])
    expect(arg(closed, "select")?.[1]).toEqual({ count: "exact" })

    expect(data.closedScope).toBe("client")
    expect(data.closedTotal).toBe(312)
    expect(data.tickets.map((t) => t.id)).toEqual(["t1", "t9", "t8"])
  })

  it("scopes the promise and sent-back stats to the picked client", async () => {
    const { supabase, queries } = fakeSupabase(defaultResolver())
    await loadSupportQueue(supabase, NOW, { clientId: CLIENT, showClosed: false })

    const commitments = queries.find((q) => q.table === "support_ticket_commitments")!
    expect(selectOf(commitments)).toContain("support_tickets!inner(backfilled, client_id)")
    expect(calls(commitments, "eq")).toContainEqual(["support_tickets.client_id", CLIENT])

    const events = queries.filter((q) => q.table === "support_ticket_events")
    expect(events).toHaveLength(2)
    for (const q of events) {
      expect(selectOf(q)).toContain("support_tickets!inner(client_id)")
      expect(arg(q, "select")?.[1]).toEqual({ count: "exact", head: true })
      expect(calls(q, "eq")).toContainEqual(["support_tickets.client_id", CLIENT])
      expect(arg(q, "gte")).toEqual(["occurred_at", SINCE])
    }
  })

  it("counts open tickets across every client for the picker, even when filtered", async () => {
    const { supabase, queries } = fakeSupabase(defaultResolver())
    const data = await loadSupportQueue(supabase, NOW, { clientId: CLIENT, showClosed: false })

    const counts = queries.find(isOpenCountQuery)!
    expect(statusesOf(counts)).toEqual(SUPPORT_ACTIVE_STATUSES)
    expect(calls(counts, "eq")).toEqual([])
    expect(data.clientOptions).toEqual([
      { id: CLIENT, name: "Acme", status: "active", openCount: 1 },
      { id: OTHER, name: "Birch", status: "active", openCount: 2 },
    ])
  })

  it("reads client names from clients_basic, never clients", async () => {
    const { supabase, queries } = fakeSupabase(defaultResolver())
    await loadSupportQueue(supabase, NOW, { clientId: CLIENT, showClosed: true })
    const tables = queries.map((q) => q.table)
    expect(tables).toContain("clients_basic")
    expect(tables).not.toContain("clients")
    expect(selectOf(queries.find(isActiveQuery)!)).toContain("clients:clients_basic(id, name)")
  })

  it("throws when any query fails", async () => {
    const { supabase } = fakeSupabase(
      defaultResolver({ closed: { data: null, error: { message: "boom" }, count: null } })
    )
    await expect(loadSupportQueue(supabase, NOW, { clientId: CLIENT, showClosed: true })).rejects.toThrow(
      "support queue load failed: boom"
    )
  })

  it("feeds stats that follow the picked client", async () => {
    const { supabase } = fakeSupabase(
      defaultResolver({
        active: {
          data: [ticket("t1", CLIENT, "open"), ticket("t2", CLIENT, "answered"), ticket("t3", CLIENT, "new")],
          error: null,
        },
      })
    )
    const data = await loadSupportQueue(supabase, NOW, { clientId: CLIENT, showClosed: false })
    const stats = supportStats(
      data.tickets,
      data.closedCommitments,
      { sentBack30d: data.sentBack30d, clientRejected30d: data.clientRejected30d },
      NOW
    )
    expect(stats.toVerify).toBe(1)
    expect(stats.onUs).toBe(2) // the open ticket plus the one in triage
    expect(stats.sentBack30d).toBe(2)
    expect(stats.promiseOnTimeRate).toBeNull()
  })
})
