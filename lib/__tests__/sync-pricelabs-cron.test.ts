import { NextRequest } from "next/server"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock("@/lib/pricelabs", () => ({ isPriceLabsConfigured: () => true }))
vi.mock("@/lib/pricelabs-sync", () => ({ syncPriceLabsData: vi.fn() }))
vi.mock("@/lib/report-builder/runner", () => ({ advanceReportBuilder: vi.fn() }))
vi.mock("@/lib/market-signals/jobs.server", () => ({
  enqueueMarketSignalJobs: vi.fn(),
}))

import { GET } from "@/app/api/cron/sync-pricelabs/route"
import { enqueueMarketSignalJobs } from "@/lib/market-signals/jobs.server"
import { syncPriceLabsData } from "@/lib/pricelabs-sync"
import { advanceReportBuilder } from "@/lib/report-builder/runner"

const SECRET = "test-cron-secret"
const originalSecret = process.env.CRON_SECRET

const PL_RESULT = {
  synced: 336,
  notFound: 0,
  failed: 0,
  totalDb: 336,
  totalPriceLabs: 336,
  results: [],
}
const RB_RESULT = {
  runId: "run-1",
  status: "completed" as const,
  message: "Ingested 4032 metric rows across 336 listings",
}

function cronRequest(secret = SECRET) {
  return new NextRequest("https://hub.revfactor.io/api/cron/sync-pricelabs", {
    headers: { authorization: `Bearer ${secret}` },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  process.env.CRON_SECRET = SECRET
  vi.mocked(advanceReportBuilder).mockResolvedValue(RB_RESULT)
  vi.mocked(enqueueMarketSignalJobs).mockResolvedValue(5)
})

afterAll(() => {
  process.env.CRON_SECRET = originalSecret
})

describe("GET /api/cron/sync-pricelabs", () => {
  it("starts the Report Builder without waiting for the pl_* sync, with its full budget", async () => {
    let finishPlSync: (value: typeof PL_RESULT) => void = () => {}
    vi.mocked(syncPriceLabsData).mockReturnValue(
      new Promise((resolve) => {
        finishPlSync = resolve
      })
    )

    const pending = GET(cronRequest())
    await Promise.resolve()

    // The pl_* sync (~30s in production) is still running.
    expect(advanceReportBuilder).toHaveBeenCalledTimes(1)
    expect(vi.mocked(advanceReportBuilder).mock.calls[0][1]).toEqual({
      triggeredBy: "cron",
    })

    finishPlSync(PL_RESULT)
    const response = await pending
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ synced: 336, reportBuilder: RB_RESULT, marketSignalJobs: 5 })
  })

  it("still advances the Report Builder when the pl_* sync fails", async () => {
    vi.mocked(syncPriceLabsData).mockRejectedValue(new Error("PriceLabs 503"))

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: "PriceLabs 503", reportBuilder: RB_RESULT })
    expect(advanceReportBuilder).toHaveBeenCalledTimes(1)
    expect(enqueueMarketSignalJobs).not.toHaveBeenCalled()
  })

  it("reports a Report Builder crash without failing the pl_* sync", async () => {
    vi.mocked(syncPriceLabsData).mockResolvedValue(PL_RESULT)
    vi.mocked(advanceReportBuilder).mockRejectedValue(new Error("boom"))

    const response = await GET(cronRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.reportBuilder).toEqual({ status: "failed", error: "boom" })
    expect(body.synced).toBe(336)
  })

  it("rejects a request without the cron secret before touching PriceLabs", async () => {
    const response = await GET(cronRequest("wrong"))

    expect(response.status).toBe(401)
    expect(syncPriceLabsData).not.toHaveBeenCalled()
    expect(advanceReportBuilder).not.toHaveBeenCalled()
  })
})
