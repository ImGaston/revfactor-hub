import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
const handlers = vi.hoisted(() => ({ assembly: vi.fn(), progress: vi.fn() }))
vi.mock("@/lib/ghl-onboarding-v1/worker.server", () => ({
  processAssemblyJobs: handlers.assembly,
}))
vi.mock("@/lib/ghl-onboarding-v1/progress.server", () => ({
  projectGhlProgress: handlers.progress,
}))
import { GET } from "@/app/api/cron/ghl-onboarding-v1/route"

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret")
  handlers.assembly
    .mockReset()
    .mockResolvedValue({ state: "disabled", failed: 0 })
  handlers.progress.mockReset().mockResolvedValue({ status: "disabled" })
})
afterEach(() => vi.unstubAllEnvs())
const request = (bearer = "test-cron-secret") =>
  new Request("https://example.com/api/cron/ghl-onboarding-v1", {
    headers: { authorization: `Bearer ${bearer}` },
  })

describe("GHL V1 cron protection and subsystem isolation", () => {
  it("rejects missing configured secret before executing workers", async () => {
    vi.stubEnv("CRON_SECRET", "")
    expect((await GET(request())).status).toBe(401)
    expect(handlers.assembly).not.toHaveBeenCalled()
    expect(handlers.progress).not.toHaveBeenCalled()
  })
  it("rejects an incorrect bearer", async () => {
    expect((await GET(request("incorrect"))).status).toBe(401)
    expect(handlers.assembly).not.toHaveBeenCalled()
  })
  it("projects GHL progress while Assembly is disabled", async () => {
    handlers.progress.mockResolvedValue({ status: "completed" })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      assembly: { state: "disabled" },
      progress: { status: "completed" },
    })
  })
  it("continues progress after an Assembly exception without exposing error payloads", async () => {
    handlers.assembly.mockRejectedValue(
      Error("secret token private owner@example.com")
    )
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(handlers.progress).toHaveBeenCalledTimes(1)
    expect(await response.text()).not.toMatch(/secret|owner@example/)
  })
  it("reports incomplete configuration or a progress failure", async () => {
    handlers.assembly.mockResolvedValue({ state: "not_configured", failed: 0 })
    expect((await GET(request())).status).toBe(503)
    handlers.assembly.mockResolvedValue({
      state: "portal_compatibility_required",
      failed: 0,
    })
    expect((await GET(request())).status).toBe(503)
    handlers.assembly.mockResolvedValue({ state: "disabled", failed: 0 })
    handlers.progress.mockRejectedValue(Error("private response body"))
    expect((await GET(request())).status).toBe(503)
  })
})
