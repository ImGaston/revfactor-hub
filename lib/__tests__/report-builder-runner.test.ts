import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { SupabaseClient } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/report-builder/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/report-builder/client")>()),
  resolveTemplateId: vi.fn(),
  requestData: vi.fn(),
  pollData: vi.fn(),
}))
vi.mock("@/lib/report-builder/ingest", () => ({ ingestReport: vi.fn() }))

import {
  pollData,
  REPORT_BUILDER_FETCH_TIMEOUT_MS,
  requestData,
  resolveTemplateId,
  type ReportEnvelope,
} from "@/lib/report-builder/client"
import { ingestReport } from "@/lib/report-builder/ingest"
import {
  advanceReportBuilder,
  INGEST_RESERVE_MS,
  INLINE_DEADLINE_MS,
  type RunnerClock,
} from "@/lib/report-builder/runner"

// --- In-memory report_runs ---------------------------------------------------

type Row = Record<string, unknown>

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: ((row: Row) => boolean)[] = []
  private op: "select" | "update" | "insert" = "select"
  private values: Row = {}
  private returning = false
  private sort: { column: string; ascending: boolean } | null = null
  private max: number | null = null

  constructor(
    private rows: Row[],
    private nextId: () => string
  ) {}

  select() {
    if (this.op !== "select") this.returning = true
    return this
  }
  update(values: Row) {
    this.op = "update"
    this.values = values
    return this
  }
  insert(values: Row) {
    this.op = "insert"
    this.values = values
    return this
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }
  lt(column: string, value: string) {
    this.filters.push((row) => row[column] != null && String(row[column]) < value)
    return this
  }
  gte(column: string, value: string) {
    this.filters.push((row) => row[column] != null && String(row[column]) >= value)
    return this
  }
  order(column: string, { ascending }: { ascending: boolean }) {
    this.sort = { column, ascending }
    return this
  }
  limit(n: number) {
    this.max = n
    return this
  }

  // Runs when awaited, like PostgREST: each statement is atomic.
  private execute(): Row[] {
    if (this.op === "insert") {
      const row = { id: this.nextId(), poll_attempts: 0, ...this.values }
      this.rows.push(row)
      return [{ ...row }]
    }
    let matched = this.rows.filter((row) => this.filters.every((f) => f(row)))
    if (this.op === "update") {
      for (const row of matched) Object.assign(row, this.values)
      return matched.map((row) => ({ ...row }))
    }
    if (this.sort) {
      const { column, ascending } = this.sort
      matched = [...matched].sort((a, b) =>
        String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1)
      )
    }
    if (this.max != null) matched = matched.slice(0, this.max)
    return matched.map((row) => ({ ...row }))
  }

  single() {
    const data = this.execute()
    return Promise.resolve({ data: data[0] ?? null, error: null })
  }
  maybeSingle() {
    return this.single()
  }
  then<A, B>(
    onFulfilled?: ((value: { data: unknown; error: null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ) {
    const data = this.execute()
    const result = { data: this.op === "update" && !this.returning ? null : data, error: null }
    return Promise.resolve(result).then(onFulfilled, onRejected)
  }
}

function createFakeSupabase(seed: Row[] = []) {
  const rows = seed.map((row) => ({ ...row }))
  let id = 0
  const client = {
    from(table: string) {
      if (table !== "report_runs") throw new Error(`unexpected table ${table}`)
      return new FakeQuery(rows, () => `run-${++id}`)
    },
  } as unknown as SupabaseClient
  return { client, rows }
}

// --- Virtual clock + PriceLabs stand-ins ----------------------------------------

// The 2026-10-04 cron fired at 08:58:37 UTC.
const START = Date.parse("2026-10-04T08:58:37.000Z")
const POLL_LATENCY_MS = 700

function createClock(start = START): RunnerClock & { advance: (ms: number) => void } {
  let now = start
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
    advance: (ms) => {
      now += ms
    },
  }
}

const IN_PROGRESS: ReportEnvelope = { status: "IN_PROGRESS", request_id: "rb_test" }
const COMPLETED: ReportEnvelope = {
  status: "completed",
  data: { report_data: [{ "Listing ID": "1", "Year Month": "2026-10.Oct" }], report_currency: "USD" },
}

/** PriceLabs finishes generating `readyAfterMs` after `from`; records poll start times. */
function generateFor(clock: ReturnType<typeof createClock>, readyAfterMs: number, from = START) {
  const pollStarts: number[] = []
  vi.mocked(pollData).mockImplementation(async () => {
    pollStarts.push(clock.now())
    clock.advance(POLL_LATENCY_MS)
    return clock.now() - from >= readyAfterMs ? COMPLETED : IN_PROGRESS
  })
  return pollStarts
}

function iso(ms: number) {
  return new Date(ms).toISOString()
}

let rowsRef: Row[] = []

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.mocked(resolveTemplateId).mockResolvedValue("12127")
  vi.mocked(requestData).mockResolvedValue(IN_PROGRESS)
  // ingestReport stamps the run completed, like the real one.
  vi.mocked(ingestReport).mockImplementation(async (_supabase, runId) => {
    const row = rowsRef.find((r) => r.id === runId)
    if (row) row.status = "completed"
    return {
      listingCount: 318,
      metricRowCount: 3816,
      unresolvedCount: 0,
      skippedRows: 0,
      reportCurrency: "USD",
      errors: [],
    }
  })
})

