import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { SupabaseClient } from "@supabase/supabase-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  generateAutomaticSuggestedAnswers,
  generateSuggestedAnswer,
  isMissingRelation,
  runSupportAnswerCheck,
  saveSupportAnswer,
  supportAnswerRuntimeStatus,
} from "@/lib/support-answers.server"

// The server paths run against a small fake Supabase client and a stubbed
// fetch. Nothing here calls TypeSafe or AI Gateway.

const ENV_KEYS = ["TYPESAFE_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "VERCEL"] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const TICKET_ID = "6f1c2a64-1d7e-4f43-9a5e-0d1f4c8b9e21"
const USER_ID = "11111111-1111-4111-8111-111111111111"

/** A client that fails the test if anything touches the database. */
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("the database must not be touched")
    },
  }
) as SupabaseClient

type Recorded = { table: string; op: string; row: unknown; filters: [string, unknown][] }

function fakeSupabase(tables: Record<string, unknown>) {
  const writes: Recorded[] = []
  const client = {
    from(table: string) {
      let op = "select"
      let row: unknown = null
      const filters: [string, unknown][] = []
      const resolve = () => {
        if (op !== "select") writes.push({ table, op, row, filters })
        if (op === "insert") return { data: { id: `${table}-new` }, error: null }
        if (op === "update" || op === "upsert") return { data: [{ id: "updated" }], error: null }
        return { data: tables[table] ?? null, error: null }
      }
      const chain: Record<string, unknown> = {}
      for (const method of ["select", "order", "limit", "in", "not", "neq"]) chain[method] = () => chain
      chain.eq = (column: string, value: unknown) => {
        filters.push([column, value])
        return chain
      }
      chain.is = (column: string, value: unknown) => {
        filters.push([`is:${column}`, value])
        return chain
      }
      chain.insert = (value: unknown) => {
        op = "insert"
        row = value
        return chain
      }
      chain.update = (value: unknown) => {
        op = "update"
        row = value
        return chain
      }
      chain.upsert = (value: unknown) => {
        op = "upsert"
        row = value
        return chain
      }
      chain.maybeSingle = async () => resolve()
      chain.single = async () => resolve()
      chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected)
      return chain
    },
  }
  return { client: client as unknown as SupabaseClient, writes }
}

const TICKET_ROW = {
  id: TICKET_ID,
  ticket_number: 1029,
  client_id: "c1",
  category: "pricing",
  request_type: "question",
  status: "open",
  merged_into: null,
  summary: "How is December pacing at Boho Cottage?",
  client_message: "How is December looking? Reach me at kate@example.com or (555) 201-4477.",
  time_window: "2026-12",
  property_scope: "listings",
  money_at_stake: false,
  requested_by_name: "Kate Rivers",
  requested_at: "2026-10-01T14:00:00Z",
  suggested_reply_generated_at: null,
  support_ticket_listings: [{ listing_id: "l1", listings: { id: "l1", name: "Boho Cottage | TX | Kate", city: "Austin", state: "TX", status: "active", pl_synced_at: "2026-10-03T08:00:00Z" } }],
  support_ticket_commitments: [],
  adjustments: [],
}

const KNOWLEDGE = [
  {
    id: "a1",
    title: "How we read December pacing",
    slug: "december-pacing",
    excerpt: "Pacing compares on-the-books revenue with last year.",
    content_html: "<p>December pacing compares on-the-books revenue with the same lead time last year.</p>",
    canonical_question: "How is December pacing?",
    approved_answer: "We compare December on-the-books revenue with the same lead time last year.",
    escalation_guidance: null,
    updated_at: "2026-09-01T00:00:00Z",
  },
]

describe("graceful degradation", () => {
  it("reports what is configured without throwing", () => {
    expect(supportAnswerRuntimeStatus()).toMatchObject({ drafts: false, check: false, jevModel: "jev-1.13.0" })
    process.env.TYPESAFE_API_KEY = "ts_test"
    process.env.AI_GATEWAY_API_KEY = "gw_test"
    expect(supportAnswerRuntimeStatus()).toMatchObject({ drafts: true, check: true })
  })

  it("an answer check without TYPESAFE_API_KEY is 'not configured', before any read", async () => {
    await expect(runSupportAnswerCheck(untouchable, TICKET_ID, "Hi!", USER_ID)).resolves.toEqual({
      status: "not_configured",
    })
  })

  it("drafting without AI Gateway is 'not configured', before any read or claim", async () => {
    await expect(generateSuggestedAnswer(untouchable, TICKET_ID, { origin: "manual", userId: USER_ID })).resolves.toEqual({
      ticketId: TICKET_ID,
      status: "not_configured",
    })
    await expect(generateAutomaticSuggestedAnswers(untouchable, [TICKET_ID, TICKET_ID], "auto")).resolves.toEqual([
      { ticketId: TICKET_ID, status: "not_configured" },
    ])
  })

  it("recognizes a missing table (migration not applied yet)", () => {
    expect(isMissingRelation({ code: "PGRST205", message: "Could not find the table" })).toBe(true)
    expect(isMissingRelation({ code: "42P01", message: 'relation "x" does not exist' })).toBe(true)
    expect(isMissingRelation({ code: "23505", message: "duplicate key" })).toBe(false)
    expect(isMissingRelation(null)).toBe(false)
  })
})

