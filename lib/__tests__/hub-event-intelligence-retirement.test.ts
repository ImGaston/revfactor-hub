import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NAV_ITEMS, isNavItemActive } from "@/lib/navigation"
import { commands as COMMANDS } from "@/lib/command-registry"
import { RESOURCES } from "@/lib/permissions"

const mocks = vi.hoisted(() => ({
  admin: vi.fn(() => ({})),
  priceLabsConfigured: vi.fn(() => true),
  stripeConfigured: vi.fn(() => true),
  priceLabs: vi.fn(async () => ({ synced: 2 })),
  report: vi.fn(async () => ({ status: "completed" })),
  stripe: vi.fn(async () => ({
    subscriptions: { upserted: 1 },
    invoices: { upserted: 2 },
    payouts: { upserted: 3 },
  })),
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/pricelabs", () => ({
  isPriceLabsConfigured: mocks.priceLabsConfigured,
}))
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: mocks.stripeConfigured }))
vi.mock("@/lib/pricelabs-sync", () => ({ syncPriceLabsData: mocks.priceLabs }))
vi.mock("@/lib/stripe-sync", () => ({ syncStripeData: mocks.stripe }))
vi.mock("@/lib/report-builder/runner", () => ({
  advanceReportBuilder: mocks.report,
}))

import { GET as priceLabs } from "@/app/api/cron/sync-pricelabs/route"
import { GET as stripe } from "@/app/api/cron/sync-stripe/route"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", "retirement-test-secret")
  mocks.priceLabsConfigured.mockReturnValue(true)
  mocks.stripeConfigured.mockReturnValue(true)
})
afterEach(() => vi.unstubAllEnvs())

const authorized = () =>
  new NextRequest("https://hub.example/api/cron/test", {
    headers: { authorization: "Bearer retirement-test-secret" },
  })

describe("Hub retirement keeps its syncs without Event Intelligence work", () => {
  it("syncs PriceLabs and Report Builder without a market queue response", async () => {
    const response = await priceLabs(authorized())
    const result = await response.json()
    expect(response.status).toBe(200)
    expect(result.synced).toBe(2)
    expect(result.reportBuilder).toEqual({ status: "completed" })
    expect(result).not.toHaveProperty("marketSignalJobs")
    expect(result).not.toHaveProperty("marketSignals")
    expect(mocks.priceLabs).toHaveBeenCalledOnce()
    expect(mocks.report).toHaveBeenCalledOnce()
  })

  it("syncs Stripe without a market worker response", async () => {
    const response = await stripe(authorized())
    const result = await response.json()
    expect(response.status).toBe(200)
    expect(result.subscriptions.upserted).toBe(1)
    expect(result.invoices.upserted).toBe(2)
    expect(result.payouts.upserted).toBe(3)
    expect(result).not.toHaveProperty("marketSignals")
    expect(result).not.toHaveProperty("marketSignalJobs")
    expect(mocks.stripe).toHaveBeenCalledOnce()
  })

  it.each([priceLabs, stripe])(
    "rejects an unauthenticated request before any privileged work",
    async (handler) => {
      expect(
        (await handler(new NextRequest("https://hub.example/api/cron/test")))
          .status
      ).toBe(401)
      expect(mocks.admin).not.toHaveBeenCalled()
      expect(mocks.priceLabs).not.toHaveBeenCalled()
      expect(mocks.stripe).not.toHaveBeenCalled()
      expect(mocks.report).not.toHaveBeenCalled()
    }
  )

  it("retains the shared permission and stable nav identity while opening RM", () => {
    expect(
      RESOURCES.some((resource) => resource.key === "market_signals")
    ).toBe(true)
    const item = NAV_ITEMS.find((item) => item.key === "market-signals")!
    expect(item.resource).toBe("market_signals")
    expect(item.href).toBe("https://pricing.revfactor.io/signals.html")
    expect(isNavItemActive(item, "/listings")).toBe(false)
    const command = COMMANDS.find(
      (command) => command.id === "nav-market-signals"
    )!
    expect(command.href).toBe(item.href)
    expect(command.permission).toEqual({
      resource: "market_signals",
      action: "view",
    })
  })

  it("removes the runtime entry points without changing the permission catalog", () => {
    for (const path of [
      "lib/market-signals/contracts.ts",
      "app/(authenticated)/market-signals/page.tsx",
      "app/api/cron/market-signals/route.ts",
      "app/api/market-map/route.ts",
    ])
      expect(existsSync(join(process.cwd(), path))).toBe(false)
    for (const path of [
      "app/api/cron/sync-pricelabs/route.ts",
      "app/api/cron/sync-stripe/route.ts",
    ])
      expect(readFileSync(join(process.cwd(), path), "utf8")).not.toContain(
        "@/lib/market-signals"
      )
  })
})
