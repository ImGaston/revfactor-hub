import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { API_SCOPES, hasScope } from "@/lib/api-auth.server"

describe("market-map machine authentication", () => {
  it("registers a dedicated read-only API scope", () => {
    expect(API_SCOPES).toContain("market-map:read")
    expect(hasScope(["market-map:read"], "market-map:read")).toBe(true)
    expect(hasScope(["leads:read"], "market-map:read")).toBe(false)
  })

  it("keeps session auth and fails closed on bearer auth", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/market-map/route.ts"),
      "utf8"
    )

    expect(source).toContain('verifyApiKey(request, "market-map:read")')
    expect(source).toContain('hasPermission("market_signals", "view")')
    expect(source).toMatch(/authorization\s*\? await getApiKeyClient/)
    expect(source).not.toMatch(/\.select\(\s*["']\*["']\s*\)/)
  })
})
