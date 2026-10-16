import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("tests must inject a fake client")
  },
}))

import type { PortalViewer } from "@/lib/assembly-portal-session.server"
import { listHospitableProperties, parseHospitableProperty } from "@/lib/hospitable-client.server"
import {
  computeRemindAt,
  parsePmsSecretPayload,
  PMS_PROVIDER_CONFIG,
  PMS_PROVIDERS,
  pmsErrorFromHttpStatus,
  suggestPropertyMappings,
  validatePmsCredential,
} from "@/lib/pms-connections"
import {
  disconnectPortalConnection,
  loadPortalConnections,
  submitPortalConnection,
} from "@/lib/pms-connections.server"

const CLIENT_A = "11111111-1111-4111-8111-111111111111"
const CLIENT_B = "22222222-2222-4222-8222-222222222222"
const TOKEN = "pat_live_abcdefghijklmnop1234"

// ---------------------------------------------------------------------------
// Provider field validation
// ---------------------------------------------------------------------------

describe("validatePmsCredential", () => {
  const complete: Record<string, Record<string, string>> = {
    hospitable: { token: TOKEN },
    guesty: { client_id: "0oa1b2c3d4", client_secret: "secret-abcdefgh-9876" },
    hostaway: { account_id: "12345", api_key: "hk_abcdefghijklmn5555" },
    hostfully: { agency_uid: "agency-uid-1", api_key: "hf_abcdefghijk7777" },
    ownerrez: { token: "pt_abcdefghijklmnop8888" },
    lodgify: { api_key: "lg_abcdefghijklmnop9999" },
    other: { provider_name: "Smoobu", api_key: "sm_abcdefghijklmn0000", note: "Main account" },
  }

  it("accepts every provider with its required fields and keeps only that provider's fields", () => {
    for (const provider of PMS_PROVIDERS) {
      const result = validatePmsCredential({ provider, values: { ...complete[provider], stray: "dropped" } })
      expect(result.ok, provider).toBe(true)
      if (!result.ok) continue
      const fields = parsePmsSecretPayload(result.value.secretPayload)!
      expect(fields.stray).toBeUndefined()
      // Plain fields (PMS name, notes) never go into the encrypted blob.
      expect(fields.provider_name).toBeUndefined()
      expect(fields.note).toBeUndefined()
      const primary = PMS_PROVIDER_CONFIG[provider].fields.find((f) => f.primary)!
      expect(result.value.tokenLast4).toBe(complete[provider][primary.key].slice(-4))
    }
  })

  it("requires every required field per PMS", () => {
    for (const provider of PMS_PROVIDERS) {
      for (const field of PMS_PROVIDER_CONFIG[provider].fields.filter((f) => f.required)) {
        const values = { ...complete[provider], [field.key]: "  " }
        const result = validatePmsCredential({ provider, values })
        expect(result.ok, `${provider}.${field.key}`).toBe(false)
        if (!result.ok) expect(Object.keys(result.fieldErrors)).toContain(field.key)
      }
    }
  })

  it("names the right fields per provider", () => {
    const keys = (p: (typeof PMS_PROVIDERS)[number]) =>
      PMS_PROVIDER_CONFIG[p].fields.filter((f) => f.required).map((f) => f.key)
    expect(keys("hospitable")).toEqual(["token"])
    expect(keys("guesty")).toEqual(["client_id", "client_secret"])
    expect(keys("hostaway")).toEqual(["account_id", "api_key"])
    expect(keys("hostfully")).toEqual(["agency_uid", "api_key"])
    expect(keys("ownerrez")).toEqual(["token"])
    expect(keys("lodgify")).toEqual(["api_key"])
    expect(keys("other")).toEqual(["provider_name", "api_key"])
    expect(PMS_PROVIDER_CONFIG.hospitable.liveCheck).toBe(true)
    expect(PMS_PROVIDERS.filter((p) => PMS_PROVIDER_CONFIG[p].liveCheck)).toEqual(["hospitable"])
  })

  it("rejects unknown providers, short or spaced secrets, credentials in notes and past expiry", () => {
    expect(validatePmsCredential({ provider: "airbnb", values: {} }).ok).toBe(false)
    const spaced = validatePmsCredential({ provider: "hospitable", values: { token: "abc def ghi jkl" } })
    expect(spaced.ok).toBe(false)
    const short = validatePmsCredential({ provider: "lodgify", values: { api_key: "abc" } })
    expect(short.ok).toBe(false)
    const note = validatePmsCredential({
      provider: "other",
      values: { ...complete.other, note: "PriceLabs password: hunter2hunter2" },
    })
    expect(note.ok).toBe(false)
    const past = validatePmsCredential(
      { provider: "hospitable", values: complete.hospitable, expiresAt: "2026-01-01" },
      new Date("2026-10-16T12:00:00Z")
    )
    expect(past.ok).toBe(false)
  })

  it("never echoes the submitted secret in errors", () => {
    const result = validatePmsCredential({ provider: "hospitable", values: { token: "short1" } })
    expect(JSON.stringify(result)).not.toContain("short1")
  })
})

