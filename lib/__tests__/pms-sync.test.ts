import { readFileSync } from "node:fs"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

// Client PMS connections, phase 2: Hospitable reservation normalization,
// windows/chunking, fetch pagination + 429 backoff, the idempotent sync
// upsert, the Goals tab loader's source preference and the sync permission gate.

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  getUser: vi.fn(),
  sessionFrom: vi.fn(),
  syncPmsConnection: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/permissions.server", () => ({ hasPermission: mocks.permission }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.sessionFrom }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("admin client must not be created in these tests")
  },
}))

import { fetchHospitableReservations } from "@/lib/hospitable-client.server"
import {
  formatPmsCoverage,
  minorToMajor,
  normalizeHospitableReservation,
  planChunks,
  pmsRowsToPlanReservations,
  PMS_RESERVATION_UPSERT_KEY,
  syncWindow,
  type NormalizedPmsReservation,
  type PmsHistoryRow,
} from "@/lib/pms-reservations"
import { planSyncRun, syncPmsConnection } from "@/lib/pms-sync.server"
import { buildHistory } from "@/lib/pricing-plan"
import type { PmsAdapter } from "@/lib/pms-adapters.server"

const PROP_A = "3866dd2e-8d12-4908-bdf9-336235fd76ff"
const PROP_B = "b7bf14a0-6608-494a-9476-20c4007a0d1b"
const PROP_IGNORED = "765c3827-69a5-4a95-9b3f-fd360a5d2a3b"
const LISTING_A = "86bfb5c2-ad6a-4322-a847-24b1c0290b8a"
const LISTING_B = "bfc44a42-29c4-4522-b099-78e8885374ba"
const CONNECTION = "c08a6871-b0f6-4aee-8045-bad82bde5250"
const CLIENT = "4740a830-a348-85fa-bee2-87292ff47412"

/** A Hospitable reservation carrying every PII field we must drop. */
function hospitableRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1b2c3d4-0000-4000-8000-000000000001",
    code: "HMABC12345",
    platform: "airbnb",
    platform_id: "HMABC12345",
    booking_date: "2026-05-02T18:30:00-07:00",
    arrival_date: "2026-07-10T16:00:00-07:00",
    departure_date: "2026-07-14T10:00:00-07:00",
    nights: 4,
    reservation_status: { current: { category: "accepted", sub_category: null }, history: [] },
    guests: { total: 5, adult_count: 4, child_count: 1, infant_count: 0, pet_count: 0 },
    guest: { first_name: "Jane", last_name: "Doe", email: "jane@example.com", phone_numbers: ["+15550100"] },
    door_code: "4821",
    notes: "Late arrival, gate code 4821",
    properties: [{ id: PROP_A, name: "Doodlebug de Sedona", address: { street: "1 Main St" } }],
    financials: {
      currency: "USD",
      host: {
        accommodation: { amount: 120000, formatted: "$1,200.00" },
        discounts: [{ amount: -12000, category: "Weekly discount", label: "Discount for Jane Doe" }],
        guest_fees: [
          { amount: 15000, category: "Cleaning fee", label: "Cleaning" },
          { amount: 2500, category: "Pet fee", label: "Pet" },
        ],
        host_fees: [{ amount: -16740, category: "Host service fee", label: "Airbnb fee HMABC12345" }],
        adjustments: [{ amount: -1000, category: "Resolution", label: "Resolution ref 99881 for Jane" }],
        taxes: [],
        revenue: { amount: 109760, formatted: "$1,097.60" },
      },
      guest: { accommodation: { amount: 108000 }, total_price: { amount: 140000 } },
    },
    ...overrides,
  }
}

