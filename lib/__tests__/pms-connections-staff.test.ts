import { beforeEach, describe, expect, it, vi } from "vitest"

// Staff "Add connection" on the Hub Data Connections tab: permission gate,
// Hospitable live check, and the hub-stamped Vault create.

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  getUser: vi.fn(),
  sessionRpc: vi.fn(),
  adminRpc: vi.fn(),
  adminFrom: vi.fn(),
  listProperties: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/permissions.server", () => ({ hasPermission: mocks.permission }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.sessionRpc }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.adminFrom, rpc: mocks.adminRpc }),
}))
vi.mock("@/lib/hospitable-client.server", () => ({ listHospitableProperties: mocks.listProperties }))

import { addPmsConnectionStaffAction } from "@/app/(authenticated)/clients/[id]/connections-actions"
import { findSameProviderConnections, parsePmsSecretPayload, validatePmsLabel } from "@/lib/pms-connections"

const CLIENT = "11111111-1111-4111-8111-111111111111"
const STAFF = "99999999-9999-4999-8999-999999999999"
const NEW_ID = "33333333-3333-4333-8333-333333333333"
const TOKEN = "pat_live_abcdefghijklmnop1234"

type Row = Record<string, unknown>
let tables: Record<string, Row[]>

/** Minimal admin-client query builder over in-memory tables. */
function from(table: string) {
  const filters: [string, string, unknown][] = []
  let head = false
  let mode: "select" | "insert" | "update" = "select"
  let payload: Row | Row[] | null = null
  const match = (r: Row) =>
    filters.every(([op, col, v]) => (op === "eq" ? r[col] === v : op === "neq" ? r[col] !== v : true))
  const run = () => {
    const rows = (tables[table] ?? []).filter(match)
    if (mode === "insert") {
      tables[table] = [...(tables[table] ?? []), ...(Array.isArray(payload) ? payload : [payload!])]
      return { data: null, error: null }
    }
    if (mode === "update") {
      rows.forEach((r) => Object.assign(r, payload))
      return { data: null, error: null }
    }
    return head ? { data: null, count: rows.length, error: null } : { data: rows, error: null }
  }
  const builder: Record<string, unknown> = {
    select(_cols: string, opts?: { head?: boolean }) {
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
    order: () => builder,
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(resolve, reject)
    },
  }
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  tables = {
    client_pms_connections: [],
    client_pms_properties: [],
    listings: [{ id: "listing-1", client_id: CLIENT, airbnb_link: "https://www.airbnb.com/rooms/777" }],
  }
  mocks.permission.mockResolvedValue(true)
  mocks.getUser.mockResolvedValue({ data: { user: { id: STAFF } } })
  mocks.adminFrom.mockImplementation(from)
  mocks.adminRpc.mockImplementation(async (name: string, args: Row) => {
    if (name !== "pms_connection_create") return { data: null, error: { code: "42883" } }
    tables.client_pms_connections.push({ id: NEW_ID, client_id: args.p_client_id, status: args.p_status })
    return { data: NEW_ID, error: null }
  })
  mocks.sessionRpc.mockResolvedValue({ data: true, error: null })
})

