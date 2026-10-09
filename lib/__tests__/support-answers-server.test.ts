import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { SupabaseClient } from "@supabase/supabase-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: () => Promise.reject(new Error("no oidc in tests")) }))

import {
  generateAutomaticSuggestedAnswers,
  generateSuggestedAnswer,
  isMissingRelation,
  loadSupportAnswerPanel,
  mergeSupportAnswers,
  runSupportAnswerReview,
  runSupportFinalCheck,
  saveSupportAnswer,
  saveSupportFinalAnswer,
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
const GENERATION_ID = "22222222-2222-4222-8222-222222222222"
const SECRET_DRAFT = "SECRET-DRAFT: Hi Kate! December is pacing [X]% ahead; weekends are filling faster than weekdays."

/** A client that fails the test if anything touches the database. */
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("the database must not be touched")
    },
  }
) as SupabaseClient

type Query = { table: string; op: string; select: string; filters: [string, unknown][]; row: unknown }
type TableValue = unknown | ((q: Query) => unknown)

function fakeSupabase(tables: Record<string, TableValue>) {
  const queries: Query[] = []
  const client = {
    from(table: string) {
      const q: Query = { table, op: "select", select: "", filters: [], row: null }
      const resolve = () => {
        queries.push({ ...q, filters: [...q.filters] })
        if (q.op === "insert") return { data: { id: `${table}-new` }, error: null }
        if (q.op === "update" || q.op === "upsert") return { data: [{ id: "updated" }], error: null }
        const value = tables[table]
        return { data: typeof value === "function" ? (value as (q: Query) => unknown)(q) : (value ?? null), error: null }
      }
      const chain: Record<string, unknown> = {}
      chain.select = (columns?: string) => {
        if (q.op === "select") q.select = columns ?? ""
        return chain
      }
      for (const method of ["order", "limit", "in", "not", "neq"]) chain[method] = () => chain
      chain.eq = (column: string, value: unknown) => {
        q.filters.push([column, value])
        return chain
      }
      chain.is = (column: string, value: unknown) => {
        q.filters.push([`is:${column}`, value])
        return chain
      }
      for (const op of ["insert", "update", "upsert"]) {
        chain[op] = (value: unknown) => {
          q.op = op
          q.row = value
          return chain
        }
      }
      chain.maybeSingle = async () => resolve()
      chain.single = async () => resolve()
      chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected)
      return chain
    },
  }
  const writes = () => queries.filter((x) => x.op !== "select")
  const reads = () => queries.filter((x) => x.op === "select")
  return { client: client as unknown as SupabaseClient, writes, reads }
}

const DRAFT = {
  text: SECRET_DRAFT,
  basis: ["Knowledge: How we read December pacing"],
  skill: "hub-support-answer",
  prompt_version: "hub-answer-v1",
  generated_at: "2026-10-05T12:00:00.000Z",
  source: "hub",
  generation_id: GENERATION_ID,
}

/**
 * A support_tickets row that returns EVERYTHING whatever was selected, the
 * draft included: the lock must hold because of what the code reads and
 * returns, not because the fake is polite.
 */
const ticketRow = (overrides: Record<string, unknown> = {}) => ({
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
  last_client_message_at: "2026-10-01T14:00:00Z",
  last_team_message_at: null,
  suggested_reply_generated_at: DRAFT.generated_at,
  suggested_reply: DRAFT,
  support_ticket_listings: [{ listing_id: "l1", listings: { id: "l1", name: "Boho Cottage | TX | Kate", city: "Austin", state: "TX", status: "active", pl_synced_at: "2026-10-03T08:00:00Z" } }],
  support_ticket_commitments: [],
  adjustments: [],
  ...overrides,
})

const ANSWER_ROW = {
  ticket_id: TICKET_ID,
  first_body: "Hi Kate, December is pacing 12% ahead of last year.",
  first_saved_at: "2026-10-05T13:00:00Z",
  suggestion_at_unlock: { text: SECRET_DRAFT, source: "hub", generation_id: GENERATION_ID, generated_at: DRAFT.generated_at },
  body: "Hi Kate, December is pacing 12% ahead of last year.",
  updated_at: "2026-10-05T13:00:00Z",
  final_body: null,
  final_source: null,
  final_saved_at: null,
  suggestion_at_final: null,
  suggestion_adoption: null,
  used_suggestion: null,
  first_author: { full_name: "Andrés", email: "a@x.com" },
  editor: { full_name: "Andrés", email: "a@x.com" },
  finalizer: null,
}

