import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const protectedCronRoutes = [
  "app/api/cron/market-signals/route.ts",
  "app/api/cron/report-builder/route.ts",
  "app/api/cron/sync-pricelabs/route.ts",
  "app/api/cron/sync-stripe/route.ts",
]

describe("privileged cron authentication", () => {
  it.each(protectedCronRoutes)("fails closed in %s", (route) => {
    const source = readFileSync(join(process.cwd(), route), "utf8")

    expect(source).toContain("!cronSecret")
    expect(source).toContain("Bearer ${cronSecret}")
    expect(source).toContain("status: 401")
    expect(source).not.toContain(
      "cronSecret && authHeader !== `Bearer ${cronSecret}`"
    )
  })
})