describe("addPmsConnectionStaffAction", () => {
  it("refuses without data_connections:edit and touches nothing", async () => {
    mocks.permission.mockResolvedValue(false)
    const result = await addPmsConnectionStaffAction({
      clientId: CLIENT,
      provider: "lodgify",
      values: { api_key: "lg_abcdefghijklmnop9999" },
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/permission/i) })
    expect(mocks.permission).toHaveBeenCalledWith("data_connections", "edit")
    expect(mocks.adminRpc).not.toHaveBeenCalled()
    expect(mocks.adminFrom).not.toHaveBeenCalled()
    expect(mocks.listProperties).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("fails closed when the permission check throws or there is no session", async () => {
    mocks.permission.mockRejectedValue(new Error("db down"))
    const thrown = await addPmsConnectionStaffAction({
      clientId: CLIENT,
      provider: "lodgify",
      values: { api_key: "lg_abcdefghijklmnop9999" },
    })
    expect(thrown.ok).toBe(false)

    mocks.permission.mockResolvedValue(true)
    mocks.getUser.mockResolvedValue({ data: { user: null } })
    const anon = await addPmsConnectionStaffAction({
      clientId: CLIENT,
      provider: "lodgify",
      values: { api_key: "lg_abcdefghijklmnop9999" },
    })
    expect(anon.ok).toBe(false)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it("rejects a malformed client id before checking anything", async () => {
    const result = await addPmsConnectionStaffAction({ clientId: "nope", provider: "lodgify", values: {} })
    expect(result.ok).toBe(false)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it("saves nothing when the Hospitable live check fails, and returns the mapped error", async () => {
    mocks.listProperties.mockResolvedValue({ ok: false, code: "invalid_token" })
    const result = await addPmsConnectionStaffAction({
      clientId: CLIENT,
      provider: "hospitable",
      values: { token: TOKEN },
    })
    expect(result).toMatchObject({ ok: false, code: "invalid_token", error: expect.stringContaining("Hospitable") })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(mocks.listProperties).toHaveBeenCalledWith(TOKEN)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
    expect(mocks.sessionRpc).not.toHaveBeenCalled()
    expect(tables.client_pms_connections).toHaveLength(0)
    expect(tables.client_pms_properties).toHaveLength(0)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it("connects Hospitable as hub/created_by staff and stores discovered properties with suggestions", async () => {
    mocks.listProperties.mockResolvedValue({
      ok: true,
      data: [
        { external_property_id: "prop-1", name: "Lake House", airbnb_id: "777", vrbo_id: null },
        { external_property_id: "prop-2", name: "Loft", airbnb_id: null, vrbo_id: null },
      ],
    })
    const result = await addPmsConnectionStaffAction({
      clientId: CLIENT,
      provider: "hospitable",
      values: { token: TOKEN },
      label: "Main account",
    })
    expect(result).toEqual({ ok: true, connectionId: NEW_ID, status: "connected", propertyCount: 2 })
    const [name, args] = mocks.adminRpc.mock.calls[0]
    expect(name).toBe("pms_connection_create")
    expect(args).toMatchObject({
      p_client_id: CLIENT,
      p_status: "connected",
      p_submitted_via: "hub",
      p_created_by: STAFF,
      p_created_by_assembly_client_id: null,
      p_label: "Main account",
      p_token_last4: "1234",
      p_property_count: 2,
    })
    expect(parsePmsSecretPayload(args.p_secret as string)).toEqual({ token: TOKEN })
    expect(tables.client_pms_properties).toEqual([
      expect.objectContaining({ external_property_id: "prop-1", suggested_listing_id: "listing-1", mapping_status: "suggested" }),
      expect.objectContaining({ external_property_id: "prop-2", suggested_listing_id: null, mapping_status: "unmatched" }),
    ])
    // A live-checked key isn't sent for manual review.
    expect(mocks.sessionRpc).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith(`/clients/${CLIENT}`)
  })

  it("saves a non-Hospitable key with submitted_via='hub' and marks it verified as the staff member", async () => {
    const result = await addPmsConnectionStaffAction({
      clientId: CLIENT,
      provider: "hostaway",
      values: { account_id: "12345", api_key: "hk_abcdefghijklmn5555" },
      expiresAt: null,
    })
    expect(result).toEqual({ ok: true, connectionId: NEW_ID, status: "verified", propertyCount: null })
    expect(mocks.listProperties).not.toHaveBeenCalled()
    const [name, args] = mocks.adminRpc.mock.calls[0]
    expect(name).toBe("pms_connection_create")
    expect(args).toMatchObject({
      p_client_id: CLIENT,
      p_provider: "hostaway",
      p_status: "pending_verification",
      p_submitted_via: "hub",
      p_created_by: STAFF,
      p_token_last4: "5555",
      p_property_count: null,
    })
    expect(parsePmsSecretPayload(args.p_secret as string)).toEqual({
      account_id: "12345",
      api_key: "hk_abcdefghijklmn5555",
    })
    expect(mocks.sessionRpc).toHaveBeenCalledWith("pms_connection_review", {
      p_connection_id: NEW_ID,
      p_decision: "verified",
      p_note: "Added by staff in the Hub",
    })
    expect(JSON.stringify(result)).not.toContain("hk_abcdefghijklmn5555")
    expect(mocks.revalidate).toHaveBeenCalledWith(`/clients/${CLIENT}`)
  })

  it("keeps a saved non-Hospitable key pending, with a warning, if marking it verified fails", async () => {
    mocks.sessionRpc.mockResolvedValue({ data: null, error: { code: "42501" } })
    const result = await addPmsConnectionStaffAction({
      clientId: CLIENT,
      provider: "lodgify",
      values: { api_key: "lg_abcdefghijklmnop9999" },
    })
    expect(result).toMatchObject({ ok: true, status: "pending_verification", warning: expect.any(String) })
  })

  it("rejects invalid fields and a credential in the label without saving", async () => {
    const result = await addPmsConnectionStaffAction({
      clientId: CLIENT,
      provider: "hostaway",
      values: { account_id: "12345", api_key: "short" },
      label: "password: hunter2hunter2",
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(expect.arrayContaining(["api_key", "label"]))
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })
})

describe("staff add helpers", () => {
  it("validates the optional label", () => {
    expect(validatePmsLabel("  ")).toEqual({ ok: true, label: null })
    expect(validatePmsLabel(" Main ")).toEqual({ ok: true, label: "Main" })
    expect(validatePmsLabel("x".repeat(81)).ok).toBe(false)
  })

  it("warns only about active connections for the same PMS (and same name for Other)", () => {
    const conns = [
      { id: "1", provider: "hospitable", providerLabel: "Hospitable", status: "connected" },
      { id: "2", provider: "hospitable", providerLabel: "Hospitable", status: "disconnected" },
      { id: "3", provider: "hospitable", providerLabel: "Hospitable", status: "rejected" },
      { id: "4", provider: "guesty", providerLabel: "Guesty", status: "pending_verification" },
      { id: "5", provider: "other", providerLabel: "Smoobu", status: "verified" },
    ]
    expect(findSameProviderConnections(conns, "hospitable").map((c) => c.id)).toEqual(["1"])
    expect(findSameProviderConnections(conns, "guesty").map((c) => c.id)).toEqual(["4"])
    expect(findSameProviderConnections(conns, "lodgify")).toEqual([])
    expect(findSameProviderConnections(conns, "other", " smoobu ").map((c) => c.id)).toEqual(["5"])
    expect(findSameProviderConnections(conns, "other", "Beds24")).toEqual([])
    expect(findSameProviderConnections(conns, "other", "")).toEqual([])
  })
})