describe("runSupportAnswerCheck with mocked HTTP", () => {
  it("sends a redacted state, stores the gated result and full response, and logs the event", async () => {
    process.env.TYPESAFE_API_KEY = "ts_test_key_abcdef0123456789"
    const answers = {
      answers_ask: { type: "choice", choice: "partly", probabilities: { partly: 0.88, fully: 0.08 }, confidence: 0.81 },
      unfilled_placeholder: { type: "noul", noul: 0.02 },
      conflicts_with_knowledge: { type: "choice", choice: "consistent", probabilities: { consistent: 0.9 }, confidence: 0.8 },
      promise_without_date: { type: "noul", noul: 0.5 },
      claims_change_live: { type: "noul", noul: 0.03 },
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ answers }))
    vi.stubGlobal("fetch", fetchMock)
    const { client, writes } = fakeSupabase({
      support_tickets: TICKET_ROW,
      support_ticket_events: [],
      knowledge_articles: KNOWLEDGE,
    })

    const reply = "Hi Kate, December is pacing ahead. We'll look into the rest. Call 555-201-4477."
    const result = await runSupportAnswerCheck(client, TICKET_ID, reply, USER_ID)

    expect(result).toMatchObject({ status: "checked", verdict: "fix" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.typesafe.ai/v1/systemone")
    const body = JSON.parse(init.body)
    expect(body.model).toBe("jev-1.13.0")
    expect(Object.keys(body.questions)).toEqual([
      "answers_ask",
      "unfilled_placeholder",
      "conflicts_with_knowledge",
      "promise_without_date",
      "claims_change_live",
    ])
    const sent = JSON.stringify(body.state)
    expect(sent).not.toMatch(/kate@example\.com|201-4477|\(555\)|Rivers/)
    expect(body.state.knowledge[0].title).toBe("How we read December pacing")
    expect(body.state.ticket.property).toBe("Boho Cottage")

    const check = writes.find((w) => w.table === "support_answer_checks")
    expect(check?.op).toBe("insert")
    expect(check?.row).toMatchObject({
      ticket_id: TICKET_ID,
      answer_snapshot: reply,
      verdict: "fix",
      model: "jev-1.13.0",
      question_set: "answer-check-v1",
      jev_response: { answers },
      created_by: USER_ID,
    })
    const results = (check?.row as { results: { key: string; outcome: string }[] }).results
    expect(results.map((r) => [r.key, r.outcome])).toEqual([
      ["answers_ask", "problem"],
      ["unfilled_placeholder", "ok"],
      ["conflicts_with_knowledge", "ok"],
      ["promise_without_date", "unsure"],
      ["claims_live_without_proof", "ok"],
    ])
    expect(JSON.stringify(check?.row)).not.toContain("ts_test_key")

    const event = writes.find((w) => w.table === "support_ticket_events")
    expect(event?.row).toMatchObject({ event_type: "answer_checked", actor_id: USER_ID, ticket_id: TICKET_ID })
  })

  it("returns a scrubbed failure when TypeSafe errors, and stores nothing", async () => {
    process.env.TYPESAFE_API_KEY = "ts_test_key_abcdef0123456789"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream ts_test_key_abcdef0123456789", { status: 502 })))
    const { client, writes } = fakeSupabase({ support_tickets: TICKET_ROW, support_ticket_events: [], knowledge_articles: [] })
    const result = await runSupportAnswerCheck(client, TICKET_ID, "Hi!", USER_ID)
    expect(result).toMatchObject({ status: "failed" })
    if (result.status === "failed") expect(result.error).not.toContain("ts_test_key")
    expect(writes).toEqual([])
  })
})

