import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

const mocks = vi.hoisted(() => ({
  requestData: vi.fn(),
  pollData: vi.fn(),
  ingest: vi.fn(),
}))
vi.mock("@/lib/report-builder/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/report-builder/client")>()),
  resolveTemplateId: vi.fn(async () => "12127"),
  requestData: mocks.requestData,
  pollData: mocks.pollData,
}))
vi.mock("@/lib/report-builder/ingest", () => ({ ingestReport: mocks.ingest }))

import {
  advanceReportBuilder,
  dailyWindowStart,
  isRunDue,
  tickReportBuilder,
} from "@/lib/report-builder/runner"

type Row = Record<string, unknown>

/**
 * Minimal in-memory stand-in for the report_runs PostgREST calls the runner
 * makes (filters eq/in/lt/gte, update/insert/select). Enforces the
 * one-active-run unique index like migration 20261017120000.
 */
function fakeSupabase(rows: Row[]) {
  let nextId = 1
  const active = (r: Row) => ["pending", "polling", "ingesting"].includes(r.status as string)
  function query() {
    const filters: ((r: Row) => boolean)[] = []
    let op: { kind: "select" | "update" | "insert"; values?: Row } = { kind: "select" }
    let returning = false
    let order: string | null = null
    const run = () => {
      if (op.kind === "insert") {
        if (active(op.values!) && rows.some(active)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } }
        }
        const row = {
          id: `run-${nextId++}`,
          poll_attempts: 0,
          started_at: new Date().toISOString(),
          ...op.values,
        }
        rows.push(row)
        return { data: [row], error: null }
      }
      let matched = rows.filter((r) => filters.every((f) => f(r)))
      if (order) matched = [...matched].sort((a, b) => String(b[order!]).localeCompare(String(a[order!])))
      if (op.kind === "update") {
        for (const r of matched) Object.assign(r, op.values)
        return { data: returning ? matched.map((r) => ({ ...r })) : null, error: null }
      }
      return { data: matched.map((r) => ({ ...r })), error: null }
    }
    const chain = {
      select: () => ((op.kind === "select" ? null : (returning = true)), chain),
      update: (values: Row) => ((op = { kind: "update", values }), chain),
      insert: (values: Row) => ((op = { kind: "insert", values }), chain),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), chain),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), chain),
      lt: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) < v), chain),
      gte: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) >= v), chain),
      order: (k: string) => ((order = k), chain),
      limit: () => chain,
      maybeSingle: async () => {
        const { data, error } = run()
        return { data: (data as Row[] | null)?.[0] ?? null, error }
      },
      single: async () => {
        const { data, error } = run()
        return { data: (data as Row[] | null)?.[0] ?? null, error }
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    }
    return chain
  }
  return { from: () => query() } as unknown as SupabaseClient
}