describe("normalizeHospitableReservation", () => {
  it("maps money in minor units: rent = host accommodation + signed discounts", () => {
    const row = normalizeHospitableReservation(hospitableRow(), [PROP_A, PROP_B])!
    expect(row).toMatchObject({
      external_reservation_id: "a1b2c3d4-0000-4000-8000-000000000001",
      external_property_id: PROP_A,
      platform: "airbnb",
      status: "accepted",
      booked_at: "2026-05-03T01:30:00.000Z",
      booked_date: "2026-05-02",
      check_in: "2026-07-10",
      check_out: "2026-07-14",
      nights: 4,
      guests: 5,
      currency: "USD",
      accommodation_minor: 108000,
      discounts_minor: -12000,
      cleaning_fee_minor: 15000,
      host_fees_minor: -16740,
      host_revenue_minor: 109760,
    })
  })

  it("keeps the provider's local check-in day (no UTC shift)", () => {
    const row = normalizeHospitableReservation(
      hospitableRow({ arrival_date: "2026-07-10T23:30:00-07:00" }),
      [PROP_A]
    )!
    expect(row.check_in).toBe("2026-07-10")
  })

  it("never carries guest names, contacts, messages, door or confirmation codes", () => {
    const row = normalizeHospitableReservation(hospitableRow(), [PROP_A])!
    expect(Object.keys(row).sort()).toEqual(
      [
        "accommodation_minor",
        "booked_at",
        "booked_date",
        "check_in",
        "check_out",
        "cleaning_fee_minor",
        "currency",
        "discounts_minor",
        "external_property_id",
        "external_reservation_id",
        "financials",
        "guests",
        "host_fees_minor",
        "host_revenue_minor",
        "nights",
        "platform",
        "status",
      ].sort()
    )
    const json = JSON.stringify(row)
    for (const secret of ["Jane", "Doe", "jane@example.com", "+15550100", "4821", "HMABC12345", "99881", "Main St", "gate"]) {
      expect(json).not.toContain(secret)
    }
    // Trimmed financials keep amounts + categories only.
    expect(row.financials?.discounts).toEqual([{ amount: -12000, category: "Weekly discount" }])
  })

  it("keeps cancellations as a status, and normalizes legacy statuses", () => {
    const cancelled = normalizeHospitableReservation(
      hospitableRow({ reservation_status: { current: { category: "cancelled" } } }),
      [PROP_A]
    )!
    expect(cancelled.status).toBe("cancelled")
    const legacy = normalizeHospitableReservation(
      hospitableRow({ reservation_status: undefined, status: "Not Accepted" }),
      [PROP_A]
    )!
    expect(legacy.status).toBe("not_accepted")
    const odd = normalizeHospitableReservation(hospitableRow({ reservation_status: { current: { category: "weird" } } }), [
      PROP_A,
    ])!
    expect(odd.status).toBe("unknown")
  })

  it("leaves missing money as null (not zero) and falls back to guest accommodation", () => {
    const row = normalizeHospitableReservation(
      hospitableRow({ financials: { currency: "USD", guest: { accommodation: { amount: 50000 } } } }),
      [PROP_A]
    )!
    expect(row.accommodation_minor).toBe(50000)
    expect(row.host_revenue_minor).toBeNull()
    expect(row.host_fees_minor).toBeNull()
    expect(row.cleaning_fee_minor).toBeNull()
  })

  it("rejects rows outside the requested properties or without a check-in", () => {
    expect(normalizeHospitableReservation(hospitableRow({ properties: [{ id: PROP_IGNORED }] }), [PROP_A])).toBeNull()
    expect(normalizeHospitableReservation(hospitableRow({ properties: [{ id: PROP_A }, { id: PROP_B }] }), [PROP_A, PROP_B])).toBeNull()
    expect(normalizeHospitableReservation(hospitableRow({ arrival_date: null, check_in: null }), [PROP_A])).toBeNull()
    // Without the properties include, only a single-property request is unambiguous.
    expect(normalizeHospitableReservation(hospitableRow({ properties: undefined }), [PROP_A])?.external_property_id).toBe(PROP_A)
    expect(normalizeHospitableReservation(hospitableRow({ properties: undefined }), [PROP_A, PROP_B])).toBeNull()
  })
})