describe("saveSupportAnswer", () => {
  it("saves as the signed-in user, masked, and logs answer_saved", async () => {
    const { client, writes } = fakeSupabase({ support_tickets: { id: TICKET_ID, status: "open", merged_into: null } })
    const result = await saveSupportAnswer(client, TICKET_ID, " Thanks! Text me at 555-201-4477. ", USER_ID)
    expect(result).toEqual({ ok: true, changed: true, body: "Thanks! Text me at ***-***-4477." })
    expect(writes[0]).toMatchObject({
      table: "support_ticket_answers",
      op: "upsert",
      row: { ticket_id: TICKET_ID, body: "Thanks! Text me at ***-***-4477.", updated_by: USER_ID },
    })
    expect(writes[1]).toMatchObject({ table: "support_ticket_events", row: { event_type: "answer_saved", actor_id: USER_ID } })
  })

  it("refuses credentials and closed tickets without writing", async () => {
    const open = fakeSupabase({ support_tickets: { id: TICKET_ID, status: "open", merged_into: null } })
    expect(await saveSupportAnswer(open.client, TICKET_ID, "password: hunter22", USER_ID)).toMatchObject({ ok: false })
    const closed = fakeSupabase({ support_tickets: { id: TICKET_ID, status: "resolved", merged_into: null } })
    expect(await saveSupportAnswer(closed.client, TICKET_ID, "Done.", USER_ID)).toEqual({
      ok: false,
      error: "This ticket is closed.",
    })
    expect([...open.writes, ...closed.writes]).toEqual([])
  })

  it("does nothing when the answer didn't change", async () => {
    const { client, writes } = fakeSupabase({
      support_tickets: { id: TICKET_ID, status: "open", merged_into: null },
      support_ticket_answers: { body: "Same text" },
    })
    expect(await saveSupportAnswer(client, TICKET_ID, "Same text ", USER_ID)).toEqual({ ok: true, changed: false, body: "Same text" })
    expect(writes).toEqual([])
  })
})

describe("draft coexistence with the capture bot", () => {
  it("an automatic draft is skipped when the ticket already has a draft", async () => {
    process.env.AI_GATEWAY_API_KEY = "gw_test"
    const { client, writes } = fakeSupabase({
      support_tickets: { ...TICKET_ROW, suggested_reply_generated_at: "2026-10-04T12:00:00Z" },
      support_ticket_events: [],
      knowledge_articles: [],
    })
    const result = await generateSuggestedAnswer(client, TICKET_ID, { origin: "auto", userId: null })
    expect(result).toMatchObject({ status: "skipped", reason: "The ticket already has a draft." })
    expect(writes).toEqual([])
  })

  it("never drafts billing or offboarding, even on demand", async () => {
    process.env.AI_GATEWAY_API_KEY = "gw_test"
    const { client, writes } = fakeSupabase({
      support_tickets: { ...TICKET_ROW, category: "billing" },
      support_ticket_events: [],
      knowledge_articles: [],
    })
    const result = await generateSuggestedAnswer(client, TICKET_ID, { origin: "manual", userId: USER_ID })
    expect(result).toMatchObject({ status: "skipped", reason: "No draft for billing/offboarding — handled by Fede." })
    expect(writes).toEqual([])
  })
})

describe("structure", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")

  it("the capture API drafts after responding, only for created tickets", () => {
    const route = read("app/api/v1/support-captures/route.ts")
    expect(route).toMatch(/import \{ after, NextResponse \} from "next\/server"/)
    expect(route).toContain('generateAutomaticSuggestedAnswers(admin, newTicketIds, "auto")')
    expect(route).toContain('t.outcome === "created"')
    // The only call sits inside the after() callback, so the response never waits on it
    const afterAt = route.indexOf("after(async")
    const callAt = route.indexOf("await generateAutomaticSuggestedAnswers(")
    expect(afterAt).toBeGreaterThan(-1)
    expect(callAt).toBeGreaterThan(afterAt)
    expect(route.split("generateAutomaticSuggestedAnswers(").length).toBe(2)
    expect(afterAt).toBeLessThan(route.indexOf("return NextResponse.json(result.body"))
  })

  it("the backfill route is CRON_SECRET-gated", () => {
    const route = read("app/api/cron/support-drafts/route.ts")
    expect(route).toContain("authHeader !== `Bearer ${cronSecret}`")
    expect(route.indexOf("CRON_SECRET")).toBeLessThan(route.indexOf("createAdminClient()"))
  })

  it("every answer action checks support:edit in code", () => {
    const actions = read("app/(authenticated)/support/answer-actions.ts")
    expect(actions.startsWith('"use server"')).toBe(true)
    expect(actions).toContain('hasPermission("support", "edit")')
    expect(actions).not.toContain("createAdminClient")
    for (const name of ["generateSuggestedAnswerAction", "saveSupportAnswerAction", "checkSupportAnswerAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`))
      expect(body.indexOf("await editor()")).toBeGreaterThan(-1)
      expect(body.indexOf("await editor()")).toBeLessThan(body.indexOf("createClient()"))
    }
  })

  it("the server module is server-only and never selects every column", () => {
    const server = read("lib/support-answers.server.ts")
    // Executable code only: comments explain what the file avoids
    const code = server
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
    expect(server.startsWith('import "server-only"')).toBe(true)
    expect(code).not.toMatch(/select\(\s*["'`]\*["'`]/)
    expect(code).not.toMatch(/billing_amount|autopayment|stripe/)
    expect(code).not.toMatch(/@\/lib\/(assembly|pricelabs)/)
  })
})