const NOW = new Date("2026-10-15T08:01:00Z")
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
const MIN = 60_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(console, "log").mockImplementation(() => {})
  mocks.ingest.mockResolvedValue({
    listingCount: 300,
    metricRowCount: 3600,
    unresolvedCount: 0,
    reportCurrency: "USD",
    errors: [],
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("daily schedule", () => {
  it("anchors the window at 08:00 UTC, using yesterday's before 08:00", () => {
    expect(dailyWindowStart(new Date("2026-10-15T09:30:00Z")).toISOString()).toBe(
      "2026-10-15T08:00:00.000Z"
    )
    expect(dailyWindowStart(new Date("2026-10-15T07:59:00Z")).toISOString()).toBe(
      "2026-10-14T08:00:00.000Z"
    )
  })

  it("is due once a day, then retries with backoff up to the cap", () => {
    expect(isRunDue(NOW, []).due).toBe(true)
    expect(
      isRunDue(NOW, [{ status: "completed", triggered_by: "manual", completed_at: iso(-MIN) }]).due
    ).toBe(false)
    const failed = (minsAgo: number) => ({
      status: "failed",
      triggered_by: "cron",
      completed_at: iso(-minsAgo * MIN),
    })
    expect(isRunDue(NOW, [failed(10)]).due).toBe(false) // 15 min backoff
    expect(isRunDue(NOW, [failed(16)]).due).toBe(true)
    expect(isRunDue(NOW, [failed(90), failed(20)]).due).toBe(false) // 30 min backoff
    expect(isRunDue(NOW, [failed(90), failed(31)]).due).toBe(true)
    expect(isRunDue(NOW, [failed(300), failed(200), failed(100), failed(99)]).due).toBe(false) // cap
  })
})

describe("tickReportBuilder", () => {
  it("starts a run and leaves it polling without waiting for the report", async () => {
    const rows: Row[] = []
    mocks.requestData.mockResolvedValue({ status: "IN_PROGRESS", request_id: "rb_1" })
    const result = await tickReportBuilder(fakeSupabase(rows), NOW)
    expect(result.status).toBe("polling")
    expect(mocks.pollData).not.toHaveBeenCalled()
    expect(rows[0]).toMatchObject({
      status: "polling",
      request_id: "rb_1",
      triggered_by: "cron",
      session_expires_at: iso(30 * MIN),
    })
  })

  it("polls once per tick, counting attempts across invocations", async () => {
    const rows: Row[] = [
      {
        id: "r1",
        status: "polling",
        request_id: "rb_1",
        poll_attempts: 4,
        started_at: iso(-5 * MIN),
        session_expires_at: iso(25 * MIN),
      },
    ]
    mocks.pollData.mockResolvedValue({ status: "IN_PROGRESS" })
    const supabase = fakeSupabase(rows)
    await tickReportBuilder(supabase, NOW)
    await tickReportBuilder(supabase, NOW)
    expect(mocks.pollData).toHaveBeenCalledTimes(2)
    expect(rows[0]).toMatchObject({ status: "polling", poll_attempts: 6 })
  })

  it("ingests when the report is ready and only marks completed through ingest", async () => {
    const rows: Row[] = [
      {
        id: "r1",
        status: "polling",
        request_id: "rb_1",
        poll_attempts: 2,
        started_at: iso(-3 * MIN),
        session_expires_at: iso(27 * MIN),
      },
    ]
    mocks.pollData.mockResolvedValue({ status: "completed", data: { report_data: [{}] } })
    const result = await tickReportBuilder(fakeSupabase(rows), NOW)
    expect(result.status).toBe("completed")
    expect(mocks.ingest).toHaveBeenCalledOnce()
    // The fake ingest doesn't stamp completed; the runner leaves that to it.
    expect(rows[0].status).toBe("ingesting")
  })

  it("never ingests twice when two invocations race on the same poll", async () => {
    const rows: Row[] = [
      {
        id: "r1",
        status: "polling",
        request_id: "rb_1",
        poll_attempts: 0,
        started_at: iso(-3 * MIN),
        session_expires_at: iso(27 * MIN),
      },
    ]
    mocks.pollData.mockResolvedValue({ status: "completed", data: { report_data: [{}] } })
    const supabase = fakeSupabase(rows)
    const results = await Promise.all([
      tickReportBuilder(supabase, NOW),
      advanceReportBuilder(supabase, { triggeredBy: "manual" }),
    ])
    expect(mocks.ingest).toHaveBeenCalledOnce()
    expect(results.map((r) => r.status).sort()).toEqual(["completed", "noop"])
  })

  it("fails an expired run at expiry, then retries once the backoff elapses", async () => {
    const at = (mins: number) => new Date(NOW.getTime() + mins * MIN)
    const rows: Row[] = [
      {
        id: "r1",
        status: "polling",
        triggered_by: "cron",
        request_id: "rb_1",
        poll_attempts: 30,
        started_at: NOW.toISOString(),
        session_expires_at: iso(30 * MIN),
      },
    ]
    const supabase = fakeSupabase(rows)
    vi.setSystemTime(at(31))
    const reaped = await tickReportBuilder(supabase, at(31))
    expect(rows[0]).toMatchObject({
      status: "failed",
      error_reason: "session_expired",
      completed_at: at(31).toISOString(),
    })
    expect(reaped.status).toBe("noop")
    expect(mocks.requestData).not.toHaveBeenCalled()

    mocks.requestData.mockResolvedValue({ status: "IN_PROGRESS", request_id: "rb_2" })
    vi.setSystemTime(at(47))
    const retried = await tickReportBuilder(supabase, at(47))
    expect(retried.status).toBe("polling")
    expect(rows[1]).toMatchObject({ status: "polling", request_id: "rb_2", triggered_by: "cron" })
  })

  it("does not start a second run while one is active", async () => {
    const rows: Row[] = [
      { id: "r1", status: "pending", started_at: NOW.toISOString(), poll_attempts: 0 },
    ]
    const result = await advanceReportBuilder(fakeSupabase(rows), { triggeredBy: "manual" })
    expect(result.status).toBe("polling")
    expect(rows).toHaveLength(1)
    expect(mocks.requestData).not.toHaveBeenCalled()
  })

  it("fails the run with a useful reason when ingestion breaks", async () => {
    const rows: Row[] = [
      {
        id: "r1",
        status: "polling",
        request_id: "rb_1",
        poll_attempts: 1,
        started_at: iso(-3 * MIN),
        session_expires_at: iso(27 * MIN),
      },
    ]
    mocks.pollData.mockResolvedValue({ status: "completed", data: { report_data: [{}] } })
    mocks.ingest.mockRejectedValue(new Error("report_metrics upsert [0-500]: boom"))
    const result = await tickReportBuilder(fakeSupabase(rows), NOW)
    expect(result.status).toBe("failed")
    expect(rows[0]).toMatchObject({
      status: "failed",
      error_reason: "ingest failed: report_metrics upsert [0-500]: boom",
    })
  })

  it("keeps polling after a transient PriceLabs error and records it", async () => {
    const rows: Row[] = [
      {
        id: "r1",
        status: "polling",
        request_id: "rb_1",
        poll_attempts: 1,
        started_at: iso(-3 * MIN),
        session_expires_at: iso(27 * MIN),
      },
    ]
    mocks.pollData.mockRejectedValue(new Error("Report Builder API error 502: Bad Gateway"))
    const result = await tickReportBuilder(fakeSupabase(rows), NOW)
    expect(result.status).toBe("polling")
    expect(rows[0]).toMatchObject({
      status: "polling",
      poll_attempts: 2,
      error_reason: "poll error (attempt 2): Report Builder API error 502: Bad Gateway",
    })
  })
})
