import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { buildWinMessage, extractNumbers } from "@/lib/wins-message"
import {
  SLACK_SKIP_NOT_CONFIGURED,
  SLACK_WINS_CHANNEL_ID_DEFAULT,
} from "@/lib/slack"
import {
  buildWinSlackPayload,
  deliverWinSlackNotes,
  findWinSlackDelivery,
  sanitizeSlackWinText,
} from "@/lib/wins-slack.server"
import { WINS_RULES_V1 } from "@/lib/wins"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { makeCandidate, makeEvidence } from "./wins-helpers"

const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const SHAREABLE_ID = "11111111-1111-4111-8111-111111111111"
const BLOCKED_ID = "22222222-2222-4222-8222-222222222222"
const NO_TEMPLATE_ID = "33333333-3333-4333-8333-333333333333"
const SLACK_TS = "1710000000.123456"
const TOKEN = "xoxb-test-token"

const originalToken = process.env.SLACK_BOT_TOKEN
const originalChannel = process.env.SLACK_WINS_CHANNEL_ID

function shareableCandidate() {
  return makeCandidate({
    id: SHAREABLE_ID,
    run_id: RUN_ID,
    category: "double_win",
    listing_name_snapshot: "Rabbit Run | TX | Grant",
    client_name_snapshot: "Grant",
    is_blocked: false,
    evidence: makeEvidence({
      pickup: { w2: 5335.97, w3: 36794.12 },
      yoy: { ty: 216135.57, stly: 171010.99 },
    }),
  })
}

function blockedCandidate() {
  return makeCandidate({
    id: BLOCKED_ID,
    run_id: RUN_ID,
    category: "double_win",
    is_blocked: true,
    evidence: makeEvidence({
      pickup: { w2: 5335.97, w3: 36794.12 },
      yoy: { ty: 216135.57, stly: 171010.99 },
    }),
  })
}

function noTemplateCandidate() {
  return makeCandidate({
    id: NO_TEMPLATE_ID,
    run_id: RUN_ID,
    category: "conflicting_signal",
    is_blocked: false,
  })
}

type DeliveryRow = {
  id?: string
  candidate_id: string
  channel_id: string
  slack_ts?: string | null
  status: string
  skip_reason?: string | null
  payload_hash?: string
  sent_at?: string | null
}

function createMockSupabase(opts: {
  run?: { id: string; status: string } | null
  candidates?: ReturnType<typeof shareableCandidate>[]
  sent?: DeliveryRow[]
}) {
  const run = opts.run === undefined ? { id: RUN_ID, status: "completed" } : opts.run
  const candidates = opts.candidates ?? [shareableCandidate()]
  const deliveries: DeliveryRow[] = [...(opts.sent ?? [])]
  const events: Record<string, unknown>[] = []

  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    const builder = {
      select() {
        return builder
      },
      eq(column: string, value: unknown) {
        filters[column] = value
        return builder
      },
      in(column: string, values: unknown[]) {
        filters[`${column}__in`] = values
        return builder
      },
      order() {
        return builder
      },
      limit() {
        return builder
      },
      maybeSingle: async () => {
        if (table === "win_detection_runs") {
          if (!run) return { data: null, error: null }
          if (filters.id && run.id !== filters.id) return { data: null, error: null }
          if (filters.status && run.status !== filters.status) {
            return { data: null, error: null }
          }
          return { data: run, error: null }
        }
        if (table === "win_slack_deliveries") {
          const match = deliveries.find((row) => {
            if (filters.candidate_id && row.candidate_id !== filters.candidate_id) return false
            if (filters.channel_id && row.channel_id !== filters.channel_id) return false
            if (filters.slack_ts && row.slack_ts !== filters.slack_ts) return false
            if (filters.status && row.status !== filters.status) return false
            return true
          })
          return { data: match ?? null, error: null }
        }
        return { data: null, error: null }
      },
      insert(row: Record<string, unknown>) {
        if (table === "win_events") {
          events.push(row)
          return {
            select: () => ({
              single: async () => ({ data: { id: "event-1" }, error: null }),
            }),
          }
        }
        if (table === "win_slack_deliveries") {
          const next: DeliveryRow = {
            id: `del-${deliveries.length + 1}`,
            candidate_id: row.candidate_id as string,
            channel_id: row.channel_id as string,
            slack_ts: (row.slack_ts as string | null) ?? null,
            status: row.status as string,
            skip_reason: (row.skip_reason as string | null) ?? null,
            payload_hash: row.payload_hash as string,
            sent_at: (row.sent_at as string | null) ?? null,
          }
          if (
            next.status === "sent" &&
            deliveries.some(
              (existing) =>
                existing.status === "sent" &&
                existing.candidate_id === next.candidate_id &&
                existing.channel_id === next.channel_id
            )
          ) {
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: "23505", message: "duplicate sent delivery" },
                }),
              }),
            }
          }
          deliveries.push(next)
          return {
            select: () => ({
              single: async () => ({ data: { id: next.id }, error: null }),
            }),
          }
        }
        return {
          select: () => ({
            single: async () => ({ data: { id: "row-1" }, error: null }),
          }),
        }
      },
      then(
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown
      ) {
        return Promise.resolve(executeSelect()).then(resolve, reject)
      },
    }

    function executeSelect(): { data: unknown; error: null } {
      if (table === "win_candidates") {
        const rows = candidates.filter((candidate) => {
          if (filters.run_id && candidate.run_id !== filters.run_id) return false
          return true
        })
        return { data: rows, error: null }
      }
      if (table === "win_slack_deliveries") {
        const ids = filters.candidate_id__in as string[] | undefined
        const rows = deliveries.filter((row) => {
          if (filters.channel_id && row.channel_id !== filters.channel_id) return false
          if (filters.status && row.status !== filters.status) return false
          if (ids && !ids.includes(row.candidate_id)) return false
          return true
        })
        return { data: rows, error: null }
      }
      if (table === "win_detection_runs") {
        return { data: run ? [run] : [], error: null }
      }
      return { data: [], error: null }
    }

    return builder
  }

  return {
    from,
    deliveries,
    events,
  }
}