describe("computeRemindAt", () => {
  it("uses expiry − 30 days, else connected + 11 months", () => {
    const now = new Date("2026-10-16T12:00:00Z")
    expect(computeRemindAt(now, null)).toBe("2027-09-16")
    expect(computeRemindAt(now, "2027-06-30")).toBe("2027-05-31")
    expect(computeRemindAt(now, "2026-10-20")).toBe("2026-10-16")
  })
})

// ---------------------------------------------------------------------------
// Hospitable token validation error mapping
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("Hospitable client", () => {
  it("maps HTTP statuses to typed error codes", () => {
    expect(pmsErrorFromHttpStatus(401)).toBe("invalid_token")
    expect(pmsErrorFromHttpStatus(403)).toBe("forbidden")
    expect(pmsErrorFromHttpStatus(429)).toBe("rate_limited")
    expect(pmsErrorFromHttpStatus(503)).toBe("provider_unavailable")
    expect(pmsErrorFromHttpStatus(404)).toBe("unexpected_response")
  })

  it("returns typed errors without leaking the body or token", async () => {
    for (const [status, code] of [
      [401, "invalid_token"],
      [403, "forbidden"],
      [429, "rate_limited"],
      [500, "provider_unavailable"],
    ] as const) {
      const fetcher = vi.fn(async () => jsonResponse({ message: "guest Jane Doe secret" }, status))
      const result = await listHospitableProperties(TOKEN, { fetcher })
      expect(result).toEqual({ ok: false, code })
      expect(JSON.stringify(result)).not.toContain("Jane")
    }
    const timeout = await listHospitableProperties(TOKEN, {
      fetcher: async () => {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" })
      },
    })
    expect(timeout).toEqual({ ok: false, code: "timeout" })
    const network = await listHospitableProperties(TOKEN, {
      fetcher: async () => {
        throw new TypeError("fetch failed")
      },
    })
    expect(network).toEqual({ ok: false, code: "provider_unavailable" })
    expect(await listHospitableProperties("has space", { fetcher: vi.fn() })).toEqual({
      ok: false,
      code: "invalid_token",
    })
  })

  it("sends a GET to the fixed host with the bearer token, refuses redirects, and paginates", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const pages = [
      {
        data: [
          {
            id: "prop-1",
            name: "Lake House",
            address: { street: "1 Private Rd" },
            listings: [
              { platform: "airbnb", platform_id: "1217342402526093415" },
              { platform: "homeaway", platform_id: "321.123" },
            ],
          },
        ],
        meta: { current_page: 1, last_page: 2, total: 2 },
      },
      { data: [{ id: "prop-2", name: "Loft", listings: [] }], meta: { current_page: 2, last_page: 2, total: 2 } },
    ]
    const result = await listHospitableProperties(TOKEN, {
      fetcher: async (url, init) => {
        calls.push({ url: url.toString(), init })
        return jsonResponse(pages[calls.length - 1])
      },
    })
    expect(result).toEqual({
      ok: true,
      data: [
        { external_property_id: "prop-1", name: "Lake House", airbnb_id: "1217342402526093415", vrbo_id: "321.123" },
        { external_property_id: "prop-2", name: "Loft", airbnb_id: null, vrbo_id: null },
      ],
    })
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe(
      "https://public.api.hospitable.com/v2/properties?include=listings&per_page=100&page=1"
    )
    expect(calls[0].init.method).toBe("GET")
    expect(calls[0].init.redirect).toBe("error")
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it("fails closed on malformed pagination, duplicates and changing totals", async () => {
    const bad = [
      { data: "nope", meta: { last_page: 1 } },
      { data: [], meta: { last_page: 999 } },
      { data: [{ id: "a" }, { id: "a" }], meta: { current_page: 1, last_page: 1, total: 2 } },
      { data: [{ id: "a" }], meta: { current_page: 1, last_page: 1, total: 5 } },
    ]
    for (const body of bad) {
      const result = await listHospitableProperties(TOKEN, { fetcher: async () => jsonResponse(body) })
      expect(result).toEqual({ ok: false, code: "unexpected_response" })
    }
  })

  it("projects only id, name and channel ids", () => {
    const parsed = parseHospitableProperty({
      id: "p",
      name: "X",
      address: "secret",
      listings: [{ platform: "airbnb", platform_id: 42 }],
    })
    expect(parsed).toEqual({ external_property_id: "p", name: "X", airbnb_id: "42", vrbo_id: null })
  })
})

// ---------------------------------------------------------------------------
// Mapping suggestions
// ---------------------------------------------------------------------------

describe("suggestPropertyMappings", () => {
  const prop = (id: string, airbnb: string | null, vrbo: string | null = null) => ({
    external_property_id: id,
    name: id,
    airbnb_id: airbnb,
    vrbo_id: vrbo,
  })
  const listing = (id: string, airbnb: string | null, vrbo: string | null = null) => ({
    id,
    airbnb_link: airbnb ? `https://www.airbnb.com/rooms/${airbnb}?source=x` : null,
    vrbo_id: vrbo,
  })

  it("suggests by exact Airbnb ID, then Vrbo ID", () => {
    const result = suggestPropertyMappings(
      [prop("p1", "111"), prop("p2", null, "V-9"), prop("p3", "999")],
      [listing("l1", "111"), listing("l2", null, "v-9"), listing("l3", "555")]
    )
    expect(result).toEqual([
      { external_property_id: "p1", suggested_listing_id: "l1", suggestion_reason: "airbnb_id", mapping_status: "suggested" },
      { external_property_id: "p2", suggested_listing_id: "l2", suggestion_reason: "vrbo_id", mapping_status: "suggested" },
      { external_property_id: "p3", suggested_listing_id: null, suggestion_reason: null, mapping_status: "unmatched" },
    ])
  })

  it("fails closed when an ID matches several listings or a listing matches several properties", () => {
    const shared = suggestPropertyMappings([prop("p1", "111")], [listing("l1", "111"), listing("l2", "111")])
    expect(shared[0].suggested_listing_id).toBeNull()
    const twice = suggestPropertyMappings([prop("p1", "111"), prop("p2", "111")], [listing("l1", "111")])
    expect(twice.map((s) => s.mapping_status)).toEqual(["unmatched", "unmatched"])
  })
})

// ---------------------------------------------------------------------------
// Portal scoping (fake admin client over two clients' rows)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "pms_connection_disconnect_for_client") {
      const row = tables.client_pms_connections.find(
        (r) => r.id === args.p_connection_id && r.client_id === args.p_client_id && r.status !== "disconnected"
      )
      if (row) row.status = "disconnected"
      return { data: Boolean(row), error: null }
    }
    if (name === "pms_connection_create") {
      const id = "33333333-3333-4333-8333-333333333333"
      tables.client_pms_connections.push({
        id,
        client_id: args.p_client_id,
        provider: args.p_provider,
        provider_name: args.p_provider_name,
        status: args.p_status,
        token_last4: args.p_token_last4,
        created_at: "2026-10-16T12:00:00Z",
        remind_at: args.p_remind_at,
        expires_at: args.p_expires_at,
        property_count: args.p_property_count,
        last_validated_at: args.p_last_validated_at,
      })
      return { data: id, error: null }
    }
    return { data: null, error: { code: "42883" } }
  })
  const selects: { table: string; columns: string; filters: [string, string, unknown][] }[] = []

  function from(table: string) {
    const filters: [string, string, unknown][] = []
    let columns = ""
    let head = false
    let mode: "select" | "insert" | "update" = "select"
    let payload: Row | Row[] | null = null
    const run = () => {
      let rows = (tables[table] ?? []).filter((r) =>
        filters.every(([op, col, v]) =>
          op === "eq"
            ? r[col] === v
            : op === "neq"
              ? r[col] !== v
              : op === "in"
                ? (v as unknown[]).includes(r[col])
                : true
        )
      )
      if (mode === "insert") {
        tables[table] = [...(tables[table] ?? []), ...(Array.isArray(payload) ? payload : [payload!])]
        return { data: null, error: null }
      }
      if (mode === "update") {
        rows.forEach((r) => Object.assign(r, payload))
        return { data: null, error: null }
      }
      selects.push({ table, columns, filters: [...filters] })
      if (head) return { data: null, count: rows.length, error: null }
      const keys = columns.split(",").map((c) => c.trim())
      rows = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])))
      return { data: rows, error: null }
    }
    const builder: Record<string, unknown> = {
      select(cols: string, opts?: { head?: boolean }) {
        columns = cols
        head = Boolean(opts?.head)
        return builder
      },
      insert(rows: Row | Row[]) {
        mode = "insert"
        payload = rows
        return builder
      },
      update(patch: Row) {
        mode = "update"
        payload = patch
        return builder
      },
      eq(col: string, v: unknown) {
        filters.push(["eq", col, v])
        return builder
      },
      neq(col: string, v: unknown) {
        filters.push(["neq", col, v])
        return builder
      },
      in(col: string, v: unknown[]) {
        filters.push(["in", col, v])
        return builder
      },
      order() {
        return builder
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return builder
  }
  return { client: { from, rpc } as unknown as SupabaseClient, rpc, selects, tables }
}