describe("sync windows and chunks", () => {
  it("backfills from 2024-01-01 and incremental re-pulls 30 days, both to +18 months", () => {
    expect(syncWindow("backfill", "2026-10-16")).toEqual({ start: "2024-01-01", end: "2028-04-16" })
    expect(syncWindow("incremental", "2026-10-16")).toEqual({ start: "2026-09-16", end: "2028-04-16" })
  })

  it("splits a window into contiguous, non-overlapping chunks of at most 3 months", () => {
    const chunks = planChunks({ start: "2024-01-01", end: "2028-04-16" })
    expect(chunks[0]).toEqual({ start: "2024-01-01", end: "2024-03-31" })
    expect(chunks.at(-1)).toEqual({ start: "2028-04-01", end: "2028-04-16" })
    for (let i = 1; i < chunks.length; i++) {
      const prevEnd = new Date(chunks[i - 1].end + "T00:00:00Z")
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1)
      expect(chunks[i].start).toBe(prevEnd.toISOString().slice(0, 10))
    }
    for (const c of chunks) {
      const days = (Date.parse(c.end) - Date.parse(c.start)) / 86_400_000
      expect(days).toBeLessThanOrEqual(92)
    }
    expect(chunks).toHaveLength(18)
    expect(planChunks({ start: "2026-05-01", end: "2026-04-01" })).toEqual([])
  })

  it("formats coverage like the card shows it", () => {
    expect(formatPmsCoverage("2024-01-01", "2028-04-16", 412)).toBe("Jan 2024 – Apr 2028 · 412 stays")
    expect(formatPmsCoverage("2024-01-01", "2028-04-16", 1)).toBe("Jan 2024 – Apr 2028 · 1 stay")
  })

  it("resumes a partial backfill from its cursor and switches to incremental after a backfill succeeded", () => {
    const partial = {
      id: "r1",
      mode: "backfill" as const,
      status: "partial",
      window_start: "2024-01-01",
      window_end: "2028-04-15",
      next_chunk_start: "2025-07-01",
      coverage_start: null,
    }
    expect(
      planSyncRun({ requested: "auto", today: "2026-10-16", lastFinished: partial, hasSucceededBackfill: false, lastSucceeded: null })
    ).toEqual({ mode: "backfill", window: { start: "2024-01-01", end: "2028-04-15" }, cursor: "2025-07-01", coverageStart: "2024-01-01" })

    const done = { ...partial, status: "succeeded", next_chunk_start: null, coverage_start: "2024-01-01" }
    expect(
      planSyncRun({ requested: "auto", today: "2026-10-17", lastFinished: done, hasSucceededBackfill: true, lastSucceeded: done })
    ).toEqual({ mode: "incremental", window: { start: "2026-09-17", end: "2028-04-17" }, cursor: "2026-09-17", coverageStart: "2024-01-01" })
  })
})