function mockSlackOk() {
  return vi.fn().mockResolvedValue(
    Response.json({
      ok: true,
      channel: SLACK_WINS_CHANNEL_ID_DEFAULT,
      ts: SLACK_TS,
    })
  )
}

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = TOKEN
  delete process.env.SLACK_WINS_CHANNEL_ID
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalToken === undefined) delete process.env.SLACK_BOT_TOKEN
  else process.env.SLACK_BOT_TOKEN = originalToken
  if (originalChannel === undefined) delete process.env.SLACK_WINS_CHANNEL_ID
  else process.env.SLACK_WINS_CHANNEL_ID = originalChannel
})

describe("WINS_RULES_V1 is not forked by Slack delivery", () => {
  it("keeps the published v1 numbers", () => {
    expect(WINS_RULES_V1).toMatchObject({
      version: "v1",
      pickupUpThreshold: 0.15,
      pickupDownThreshold: -0.15,
      minStlyRevenue: 5000,
      revparIndexWinFloor: 105,
      revparIndexQaCeiling: 250,
      maxStalenessDays: 2,
      pickupWindowDays: 31,
      extremeYoyPct: 3,
      occUpPpThreshold: 3,
      adrDownPctThreshold: -0.1,
    })
  })
})

describe("sanitizeSlackWinText", () => {
  it("strips broadcast mentions, Airbnb URLs, and credential-shaped tokens", () => {
    const cleaned = sanitizeSlackWinText(
      "Win @channel see https://www.airbnb.com/rooms/123 and token xoxb-aaa"
    )
    expect(cleaned).not.toMatch(/@channel|@here/)
    expect(cleaned).not.toMatch(/airbnb\.com/i)
    expect(cleaned).not.toMatch(/xoxb-/)
  })
})