function seed() {
  return {
    client_pms_connections: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        client_id: CLIENT_A,
        provider: "hospitable",
        provider_name: null,
        status: "connected",
        token_last4: "aaaa",
        secret_id: "vault-a",
        created_at: "2026-10-01T00:00:00Z",
        remind_at: "2027-09-01",
        expires_at: null,
        property_count: 1,
        last_validated_at: "2026-10-01T00:00:00Z",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        client_id: CLIENT_B,
        provider: "guesty",
        provider_name: null,
        status: "pending_verification",
        token_last4: "bbbb",
        secret_id: "vault-b",
        created_at: "2026-10-02T00:00:00Z",
        remind_at: "2027-09-02",
        expires_at: null,
        property_count: null,
        last_validated_at: null,
      },
    ] as Row[],
    client_pms_properties: [
      { connection_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client_id: CLIENT_A, name: "A House" },
      { connection_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", client_id: CLIENT_B, name: "B House" },
    ] as Row[],
    listings: [] as Row[],
  }
}

const viewer = (clientId: string, overrides: Partial<PortalViewer> = {}): PortalViewer => ({
  hubClientId: clientId,
  hubClientName: "Owner",
  assemblyClientId: "asm-client",
  assemblyCompanyId: null,
  isInternal: false,
  displayName: "Owner",
  ...overrides,
})