describe("fetchHospitableReservations", () => {
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

  it("pages through meta.last_page with properties[] and a check-in window", async () => {
    const urls: URL[] = []
    const fetcher = vi.fn(async (url: URL) => {
      urls.push(url)
      const page = Number(url.searchParams.get("page"))
      const row = hospitableRow({ id: `res-${page}` })
      return json({ data: [row], meta: { current_page: page, last_page: 2, total: 2 } })
    })
    const result = await fetchHospitableReservations(
      "pat_token",
      { propertyIds: [PROP_A, PROP_B], window: { start: "2026-07-01", end: "2026-09-30" } },
      { fetcher, now: () => 0, deadline: 60_000 }
    )
    expect(result.ok && result.data.map((r) => r.external_reservation_id)).toEqual(["res-1", "res-2"])
    expect(urls).toHaveLength(2)
    expect(urls[0].origin + urls[0].pathname).toBe("https://public.api.hospitable.com/v2/reservations")
    expect(urls[0].searchParams.getAll("properties[]")).toEqual([PROP_A, PROP_B])
    expect(urls[0].searchParams.get("start_date")).toBe("2026-07-01")
    expect(urls[0].searchParams.get("end_date")).toBe("2026-09-30")
    expect(urls[0].searchParams.get("date_query")).toBe("checkin")
    expect(urls[0].searchParams.get("include")).toBe("financials,properties")
    expect(urls[0].searchParams.get("per_page")).toBe("100")
  })

  it("backs off on 429 (Retry-After) and then succeeds", async () => {
    const sleep = vi.fn(async () => undefined)
    let calls = 0
    const fetcher = vi.fn(async () => {
      calls++
      if (calls === 1) return new Response(null, { status: 429, headers: { "retry-after": "3" } })
      return json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
    })
    const result = await fetchHospitableReservations(
      "pat_token",
      { propertyIds: [PROP_A], window: { start: "2026-07-01", end: "2026-09-30" } },
      { fetcher, sleep, now: () => 0, deadline: 60_000 }
    )
    expect(result).toEqual({ ok: true, data: [] })
    expect(sleep).toHaveBeenCalledWith(3000)
  })

  it("gives up on 429 instead of waiting past the deadline", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "30" } }))
    const result = await fetchHospitableReservations(
      "pat_token",
      { propertyIds: [PROP_A], window: { start: "2026-07-01", end: "2026-09-30" } },
      { fetcher, sleep: vi.fn(), now: () => 0, deadline: 20_000 }
    )
    expect(result).toMatchObject({ ok: false, code: "rate_limited" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("fails closed on bad pagination, duplicates and rows for other properties", async () => {
    const run = (body: unknown) =>
      fetchHospitableReservations(
        "pat_token",
        { propertyIds: [PROP_A], window: { start: "2026-07-01", end: "2026-09-30" } },
        { fetcher: async () => json(body), now: () => 0, deadline: 60_000 }
      )
    expect(await run({ data: [] })).toEqual({ ok: false, code: "unexpected_response" })
    expect(
      await run({ data: [hospitableRow(), hospitableRow()], meta: { current_page: 1, last_page: 1, total: 2 } })
    ).toEqual({ ok: false, code: "unexpected_response" })
    expect(
      await run({ data: [hospitableRow({ properties: [{ id: PROP_IGNORED }] })], meta: { current_page: 1, last_page: 1, total: 1 } })
    ).toEqual({ ok: false, code: "unexpected_response" })
    expect(await run({ data: [hospitableRow()], meta: { current_page: 1, last_page: 1, total: 3 } })).toEqual({
      ok: false,
      code: "unexpected_response",
    })
  })
})

// ---------------------------------------------------------------------------
// In-memory Supabase for the sync service
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function memoryDb(initial: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = structuredClone(initial)
  const upserts: { table: string; onConflict?: string; rows: Row[] }[] = []
  let seq = 0

  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    let mode: "select" | "insert" | "update" | "upsert" = "select"
    let payload: Row | Row[] | null = null
    let head = false
    let order: [string, boolean] | null = null
    let limit: number | null = null
    let single: "single" | "maybe" | null = null
    let selectAfter = false

    const exec = () => {
      const all = (tables[table] ??= [])
      if (mode === "insert") {
        const rows = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({ id: `id-${++seq}`, ...r }))
        all.push(...rows)
        return { data: selectAfter ? (single ? rows[0] : rows) : null, error: null }
      }
      if (mode === "upsert") {
        return { data: null, error: null }
      }
      let rows = all.filter((r) => filters.every((f) => f(r)))
      if (mode === "update") {
        rows.forEach((r) => Object.assign(r, payload))
        return { data: null, error: null }
      }
      if (order) {
        const [col, asc] = order
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1))
      }
      if (limit != null) rows = rows.slice(0, limit)
      if (head) return { data: null, count: rows.length, error: null }
      if (single) return { data: rows[0] ?? null, error: null }
      return { data: rows, error: null }
    }

    const b: Record<string, unknown> = {
      select(_c?: string, opts?: { head?: boolean }) {
        if (mode === "insert") selectAfter = true
        head = Boolean(opts?.head)
        return b
      },
      insert(p: Row | Row[]) {
        mode = "insert"
        payload = p
        return b
      },
      update(p: Row) {
        mode = "update"
        payload = p
        return b
      },
      upsert(rows: Row[], opts?: { onConflict?: string }) {
        mode = "upsert"
        upserts.push({ table, onConflict: opts?.onConflict, rows })
        const keys = (opts?.onConflict ?? "id").split(",")
        const all = (tables[table] ??= [])
        for (const r of rows) {
          const hit = all.find((x) => keys.every((k) => x[k] === r[k]))
          if (hit) Object.assign(hit, r)
          else all.push({ id: `id-${++seq}`, first_seen_at: `seen-${seq}`, ...r })
        }
        return b
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
      lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), b),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
      not: (c: string) => (filters.push((r) => r[c] != null), b),
      order: (c: string, o?: { ascending?: boolean }) => ((order = [c, o?.ascending !== false]), b),
      limit: (n: number) => ((limit = n), b),
      single: () => ((single = "single"), b),
      maybeSingle: () => ((single = "maybe"), b),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(resolve, reject),
    }
    return b
  }

  const rpc = vi.fn(async (name: string) =>
    name === "pms_connection_secret"
      ? { data: JSON.stringify({ v: 1, provider: "hospitable", fields: { token: "pat_token" } }), error: null }
      : { data: null, error: { message: "unknown rpc" } }
  )
  return { client: { from, rpc } as never, tables, upserts }
}

