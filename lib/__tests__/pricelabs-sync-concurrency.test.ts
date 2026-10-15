import { describe, expect, it } from "vitest"

import { mapWithConcurrency } from "@/lib/pricelabs-sync"

describe("mapWithConcurrency", () => {
  it("keeps input order and never runs more than the limit at once", async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, n))
      inFlight--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30, 0, 60])
    expect(peak).toBe(3)
  })

  it("handles an empty list and a limit above the item count", async () => {
    expect(await mapWithConcurrency([], 10, async (n: number) => n)).toEqual([])
    expect(await mapWithConcurrency([1, 2], 10, async (n) => n + 1)).toEqual([2, 3])
  })
})