describe("deliverWinSlackNotes", () => {
  it("posts a shareable unblocked candidate with template figures only", async () => {
    const fetchMock = mockSlackOk()
    vi.stubGlobal("fetch", fetchMock)
    const supabase = createMockSupabase({ candidates: [shareableCandidate()] })

    const result = await deliverWinSlackNotes({ supabase: supabase as never, runId: RUN_ID })

    expect(result).toMatchObject({
      considered: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
      channelId: SLACK_WINS_CHANNEL_ID_DEFAULT,
    })
    expect(fetchMock).toHaveBeenCalledOnce()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    })
    const posted = JSON.parse(String(init.body)) as { channel: string; text: string }
    expect(posted.channel).toBe(SLACK_WINS_CHANNEL_ID_DEFAULT)
    expect(posted.text).toContain("Win · Double Win · Rabbit Run · Aug–Oct 2026")
    expect(posted.text).toContain("$216,136")
    expect(posted.text).toContain("$36,794")
    expect(posted.text).not.toMatch(/airbnb\.com/i)
    expect(posted.text).not.toMatch(/@channel|@here/)
    expect(posted.text).not.toContain("TX | Grant")

    const composed = buildWinMessage(shareableCandidate())!
    const payload = buildWinSlackPayload(
      shareableCandidate(),
      composed.body,
      SLACK_WINS_CHANNEL_ID_DEFAULT
    )
    const allowed = new Set([
      ...extractNumbers(composed.body),
      ...extractNumbers(payload.header),
    ])
    for (const n of extractNumbers(posted.text)) {
      expect(allowed.has(n), `unexpected figure ${n} in Slack text`).toBe(true)
    }

    const sent = supabase.deliveries.find((row) => row.status === "sent")
    expect(sent).toMatchObject({
      candidate_id: SHAREABLE_ID,
      channel_id: SLACK_WINS_CHANNEL_ID_DEFAULT,
      slack_ts: SLACK_TS,
    })
    expect(supabase.events[0]).toMatchObject({
      candidate_id: SHAREABLE_ID,
      event_type: "slack_posted",
      metadata: {
        channel_id: SLACK_WINS_CHANNEL_ID_DEFAULT,
        slack_ts: SLACK_TS,
      },
    })

    const reconstructed = await findWinSlackDelivery(supabase as never, {
      candidateId: SHAREABLE_ID,
      channelId: SLACK_WINS_CHANNEL_ID_DEFAULT,
      slackTs: SLACK_TS,
    })
    expect(reconstructed?.candidate_id).toBe(SHAREABLE_ID)
    expect(reconstructed?.channel_id).toBe(SLACK_WINS_CHANNEL_ID_DEFAULT)
    expect(reconstructed?.slack_ts).toBe(SLACK_TS)
  })

  it("skips blocked and no-template candidates without calling Slack", async () => {
    const fetchMock = mockSlackOk()
    vi.stubGlobal("fetch", fetchMock)
    const supabase = createMockSupabase({
      candidates: [blockedCandidate(), noTemplateCandidate()],
    })

    const result = await deliverWinSlackNotes({ supabase: supabase as never, runId: RUN_ID })

    expect(result).toMatchObject({ considered: 2, sent: 0, skipped: 2, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(supabase.deliveries.map((row) => row.skip_reason)).toEqual([
      "blocked",
      "no_template",
    ])
    expect(supabase.events).toHaveLength(0)
  })

  it("does not post again when a sent row already exists", async () => {
    const fetchMock = mockSlackOk()
    vi.stubGlobal("fetch", fetchMock)
    const supabase = createMockSupabase({
      candidates: [shareableCandidate()],
      sent: [
        {
          candidate_id: SHAREABLE_ID,
          channel_id: SLACK_WINS_CHANNEL_ID_DEFAULT,
          slack_ts: SLACK_TS,
          status: "sent",
        },
      ],
    })

    const result = await deliverWinSlackNotes({ supabase: supabase as never, runId: RUN_ID })

    expect(result).toMatchObject({ considered: 1, sent: 0, skipped: 1, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(supabase.deliveries).toHaveLength(1)
  })

  it("skips slack_not_configured without throwing when the token is missing", async () => {
    delete process.env.SLACK_BOT_TOKEN
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const supabase = createMockSupabase({ candidates: [shareableCandidate()] })

    await expect(
      deliverWinSlackNotes({ supabase: supabase as never, runId: RUN_ID })
    ).resolves.toMatchObject({
      considered: 1,
      sent: 0,
      skipped: 1,
      failed: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(supabase.deliveries[0]?.skip_reason).toBe(SLACK_SKIP_NOT_CONFIGURED)
  })

  it("scores a dry run without posting or writing deliveries", async () => {
    const fetchMock = mockSlackOk()
    vi.stubGlobal("fetch", fetchMock)
    const supabase = createMockSupabase({
      candidates: [shareableCandidate(), blockedCandidate(), noTemplateCandidate()],
    })

    const result = await deliverWinSlackNotes({
      supabase: supabase as never,
      runId: RUN_ID,
      dryRun: true,
    })

    expect(result).toMatchObject({
      considered: 3,
      sent: 0,
      skipped: 3,
      failed: 0,
      wouldSend: 1,
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(supabase.deliveries).toHaveLength(0)
    expect(supabase.events).toHaveLength(0)
  })
})

describe("buildWinSlackPayload", () => {
  it("uses the public listing name in the header", () => {
    const candidate = shareableCandidate()
    const payload = buildWinSlackPayload(
      candidate,
      "Hi Grant, Rabbit Run is at $216,136.",
      SLACK_WINS_CHANNEL_ID_DEFAULT
    )
    expect(payload.header).toBe("Win · Double Win · Rabbit Run · Aug–Oct 2026")
    expect(payload.text).not.toContain("Michelle")
    expect(payload.payloadHash).toHaveLength(64)
  })
})

describe("wins-slack scheduling", () => {
  it("is not registered in vercel.json", () => {
    const vercel = readFileSync(join(process.cwd(), "vercel.json"), "utf8")
    expect(vercel).not.toContain("wins-slack")
  })
})