function kenDb() {
  return memoryDb({
    client_pms_connections: [{ id: CONNECTION, client_id: CLIENT, provider: "hospitable", status: "connected" }],
    client_pms_properties: [
      { connection_id: CONNECTION, client_id: CLIENT, external_property_id: PROP_A, mapped_listing_id: LISTING_A, mapping_status: "confirmed" },
      { connection_id: CONNECTION, client_id: CLIENT, external_property_id: PROP_B, mapped_listing_id: LISTING_B, mapping_status: "confirmed" },
      { connection_id: CONNECTION, client_id: CLIENT, external_property_id: PROP_IGNORED, mapped_listing_id: null, mapping_status: "ignored" },
    ],
    pms_sync_runs: [],
    pms_reservations: [],
  })
}

function reservation(id: string, propertyId: string, status: NormalizedPmsReservation["status"] = "accepted") {
  // A future stay: inside both the backfill and the incremental window.
  const row = hospitableRow({
    id,
    properties: [{ id: propertyId }],
    arrival_date: "2026-11-20T16:00:00-07:00",
    departure_date: "2026-11-24T10:00:00-07:00",
  })
  return { ...normalizeHospitableReservation(row, [propertyId])!, status }
}

function fakeAdapter(byWindow: (window: { start: string; end: string }) => NormalizedPmsReservation[]) {
  const fetchReservations = vi.fn(async (req: { propertyIds: string[]; window: { start: string; end: string } }) => ({
    ok: true as const,
    data: byWindow(req.window),
  }))
  const adapter: PmsAdapter = {
    provider: "hospitable",
    chunkMonths: 3,
    open: async () => ({ ok: true, data: { discoverProperties: vi.fn(), fetchReservations } }),
  }
  return { adapter, fetchReservations }
}

