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
  plListings: vi.fn(async () => [{ id: "pl-1" }, { id: "pl-2" }]),
  // Mirrors the real sync: it reads Hub listings, then calls the route's
  // fetcher for GET /v1/listings.
  priceLabs: vi.fn(
    async (
      _supabase: unknown,
      deps: { fetchListings: () => Promise<unknown[]> }
    ) => {
      await deps.fetchListings()
      return { synced: 2 }
    }
  ),
  report: vi.fn(async () => ({ status: "completed" })),
  setupCheck: vi.fn(async () => ({ listings: 1, checked: 3, details: [{ key: "price.min" }] })),
  snapshots: vi.fn(async () => ({ captured: 2, enabled: true })),
  checkpoints: vi.fn(async () => ({ saved: 1, errors: [], enabled: true })),
  stripe: vi.fn(async () => ({
    subscriptions: { upserted: 1 },
    invoices: { upserted: 2 },
    payouts: { upserted: 3 },
  })),
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/pricelabs", () => ({
  isPriceLabsConfigured: mocks.priceLabsConfigured,
  fetchPriceLabsListings: mocks.plListings,
}))
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: mocks.stripeConfigured }))
vi.mock("@/lib/pricelabs-sync", () => ({ syncPriceLabsData: mocks.priceLabs }))
vi.mock("@/lib/stripe-sync", () => ({ syncStripeData: mocks.stripe }))
vi.mock("@/lib/report-builder/runner", () => ({
  advanceReportBuilder: mocks.report,
}))
vi.mock("@/lib/listing-setup-check.server", () => ({
  runListingSetupCheck: mocks.setupCheck,
}))
vi.mock("@/lib/listing-outcomes.server", () => ({
  captureDailySnapshots: mocks.snapshots,
  runOutcomeCheckpoints: mocks.checkpoints,
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
    // The listing setup check runs after the sync; details stay out of the response.
    expect(mocks.setupCheck).toHaveBeenCalledOnce()
    expect(result.setupCheck).toEqual({ listings: 1, checked: 3, details: [] })
    expect(result.outcomes).toEqual({
      snapshots: { captured: 2, enabled: true },
      checkpoints: { saved: 1, errors: [], enabled: true },
    })
  })

  it("fetches PriceLabs listings once, with push-off ones, and shares them with the setup check", async () => {
    await priceLabs(authorized())
    expect(mocks.plListings).toHaveBeenCalledOnce()
    expect(mocks.plListings).toHaveBeenCalledWith(false, {
      deadline: expect.any(Number),
    })
    expect(mocks.setupCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allPriceLabsListings: [{ id: "pl-1" }, { id: "pl-2" }],
      })
    )
  })

  it("still runs the Report Builder when the PriceLabs listings request times out, and reports the failure", async () => {
    mocks.plListings.mockRejectedValueOnce(
      new Error("PriceLabs /listings timed out (2 attempts: 20s, 14s)")
    )
    const response = await priceLabs(authorized())
    const result = await response.json()
    expect(response.status).toBe(500)
    expect(result.error).toBe(
      "PriceLabs sync failed: PriceLabs /listings timed out (2 attempts: 20s, 14s)"
    )
    // The setup check needs PriceLabs data; it is skipped instead of refetching.
    expect(mocks.setupCheck).not.toHaveBeenCalled()
    expect(result.setupCheck).toEqual({
      skipped: true,
      reason:
        "PriceLabs listings unavailable: PriceLabs /listings timed out (2 attempts: 20s, 14s)",
    })
    // Outcomes don't need today's sync: snapshots capture whatever synced
    // today, checkpoints read reservations and stored snapshots.
    expect(mocks.snapshots).toHaveBeenCalledOnce()
    expect(mocks.checkpoints).toHaveBeenCalledOnce()
    expect(result.outcomes).toEqual({
      snapshots: { captured: 2, enabled: true },
      checkpoints: { saved: 1, errors: [], enabled: true },
    })
    expect(mocks.report).toHaveBeenCalledOnce()
    expect(result.reportBuilder).toEqual({ status: "completed" })
  })

  it("captures snapshots before checkpoint reviews read them", async () => {
    await priceLabs(authorized())
    expect(mocks.snapshots.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.checkpoints.mock.invocationCallOrder[0]
    )
    expect(mocks.checkpoints).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deadline: expect.any(Number) })
    )
  })

  it("lets the setup check fetch for itself when the sync fails before reaching PriceLabs", async () => {
    mocks.priceLabs.mockRejectedValueOnce(
      new Error("PriceLabs sync database read failed: boom")
    )
    const response = await priceLabs(authorized())
    const result = await response.json()
    expect(response.status).toBe(500)
    expect(result.error).toBe(
      "PriceLabs sync failed: PriceLabs sync database read failed: boom"
    )
    expect(mocks.setupCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allPriceLabsListings: undefined })
    )
    expect(result.setupCheck).toEqual({ listings: 1, checked: 3, details: [] })
    expect(result.outcomes.checkpoints).toEqual({ saved: 1, errors: [], enabled: true })
    expect(mocks.report).toHaveBeenCalledOnce()
  })

  it("keeps a failing chained step from hiding the others", async () => {
    mocks.setupCheck.mockRejectedValueOnce(new Error("setup boom"))
    mocks.snapshots.mockRejectedValueOnce(new Error("snapshot boom"))
    mocks.report.mockRejectedValueOnce(new Error("report boom"))
    const response = await priceLabs(authorized())
    const result = await response.json()
    expect(response.status).toBe(200)
    expect(result.synced).toBe(2)
    expect(result.setupCheck).toEqual({ error: "setup boom" })
    // A failed snapshot capture doesn't skip the checkpoint reviews.
    expect(result.outcomes).toEqual({
      snapshots: { error: "snapshot boom" },
      checkpoints: { saved: 1, errors: [], enabled: true },
    })
    expect(result.reportBuilder).toEqual({
      status: "failed",
      error: "report boom",
    })
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