function setup(seed: Row[] = []) {
  const fake = createFakeSupabase(seed)
  rowsRef = fake.rows
  return fake
}

// --- Tests -----------------------------------------------------------------

describe("advanceReportBuilder", () => {
  it("finishes a report that takes 90s to generate within one cron invocation", async () => {
    const { client, rows } = setup()
    const clock = createClock()
    generateFor(clock, 90_000)

    const result = await advanceReportBuilder(client, { triggeredBy: "cron", clock })

    expect(result.status).toBe("completed")
    expect(ingestReport).toHaveBeenCalledTimes(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: "completed", request_id: "rb_test" })
  })

  it("reproduces the outage: ~23s left after the pl_* sync never sees completion", async () => {
    const { client, rows } = setup()
    const clock = createClock()
    generateFor(clock, 90_000)

    // What the cron passed before this fix (52s budget minus ~29s of pl_* sync).
    const result = await advanceReportBuilder(client, {
      triggeredBy: "cron",
      inlineDeadlineMs: 23_000,
      clock,
    })

    expect(result.status).toBe("polling")
    expect(ingestReport).not.toHaveBeenCalled()
    expect(rows[0]).toMatchObject({ status: "polling", poll_attempts: 4 })
  })

  it("never starts a poll after the inline deadline, leaving room to ingest", async () => {
    const { client, rows } = setup()
    const clock = createClock()
    const pollStarts = generateFor(clock, Number.POSITIVE_INFINITY)

    const result = await advanceReportBuilder(client, { triggeredBy: "cron", clock })

    expect(result.status).toBe("polling")
    const lastPollAt = Math.max(...pollStarts) - START
    expect(lastPollAt).toBeLessThanOrEqual(INLINE_DEADLINE_MS)
    expect(lastPollAt + REPORT_BUILDER_FETCH_TIMEOUT_MS + INGEST_RESERVE_MS).toBeLessThanOrEqual(
      300_000
    )
    expect(rows[0].poll_attempts).toBe(pollStarts.length)
  })

  it("stops polling a resumed run at its PriceLabs session expiry and keeps counting attempts", async () => {
    const issuedAt = START - 30 * 60 * 1000 + 20_000
    const expiresAt = START + 20_000
    const { client, rows } = setup([
      {
        id: "manual-run",
        status: "polling",
        request_id: "rb_manual",
        started_at: iso(issuedAt),
        session_expires_at: iso(expiresAt),
        poll_attempts: 8,
      },
    ])
    const clock = createClock()
    const pollStarts = generateFor(clock, Number.POSITIVE_INFINITY, issuedAt)

    const result = await advanceReportBuilder(client, { triggeredBy: "manual", clock })

    expect(result).toMatchObject({ runId: "manual-run", status: "polling" })
    expect(requestData).not.toHaveBeenCalled()
    expect(pollData).toHaveBeenCalledWith("rb_manual")
    expect(Math.max(...pollStarts)).toBeLessThanOrEqual(expiresAt)
    expect(rows[0].poll_attempts).toBe(8 + pollStarts.length)
  })

  it("resumes an in-window run left by an earlier sync and ingests it", async () => {
    const issuedAt = START - 5 * 60 * 1000
    const { client, rows } = setup([
      {
        id: "manual-run",
        status: "polling",
        request_id: "rb_manual",
        started_at: iso(issuedAt),
        session_expires_at: iso(issuedAt + 30 * 60 * 1000),
        poll_attempts: 8,
      },
    ])
    const clock = createClock()
    generateFor(clock, 0, issuedAt)

    const result = await advanceReportBuilder(client, { triggeredBy: "cron", clock })

    expect(result).toMatchObject({ runId: "manual-run", status: "completed" })
    expect(requestData).not.toHaveBeenCalled()
    expect(rows).toHaveLength(1)
  })

  it("reaps an expired polling run, then triggers and completes a fresh one", async () => {
    const yesterday = START - 24 * 60 * 60 * 1000
    const { client, rows } = setup([
      {
        id: "yesterday",
        status: "polling",
        request_id: "rb_old",
        started_at: iso(yesterday),
        session_expires_at: iso(yesterday + 30 * 60 * 1000),
        poll_attempts: 4,
      },
    ])
    const clock = createClock()
    generateFor(clock, 60_000)

    const result = await advanceReportBuilder(client, { triggeredBy: "cron", clock })

    expect(rows.find((r) => r.id === "yesterday")).toMatchObject({
      status: "failed",
      error_reason: "session_expired",
    })
    expect(result.status).toBe("completed")
    expect(pollData).not.toHaveBeenCalledWith("rb_old")
  })

  it("fails runs stranded in 'ingesting' by a cut-off function, but not a live ingest", async () => {
    const { client, rows } = setup([
      // 2026-08-18's cron run hit maxDuration 60 mid-ingest and never left 'ingesting'.
      { id: "stranded", status: "ingesting", started_at: "2026-08-18T08:53:43.000Z" },
      { id: "live", status: "ingesting", started_at: iso(START - 60_000) },
    ])
    const clock = createClock()
    vi.mocked(requestData).mockResolvedValue(COMPLETED)

    await advanceReportBuilder(client, { triggeredBy: "cron", clock })

    expect(rows.find((r) => r.id === "stranded")).toMatchObject({
      status: "failed",
      error_reason: "ingest_interrupted",
    })
    expect(rows.find((r) => r.id === "live")?.status).toBe("ingesting")
  })

  it("ingests a completed report once when a cron and a manual sync poll it together", async () => {
    const issuedAt = START - 60_000
    const { client } = setup([
      {
        id: "shared",
        status: "polling",
        request_id: "rb_shared",
        started_at: iso(issuedAt),
        session_expires_at: iso(issuedAt + 30 * 60 * 1000),
        poll_attempts: 2,
      },
    ])
    const clock = createClock()
    generateFor(clock, 0, issuedAt)

    const results = await Promise.all([
      advanceReportBuilder(client, { triggeredBy: "cron", clock }),
      advanceReportBuilder(client, { triggeredBy: "manual", clock }),
    ])

    expect(ingestReport).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.status).sort()).toEqual(["completed", "noop"])
  })
})

describe("routes hosting the Report Builder fit its inline budget", () => {
  const requiredSeconds =
    (INLINE_DEADLINE_MS + REPORT_BUILDER_FETCH_TIMEOUT_MS + INGEST_RESERVE_MS) / 1000

  it.each([
    "app/api/cron/sync-pricelabs/route.ts",
    "app/api/cron/report-builder/route.ts",
    "app/(authenticated)/settings/listings/page.tsx",
  ])("%s allows the full poll + ingest", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8")
    const match = source.match(/export const maxDuration = (\d+)/)

    expect(match).not.toBeNull()
    expect(Number(match![1])).toBeGreaterThanOrEqual(requiredSeconds)
    expect(Number(match![1])).toBeLessThanOrEqual(300)
  })

  it("the cron does not shrink the Report Builder budget to the pl_* sync's leftovers", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/cron/sync-pricelabs/route.ts"),
      "utf8"
    )
    expect(source).not.toContain("inlineDeadlineMs")
  })
})