describe("syncPmsConnection", () => {
  const NOW = Date.parse("2026-10-16T08:00:00Z")

  it("fetches confirmed mappings only and upserts idempotently on (connection, reservation id)", async () => {
    const db = kenDb()
    let status: NormalizedPmsReservation["status"] = "accepted"
    const { adapter, fetchReservations } = fakeAdapter((w) =>
      w.start <= "2026-11-20" && w.end >= "2026-11-20" ? [reservation("res-1", PROP_A, status), reservation("res-2", PROP_B)] : []
    )
    const deps = { supabase: db.client, now: () => NOW, getAdapter: () => adapter }

    const first = await syncPmsConnection(CONNECTION, { trigger: "manual", deadline: NOW + 45_000 }, deps)
    expect(first).toMatchObject({ ok: true, mode: "backfill", status: "succeeded", upserted: 2 })
    expect(fetchReservations).toHaveBeenCalledTimes(18)
    for (const [req] of fetchReservations.mock.calls) {
      expect(req.propertyIds.sort()).toEqual([PROP_A, PROP_B].sort())
    }
    expect(db.upserts.every((u) => u.table === "pms_reservations" && u.onConflict === PMS_RESERVATION_UPSERT_KEY)).toBe(true)
    expect(PMS_RESERVATION_UPSERT_KEY).toBe("connection_id,external_reservation_id")
    // first_seen_at is the database's; the payload never sets it.
    expect(db.upserts.flatMap((u) => u.rows).some((r) => "first_seen_at" in r)).toBe(false)
    expect(db.tables.pms_reservations.map((r) => [r.external_reservation_id, r.listing_id])).toEqual([
      ["res-1", LISTING_A],
      ["res-2", LISTING_B],
    ])
    const firstSeen = db.tables.pms_reservations[0].first_seen_at

    // Second run: incremental, the guest cancelled res-1 → same row, new status.
    status = "cancelled"
    const second = await syncPmsConnection(CONNECTION, { trigger: "cron", deadline: NOW + 45_000 }, deps)
    expect(second).toMatchObject({ ok: true, mode: "incremental", status: "succeeded" })
    expect(db.tables.pms_reservations).toHaveLength(2)
    expect(db.tables.pms_reservations[0]).toMatchObject({ external_reservation_id: "res-1", status: "cancelled", first_seen_at: firstSeen })

    const runs = db.tables.pms_sync_runs
    expect(runs.map((r) => [r.mode, r.status])).toEqual([
      ["backfill", "succeeded"],
      ["incremental", "succeeded"],
    ])
    expect(runs[0]).toMatchObject({ coverage_start: "2024-01-01", coverage_end: "2028-04-16", stay_count: 2 })
    expect(runs[1]).toMatchObject({ coverage_start: "2024-01-01", stay_count: 1, cancelled_count: 1 })
  })

  it("stops before the deadline with a cursor and resumes there", async () => {
    const db = kenDb()
    let clock = NOW
    const { adapter, fetchReservations } = fakeAdapter(() => {
      clock += 10_000
      return []
    })
    const deps = { supabase: db.client, now: () => clock, getAdapter: () => adapter }
    const first = await syncPmsConnection(CONNECTION, { trigger: "manual", deadline: NOW + 45_000 }, deps)
    expect(first).toMatchObject({ ok: true, status: "partial" })
    const calls = fetchReservations.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    expect(calls).toBeLessThan(18)
    expect(db.tables.pms_sync_runs[0]).toMatchObject({ status: "partial", chunks_done: calls })
    const cursor = db.tables.pms_sync_runs[0].next_chunk_start as string

    clock = NOW + 60_000
    fetchReservations.mockClear()
    await syncPmsConnection(CONNECTION, { trigger: "manual", deadline: clock + 45_000 }, deps)
    expect(fetchReservations.mock.calls[0][0].window.start).toBe(cursor)
    expect(db.tables.pms_sync_runs[1]).toMatchObject({ mode: "backfill", window_start: "2024-01-01" })
  })

  it("refuses connections without confirmed mappings or without an adapter", async () => {
    const db = kenDb()
    db.tables.client_pms_properties.forEach((p) => {
      p.mapping_status = "ignored"
      p.mapped_listing_id = null
    })
    const { adapter, fetchReservations } = fakeAdapter(() => [])
    const result = await syncPmsConnection(
      CONNECTION,
      { trigger: "manual", deadline: NOW + 45_000 },
      { supabase: db.client, now: () => NOW, getAdapter: () => adapter }
    )
    expect(result).toMatchObject({ ok: false, code: "no_mappings" })
    expect(fetchReservations).not.toHaveBeenCalled()

    const guesty = memoryDb({
      client_pms_connections: [{ id: CONNECTION, client_id: CLIENT, provider: "guesty", status: "verified" }],
    })
    expect(
      await syncPmsConnection(CONNECTION, { trigger: "manual", deadline: NOW + 45_000 }, { supabase: guesty.client, now: () => NOW })
    ).toMatchObject({ ok: false, code: "unsupported_provider" })
  })
})

// ---------------------------------------------------------------------------
// Goals tab loader and the Data Connections sync action
// ---------------------------------------------------------------------------

function sessionTables(tables: Record<string, Row[] | { error: { code: string; message: string } }>) {
  return (table: string) => {
    const t = tables[table] ?? []
    const b: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "gte", "order", "limit"]) b[m] = () => b
    b.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(Array.isArray(t) ? { data: t, error: null } : { data: null, error: t.error }).then(resolve)
    return b
  }
}

const pmsHistoryRow = (overrides: Partial<PmsHistoryRow> = {}): PmsHistoryRow => ({
  external_reservation_id: "res-1",
  provider: "hospitable",
  platform: "airbnb",
  status: "accepted",
  booked_date: "2026-05-02",
  check_in: "2026-07-10",
  check_out: "2026-07-14",
  nights: 4,
  currency: "USD",
  accommodation_minor: 108000,
  source_fetched_at: "2026-10-16T08:00:00.000Z",
  ...overrides,
})