/** A select that reads the whole draft (not just its ->> metadata). */
const readsDraftText = (select: string) => /(^|[\s,(])suggested_reply(\s*,|\s*$)/.test(select)

describe("graceful degradation", () => {
  it("reports what is configured without throwing", () => {
    expect(supportAnswerRuntimeStatus()).toMatchObject({ drafts: false, check: false, jevModel: "typesafe-ai/jev" })
    process.env.AI_GATEWAY_API_KEY = "gw_test"
    expect(supportAnswerRuntimeStatus()).toMatchObject({ drafts: true, check: true })
    delete process.env.AI_GATEWAY_API_KEY
    process.env.TYPESAFE_API_KEY = "ts_test"
    expect(supportAnswerRuntimeStatus()).toMatchObject({ drafts: false, check: true })
  })

  it("nothing configured: checks, drafts, and merges say so before any read", async () => {
    await expect(runSupportFinalCheck(untouchable, TICKET_ID, "Hi!", USER_ID)).resolves.toEqual({ status: "not_configured" })
    await expect(generateSuggestedAnswer(untouchable, TICKET_ID, { origin: "manual", userId: USER_ID })).resolves.toEqual({
      ticketId: TICKET_ID,
      status: "not_configured",
    })
    await expect(generateAutomaticSuggestedAnswers(untouchable, [TICKET_ID, TICKET_ID], "auto")).resolves.toEqual([
      { ticketId: TICKET_ID, status: "not_configured" },
    ])
    await expect(mergeSupportAnswers(untouchable, TICKET_ID, USER_ID)).resolves.toMatchObject({ ok: false, notConfigured: true })
  })

  it("recognizes a missing table (migration not applied yet)", () => {
    expect(isMissingRelation({ code: "PGRST205", message: "Could not find the table" })).toBe(true)
    expect(isMissingRelation({ code: "42P01", message: 'relation "x" does not exist' })).toBe(true)
    expect(isMissingRelation({ code: "23505", message: "duplicate key" })).toBe(false)
    expect(isMissingRelation(null)).toBe(false)
  })
})

describe("THE LOCK: no suggestion text before a saved team answer", () => {
  const generationRow = { sources: [{ id: "kb:a1", kind: "knowledge", label: "Knowledge: Pacing", href: "/knowledge/pacing", cited: true }], confidence: { status: "not_configured" }, creator: null }

  it("locked: the panel carries only a lock line, and the draft is never even selected", async () => {
    const { client, reads } = fakeSupabase({
      support_ticket_answers: null,
      support_tickets: () => ticketRow(),
      support_answer_checks: null,
      support_suggested_answers: [{ id: GENERATION_ID, status: "completed", error_message: null, created_at: DRAFT.generated_at, body: SECRET_DRAFT, ...generationRow }],
      support_answer_comparisons: { suggestion_snapshot: { text: SECRET_DRAFT } },
    })
    const panel = await loadSupportAnswerPanel(client, TICKET_ID)

    expect(panel.unlocked).toBe(false)
    expect(panel.lock).toEqual({ status: "ready", message: "A suggested answer is ready. Save your answer to compare." })
    expect(panel.suggestion).toBeNull()
    expect(panel.comparison).toBeNull()
    expect(JSON.stringify(panel)).not.toContain("SECRET-DRAFT")
    expect(JSON.stringify(panel)).not.toContain("Knowledge: Pacing")
    for (const r of reads()) {
      if (r.table === "support_tickets") expect(readsDraftText(r.select)).toBe(false)
      if (r.table === "support_suggested_answers") expect(r.select).not.toMatch(/\b(body|sources|confidence)\b/)
    }
    expect(reads().some((r) => r.table === "support_answer_comparisons")).toBe(false)
  })

  it("a whitespace-only answer does not unlock", async () => {
    const { client } = fakeSupabase({
      support_ticket_answers: { ...ANSWER_ROW, first_body: "   " },
      support_tickets: () => ticketRow(),
      support_suggested_answers: [],
    })
    const panel = await loadSupportAnswerPanel(client, TICKET_ID)
    expect(panel.unlocked).toBe(false)
    expect(JSON.stringify(panel)).not.toContain("SECRET-DRAFT")
  })

  it("billing tickets never show a suggestion, even after the team answers", async () => {
    const { client, reads } = fakeSupabase({
      support_ticket_answers: ANSWER_ROW,
      support_tickets: () => ticketRow({ category: "billing" }),
      support_suggested_answers: [],
    })
    const panel = await loadSupportAnswerPanel(client, TICKET_ID)
    expect(panel.lock.status).toBe("blocked")
    expect(panel.suggestion).toBeNull()
    expect(reads().some((r) => r.table === "support_tickets" && readsDraftText(r.select))).toBe(false)
  })

  it("unlocked: the suggestion, its sources, and its label arrive", async () => {
    const { client } = fakeSupabase({
      support_ticket_answers: ANSWER_ROW,
      support_tickets: () => ticketRow(),
      support_answer_checks: null,
      support_suggested_answers: (q: Query) =>
        q.select.includes("sources") ? generationRow : [{ id: GENERATION_ID, status: "completed", error_message: null, created_at: DRAFT.generated_at }],
      support_answer_comparisons: null,
    })
    const panel = await loadSupportAnswerPanel(client, TICKET_ID)
    expect(panel.unlocked).toBe(true)
    expect(panel.suggestion).toMatchObject({ text: SECRET_DRAFT, source: "hub", gaps: ["[X]"] })
    expect(panel.suggestion?.sources?.[0].label).toBe("Knowledge: Pacing")
    expect(panel.answer?.firstSavedByName).toBe("Andrés")
  })

  it("the ticket detail loader never selects the draft text", () => {
    const queue = readFileSync(join(process.cwd(), "lib/support-queue.server.ts"), "utf8")
    const code = queue
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
    expect(code).not.toMatch(/suggested_reply(?!_generated_at|->>)/)
    const page = readFileSync(join(process.cwd(), "app/(authenticated)/support/[id]/page.tsx"), "utf8")
    expect(page).not.toMatch(/\.suggested_reply\b/)
    for (const file of ["layout.tsx", "page.tsx", "support-workspace.tsx", "support-sidebar.tsx", "support-client-page.tsx"]) {
      const source = readFileSync(join(process.cwd(), "app/(authenticated)/support", file), "utf8")
      expect(source).not.toMatch(/suggested_reply(?!_generated_at)/)
    }
  })
})

describe("step 1: the first save unlocks", () => {
  it("stores the blind answer and a snapshot, and logs saved + unlocked without the draft text", async () => {
    const { client, writes } = fakeSupabase({
      support_tickets: () => ticketRow(),
      support_ticket_answers: null,
    })
    const result = await saveSupportAnswer(client, TICKET_ID, " Hi Kate, December is pacing 12% ahead. Text 555-201-4477. ", USER_ID)
    expect(result).toEqual({ ok: true, changed: true, unlocked: true, body: "Hi Kate, December is pacing 12% ahead. Text ***-***-4477." })

    const [insert, saved, unlocked] = writes()
    expect(insert).toMatchObject({
      table: "support_ticket_answers",
      op: "insert",
      row: {
        ticket_id: TICKET_ID,
        first_body: "Hi Kate, December is pacing 12% ahead. Text ***-***-4477.",
        body: "Hi Kate, December is pacing 12% ahead. Text ***-***-4477.",
        first_saved_by: USER_ID,
        updated_by: USER_ID,
        suggestion_at_unlock: { text: SECRET_DRAFT, source: "hub", generation_id: GENERATION_ID },
      },
    })
    expect(saved).toMatchObject({ table: "support_ticket_events", row: { event_type: "answer_saved", actor_id: USER_ID } })
    expect(unlocked).toMatchObject({
      table: "support_ticket_events",
      row: {
        event_type: "suggestion_unlocked",
        actor_id: USER_ID,
        body: "Answered first, then unlocked the Hub draft",
        payload: { blind_first: true, suggestion_available: true, suggestion_source: "hub", generation_id: GENERATION_ID },
      },
    })
    expect(JSON.stringify(unlocked.row)).not.toContain("SECRET-DRAFT")
  })

  it("later saves update the answer under review, never the blind first answer", async () => {
    const { client, writes } = fakeSupabase({ support_tickets: () => ticketRow(), support_ticket_answers: ANSWER_ROW })
    const result = await saveSupportAnswer(client, TICKET_ID, "Hi Kate, December is pacing 12% ahead; weekends fill faster.", USER_ID)
    expect(result).toMatchObject({ ok: true, changed: true, unlocked: false })
    expect(writes()[0]).toMatchObject({ table: "support_ticket_answers", op: "update" })
    expect(writes()[0].row).not.toHaveProperty("first_body")
  })

  it("refuses credentials and closed tickets without writing", async () => {
    const open = fakeSupabase({ support_tickets: () => ticketRow() })
    expect(await saveSupportAnswer(open.client, TICKET_ID, "password: hunter22", USER_ID)).toMatchObject({ ok: false })
    const closed = fakeSupabase({ support_tickets: () => ticketRow({ status: "resolved" }) })
    expect(await saveSupportAnswer(closed.client, TICKET_ID, "Done.", USER_ID)).toEqual({ ok: false, error: "This ticket is closed." })
    expect([...open.writes(), ...closed.writes()]).toEqual([])
  })
})

describe("step 2: review with mocked HTTP (direct TypeSafe shape)", () => {
  it("is locked until the team has saved an answer", async () => {
    const { client, writes } = fakeSupabase({ support_ticket_answers: null })
    expect(await runSupportAnswerReview(client, TICKET_ID, USER_ID)).toEqual({ status: "locked", error: "Save your own answer first." })
    expect(writes()).toEqual([])
  })

  it("checks the team answer and compares it with the suggestion, storing both", async () => {
    process.env.TYPESAFE_API_KEY = "ts_test_key_abcdef0123456789"
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if ("facts_conflict" in body.questions)
        return Response.json({
          answers: {
            suggestion_covers_missing_point: { type: "noul", noul: 0.94 },
            facts_conflict: { type: "choice", choice: "agree", probabilities: { agree: 0.88 }, confidence: 0.8 },
          },
        })
      return Response.json({
        answers: {
          answers_ask: { type: "choice", choice: "fully", probabilities: { fully: 0.9 }, confidence: 0.84 },
          unfilled_placeholder: { type: "noul", noul: 0.02 },
          promise_without_date: { type: "noul", noul: 0.03 },
          claims_change_live: { type: "noul", noul: 0.01 },
        },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { client, writes } = fakeSupabase({
      support_ticket_answers: ANSWER_ROW,
      support_tickets: () => ticketRow(),
      support_ticket_events: [],
      knowledge_articles: [],
    })

    const result = await runSupportAnswerReview(client, TICKET_ID, USER_ID)
    expect(result).toMatchObject({
      status: "reviewed",
      check: { status: "checked", verdict: "pass" },
      comparison: { status: "compared", verdict: "review", jevStatus: "ok", addsStatus: "not_configured" },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe("https://api.typesafe.ai/v1/systemone")
      expect(String(init.body)).not.toMatch(/kate@example\.com|201-4477|Rivers/)
    }

    const check = writes().find((w) => w.table === "support_answer_checks")
    expect(check?.row).toMatchObject({ target: "team", verdict: "pass", transport: "typesafe", model: "jev-1.13.0", created_by: USER_ID })
    const comparison = writes().find((w) => w.table === "support_answer_comparisons")
    expect(comparison?.row).toMatchObject({
      team_answer_snapshot: ANSWER_ROW.body,
      suggestion_snapshot: { text: SECRET_DRAFT, source: "hub" },
      jev_status: "ok",
      verdict: "review",
      adds: [],
      adds_status: "not_configured",
      question_set: "answer-compare-v1",
    })
    expect(JSON.stringify(writes())).not.toContain("ts_test_key")
    expect(writes().find((w) => w.table === "support_ticket_events")?.row).toMatchObject({
      event_type: "answer_checked",
      payload: { target: "team", transport: "typesafe" },
    })
  })
})

describe("step 3: final answer", () => {
  it("merge is locked until the team has saved an answer, before any AI call", async () => {
    process.env.AI_GATEWAY_API_KEY = "gw_test"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { client } = fakeSupabase({ support_ticket_answers: null })
    expect(await mergeSupportAnswers(client, TICKET_ID, USER_ID)).toEqual({ ok: false, error: "Save your own answer first." })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("saves the final with the suggestion as shown and the derived draft usage", async () => {
    const { client, writes } = fakeSupabase({ support_tickets: () => ticketRow(), support_ticket_answers: ANSWER_ROW })
    const final = `${ANSWER_ROW.first_body} Weekends are filling faster than weekdays.`
    const result = await saveSupportFinalAnswer(client, TICKET_ID, final, "merged", USER_ID)
    expect(result).toMatchObject({ ok: true, changed: true, usedSuggestion: "partly" })

    const update = writes().find((w) => w.table === "support_ticket_answers")
    expect(update?.row).toMatchObject({
      final_body: final,
      final_source: "merged",
      used_suggestion: "partly",
      suggestion_at_final: { text: SECRET_DRAFT, source: "hub" },
      updated_by: USER_ID,
    })
    expect(update?.row).not.toHaveProperty("first_body")
    expect(writes().find((w) => w.table === "support_ticket_events")?.row).toMatchObject({
      event_type: "answer_finalized",
      payload: { used_suggestion: "partly", final_source: "merged", suggestion_source: "hub" },
    })
  })

  it("keeping your own answer is 'none'; no final before the team answer", async () => {
    const kept = fakeSupabase({ support_tickets: () => ticketRow(), support_ticket_answers: ANSWER_ROW })
    expect(await saveSupportFinalAnswer(kept.client, TICKET_ID, ANSWER_ROW.first_body, "mine", USER_ID)).toMatchObject({
      ok: true,
      usedSuggestion: "none",
    })
    const locked = fakeSupabase({ support_tickets: () => ticketRow(), support_ticket_answers: null })
    expect(await saveSupportFinalAnswer(locked.client, TICKET_ID, "Hi!", "mine", USER_ID)).toEqual({
      ok: false,
      error: "Save your own answer first.",
    })
    expect(locked.writes()).toEqual([])
  })
})

describe("draft coexistence with the capture bot (unchanged)", () => {
  it("an automatic draft is skipped when the ticket already has a draft", async () => {
    process.env.AI_GATEWAY_API_KEY = "gw_test"
    const { client, writes } = fakeSupabase({
      support_tickets: () => ticketRow({ suggested_reply_generated_at: "2026-10-04T12:00:00Z" }),
      support_ticket_events: [],
      knowledge_articles: [],
    })
    const result = await generateSuggestedAnswer(client, TICKET_ID, { origin: "auto", userId: null })
    expect(result).toMatchObject({ status: "skipped", reason: "The ticket already has a draft." })
    expect(writes()).toEqual([])
  })

  it("never drafts billing or offboarding, even on demand", async () => {
    process.env.AI_GATEWAY_API_KEY = "gw_test"
    const { client, writes } = fakeSupabase({
      support_tickets: () => ticketRow({ category: "billing" }),
      support_ticket_events: [],
      knowledge_articles: [],
    })
    const result = await generateSuggestedAnswer(client, TICKET_ID, { origin: "manual", userId: USER_ID })
    expect(result).toMatchObject({ status: "skipped", reason: "No draft for billing/offboarding — handled by Fede." })
    expect(writes()).toEqual([])
  })
})

describe("structure", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")

  it("the capture API drafts after responding, only for created tickets", () => {
    const route = read("app/api/v1/support-captures/route.ts")
    expect(route).toMatch(/import \{ after, NextResponse \} from "next\/server"/)
    expect(route).toContain('generateAutomaticSuggestedAnswers(admin, newTicketIds, "auto")')
    expect(route).toContain('t.outcome === "created"')
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

  it("every answer action checks support:edit in code before touching data", () => {
    const actions = read("app/(authenticated)/support/answer-actions.ts")
    expect(actions.startsWith('"use server"')).toBe(true)
    expect(actions).toContain('hasPermission("support", "edit")')
    expect(actions).not.toContain("createAdminClient")
    for (const name of [
      "generateSuggestedAnswerAction",
      "saveSupportAnswerAction",
      "runAnswerReviewAction",
      "mergeAnswersAction",
      "checkFinalAnswerAction",
      "saveFinalAnswerAction",
      "testJevConnectionAction",
    ]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`))
      expect(body.indexOf("await editor()"), name).toBeGreaterThan(-1)
      const next = body.indexOf("createClient()")
      if (next > -1) expect(body.indexOf("await editor()"), name).toBeLessThan(next)
    }
  })

  it("the server module is server-only and never selects every column", () => {
    const server = read("lib/support-answers.server.ts")
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
