import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  runGranolaImport: vi.fn(),
  createGranolaPersistence: vi.fn(() => ({ persistence: true })),
  clientInputs: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/granola/client.server", () => ({
  GranolaApiClient: class {
    constructor(input: Record<string, unknown>) {
      mocks.clientInputs.push(input)
    }
  },
}))
vi.mock("@/lib/granola/importer", () => ({
  runGranolaImport: mocks.runGranolaImport,
}))
vi.mock("@/lib/granola/store.server", () => ({
  createGranolaPersistence: mocks.createGranolaPersistence,
}))

import { GET } from "@/app/api/cron/granola-import/route"
import { parseGranolaSources } from "@/lib/granola/config.server"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  mocks.clientInputs.length = 0
})

function request(secret = "cron-secret") {
  return new Request("https://hub.revfactor.io/api/cron/granola-import", {
    headers: { Authorization: `Bearer ${secret}` },
  })
}

describe("Granola import cron", () => {
  it("fails closed before checking whether the importer is enabled", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret")
    vi.stubEnv("GRANOLA_IMPORT_ENABLED", "false")

    const response = await GET(request("wrong-secret"))

    expect(response.status).toBe(401)
    expect(mocks.createGranolaPersistence).not.toHaveBeenCalled()
  })

  it("is disabled by default and does not parse or use credentials", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret")
    vi.stubEnv("GRANOLA_IMPORT_ENABLED", "")
    vi.stubEnv("GRANOLA_IMPORT_SOURCES_JSON", "not-json")

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      enabled: false,
      status: "disabled",
    })
    expect(mocks.runGranolaImport).not.toHaveBeenCalled()
  })

  it("runs a bounded import and never returns the source token", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret")
    vi.stubEnv("GRANOLA_IMPORT_ENABLED", "true")
    vi.stubEnv(
      "GRANOLA_IMPORT_SOURCES_JSON",
      JSON.stringify([
        {
          id: "rep-one",
          scope: "rep",
          token: "private-granola-token",
          initialUpdatedAfter: "2026-09-01T00:00:00Z",
        },
      ])
    )
    mocks.runGranolaImport.mockResolvedValue({
      status: "completed",
      fetched: 2,
      imported: 1,
      deduplicated: 1,
      unmatched: 0,
      missingSummary: 0,
      failures: 0,
      checkpoint: null,
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.runGranolaImport).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "rep-one",
        pageSize: 10,
        maxPages: 1,
        maxNotes: 10,
      })
    )
    expect(mocks.clientInputs[0]).toEqual({
      token: "private-granola-token",
      timeoutMs: 10_000,
    })
    expect(JSON.stringify(body)).not.toContain("private-granola-token")
  })

  it("rejects duplicate source IDs and more than five sources", () => {
    const source = {
      id: "rep-one",
      scope: "rep",
      token: "token",
      initialUpdatedAfter: "2026-09-01T00:00:00Z",
    }
    expect(() => parseGranolaSources(JSON.stringify([source, source]))).toThrow(
      "Invalid Granola source"
    )
    expect(() =>
      parseGranolaSources(
        JSON.stringify(
          Array.from({ length: 6 }, (_, index) => ({
            ...source,
            id: `rep-${index}`,
          }))
        )
      )
    ).toThrow("Invalid Granola source count")
  })
})