const pricelabsRow = {
  booked_date: "2026-06-01",
  check_in: "2026-08-01",
  check_out: "2026-08-03",
  number_of_days: 2,
  booking_status: "booked",
  booking_channel: "airbnb",
  rental_revenue: 500,
  booking_window_days: 61,
}

describe("Goals tab loader", () => {
  beforeEach(() => {
    mocks.permission.mockReset().mockResolvedValue(true)
    mocks.sessionFrom.mockReset()
  })

  it("prefers synced PMS rows for the listing and labels the source", async () => {
    mocks.sessionFrom.mockImplementation(
      sessionTables({ pms_reservations: [pmsHistoryRow()], pricelabs_reservations_cache: [pricelabsRow] })
    )
    const { getPricingPlanDataAction } = await import("@/app/(authenticated)/listings/[id]/pricing-plan-actions")
    const result = await getPricingPlanDataAction(LISTING_A)
    expect(result.ok && result.source).toEqual({ kind: "pms", label: "Hospitable", syncedAt: "2026-10-16T08:00:00.000Z" })
    expect(result.ok && result.reservations).toEqual([
      {
        booked_date: "2026-05-02",
        check_in: "2026-07-10",
        check_out: "2026-07-14",
        number_of_days: 4,
        booking_status: "booked",
        booking_channel: "airbnb",
        rental_revenue: 1080,
        booking_window_days: 69,
      },
    ])
    expect(mocks.sessionFrom).not.toHaveBeenCalledWith("pricelabs_reservations_cache")
  })

  it("falls back to PriceLabs when there are no PMS rows or the table isn't there yet", async () => {
    const { getPricingPlanDataAction } = await import("@/app/(authenticated)/listings/[id]/pricing-plan-actions")
    mocks.sessionFrom.mockImplementation(sessionTables({ pms_reservations: [], pricelabs_reservations_cache: [pricelabsRow] }))
    const empty = await getPricingPlanDataAction(LISTING_A)
    expect(empty.ok && empty.source).toEqual({ kind: "pricelabs", label: "PriceLabs", syncedAt: null })
    expect(empty.ok && empty.reservations).toHaveLength(1)

    mocks.sessionFrom.mockImplementation(
      sessionTables({
        pms_reservations: { error: { code: "42P01", message: 'relation "pms_reservations" does not exist' } },
        pricelabs_reservations_cache: [pricelabsRow],
      })
    )
    const missing = await getPricingPlanDataAction(LISTING_A)
    expect(missing.ok && missing.source.kind).toBe("pricelabs")
  })

  it("maps PMS rows for buildHistory: cancelled excluded from revenue, requests dropped, renewals deduped", () => {
    const plan = pmsRowsToPlanReservations([
      pmsHistoryRow(),
      // Same reservation via a renewed connection: keep the latest fetch once.
      pmsHistoryRow({ source_fetched_at: "2026-10-17T08:00:00.000Z", accommodation_minor: 110000 }),
      pmsHistoryRow({ external_reservation_id: "res-2", status: "cancelled", platform: "homeaway" }),
      pmsHistoryRow({ external_reservation_id: "res-3", status: "request" }),
    ])
    expect(plan.map((r) => [r.booking_status, r.booking_channel, r.rental_revenue])).toEqual([
      ["booked", "airbnb", 1100],
      ["cancelled", "vrbo", 1080],
    ])
    const history = buildHistory(plan, "2026-10-16")
    expect(history.nights["2026-07"]).toBe(4)
    expect(history.revenue["2026-07"]).toBeCloseTo(1100)
    expect(history.channels.find((c) => c.code === "vrbo")).toMatchObject({ cancelled: 1, revenue: 0 })
  })

  it("converts minor units by the currency's decimals", () => {
    expect(minorToMajor(108000, "USD")).toBe(1080)
    expect(minorToMajor(108000, "JPY")).toBe(108000)
    expect(minorToMajor(108000, null)).toBe(1080)
  })
})