describe("portal scoping", () => {
  it("only loads the viewer's own client's connections and never the Vault reference", async () => {
    const fake = fakeSupabase(seed())
    const result = await loadPortalConnections(CLIENT_A, { supabase: fake.client })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.connections.map((c) => c.tokenLast4)).toEqual(["aaaa"])
    expect(result.connections[0].propertyNames).toEqual(["A House"])
    expect(JSON.stringify(result)).not.toContain("vault-")
    for (const s of fake.selects) {
      expect(s.filters).toContainEqual(["eq", "client_id", CLIENT_A])
      expect(s.columns).not.toContain("secret")
      expect(s.columns).not.toBe("*")
    }
  })

  it("cannot disconnect another client's connection", async () => {
    const fake = fakeSupabase(seed())
    const denied = await disconnectPortalConnection(viewer(CLIENT_A), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
      supabase: fake.client,
    })
    expect(denied.ok).toBe(false)
    expect(fake.rpc).toHaveBeenCalledWith("pms_connection_disconnect_for_client", {
      p_connection_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      p_client_id: CLIENT_A,
      p_assembly_client_id: "asm-client",
    })
    expect(fake.tables.client_pms_connections[1].status).toBe("pending_verification")

    const own = await disconnectPortalConnection(viewer(CLIENT_A), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      supabase: fake.client,
    })
    expect(own.ok).toBe(true)
  })

  it("internal Assembly previews can't submit or disconnect", async () => {
    const fake = fakeSupabase(seed())
    const internal = viewer(CLIENT_A, { isInternal: true, assemblyClientId: null })
    expect((await submitPortalConnection(internal, { provider: "lodgify", values: { api_key: "x".repeat(20) } }, { supabase: fake.client })).ok).toBe(false)
    expect((await disconnectPortalConnection(internal, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { supabase: fake.client })).ok).toBe(false)
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it("stores nothing when the Hospitable check fails", async () => {
    const fake = fakeSupabase(seed())
    const result = await submitPortalConnection(
      viewer(CLIENT_A),
      { provider: "hospitable", values: { token: TOKEN } },
      { supabase: fake.client, listProperties: async () => ({ ok: false, code: "invalid_token" }) }
    )
    expect(result).toMatchObject({ ok: false, code: "invalid_token" })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it("creates a connection for the viewer's client only, with the secret going only to the Vault RPC", async () => {
    const fake = fakeSupabase(seed())
    const result = await submitPortalConnection(
      viewer(CLIENT_A),
      { provider: "hospitable", values: { token: TOKEN } },
      {
        supabase: fake.client,
        now: () => new Date("2026-10-16T12:00:00Z"),
        listProperties: async () => ({
          ok: true,
          data: [{ external_property_id: "prop-9", name: "New Place", airbnb_id: "9", vrbo_id: null }],
        }),
      }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.connection.status).toBe("connected")
    expect(result.connection.propertyNames).toEqual(["New Place"])
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    const [name, args] = fake.rpc.mock.calls[0]
    expect(name).toBe("pms_connection_create")
    expect(args).toMatchObject({ p_client_id: CLIENT_A, p_status: "connected", p_token_last4: "1234", p_remind_at: "2027-09-16" })
    expect(parsePmsSecretPayload(args.p_secret as string)).toEqual({ token: TOKEN })
    expect(
      fake.tables.client_pms_properties.find((p) => p.external_property_id === "prop-9")
    ).toMatchObject({ client_id: CLIENT_A, mapping_status: "unmatched" })
  })

  it("stores other PMSs as pending verification without a live check", async () => {
    const fake = fakeSupabase(seed())
    const listProperties = vi.fn()
    const result = await submitPortalConnection(
      viewer(CLIENT_A),
      { provider: "hostaway", values: { account_id: "123", api_key: "hk_abcdefghijk4321" } },
      { supabase: fake.client, listProperties }
    )
    expect(result).toMatchObject({ ok: true, liveChecked: false, connection: { status: "pending_verification" } })
    expect(listProperties).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Migration guardrails
// ---------------------------------------------------------------------------

describe("client PMS connections migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261020120000_client_pms_connections.sql"),
    "utf8"
  )

  it("uses permission-based RLS, never USING (true)", () => {
    const code = sql.replace(/--.*$/gm, "")
    expect(code).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(sql).toMatch(/has_permission\('data_connections', 'view'\)/)
    expect(sql).toMatch(/has_permission\('data_connections', 'edit'\) AND public\.has_permission\('listings', 'edit'\)/)
  })

  it("keeps Vault functions off the public API and guards in-function checks with IS NOT TRUE", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.pms_connection_create\([^)]*\) FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.pms_connection_secret\(UUID\) FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.pms_connection_secret\(UUID\) TO service_role;/)
    expect(sql).not.toMatch(/IF NOT public\.has_permission/)
    expect(sql).toMatch(/has_permission\('data_connections', 'edit'\) IS NOT TRUE/)
  })

  it("seeds the data_connections resource", () => {
    expect(sql).toMatch(/'admin', 'data_connections'/)
    expect(sql).toMatch(/WHERE r\.name IN \('contractor', 'marketing', 'hostpricing'\)/)
  })
})