describe("syncPmsBookingsAction permission gate", () => {
  beforeEach(() => {
    mocks.permission.mockReset()
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "staff-1" } } })
    mocks.syncPmsConnection.mockReset()
  })

  it("refuses without data_connections:edit and never reaches the sync service", async () => {
    vi.doMock("@/lib/pms-sync.server", () => ({ syncPmsConnection: mocks.syncPmsConnection }))
    vi.resetModules()
    const { syncPmsBookingsAction } = await import("@/app/(authenticated)/clients/[id]/connections-actions")
    mocks.permission.mockImplementation(async (resource: string, action: string) =>
      resource === "data_connections" && action === "view"
    )
    expect(await syncPmsBookingsAction(CONNECTION)).toEqual({
      ok: false,
      error: "You don't have permission to manage data connections",
    })
    mocks.permission.mockRejectedValue(new Error("boom"))
    expect((await syncPmsBookingsAction(CONNECTION)).ok).toBe(false)
    expect(await syncPmsBookingsAction("not-a-uuid")).toEqual({ ok: false, error: "Invalid connection" })
    expect(mocks.syncPmsConnection).not.toHaveBeenCalled()
  })

  it("runs an auto, manual-trigger sync with a bounded deadline when allowed", async () => {
    vi.doMock("@/lib/pms-sync.server", () => ({ syncPmsConnection: mocks.syncPmsConnection }))
    vi.resetModules()
    const { syncPmsBookingsAction } = await import("@/app/(authenticated)/clients/[id]/connections-actions")
    mocks.permission.mockResolvedValue(true)
    mocks.syncPmsConnection.mockResolvedValue({
      ok: true,
      runId: "run-1",
      mode: "backfill",
      status: "succeeded",
      fetched: 3,
      upserted: 3,
      coverage: "Jan 2024 – Apr 2028 · 3 stays",
    })
    const before = Date.now()
    const result = await syncPmsBookingsAction(CONNECTION)
    expect(result).toEqual({ ok: true, status: "succeeded", upserted: 3, coverage: "Jan 2024 – Apr 2028 · 3 stays" })
    const [id, opts] = mocks.syncPmsConnection.mock.calls[0]
    expect(id).toBe(CONNECTION)
    expect(opts).toMatchObject({ mode: "auto", trigger: "manual", actorId: "staff-1" })
    expect(opts.deadline - before).toBeLessThanOrEqual(50_000)
  })
})

describe("pms_reservations migration", () => {
  const sql = readFileSync(
    path.resolve(import.meta.dirname, "../../supabase/migrations/20261021120000_pms_reservations.sql"),
    "utf8"
  )
  const ddl = sql.replace(/--.*$/gm, "")

  it("is permission-based RLS with service-role-only writes", () => {
    expect(ddl).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(ddl).toMatch(/ALTER TABLE public\.pms_reservations ENABLE ROW LEVEL SECURITY/)
    expect(ddl).toMatch(/ALTER TABLE public\.pms_sync_runs ENABLE ROW LEVEL SECURITY/)
    expect(ddl).toMatch(/ON public\.pms_reservations FOR SELECT TO authenticated\s+USING \(public\.has_permission\('reservations', 'view'\)\)/)
    expect(ddl).toMatch(/ON public\.pms_sync_runs FOR SELECT TO authenticated\s+USING \(public\.has_permission\('data_connections', 'view'\)\)/)
    expect(ddl).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.pms_reservations, public\.pms_sync_runs FROM authenticated/)
    expect(ddl).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/)
  })

  it("keys reservations on connection + external id and stores no PII columns", () => {
    expect(ddl).toMatch(/UNIQUE \(connection_id, external_reservation_id\)/)
    const table = ddl.slice(ddl.indexOf("CREATE TABLE IF NOT EXISTS public.pms_reservations"), ddl.indexOf("CREATE INDEX"))
    for (const forbidden of ["guest_name", "first_name", "last_name", "email", "phone", "message", "door", "confirmation", " code "]) {
      expect(table.toLowerCase()).not.toContain(forbidden)
    }
    expect(ddl).toMatch(/idx_pms_sync_runs_single_running[\s\S]*WHERE status = 'running'/)
  })
})
