import { describe, expect, it } from "vitest"

import { routeRevAiQuestion } from "@/lib/revai/models"

describe("routeRevAiQuestion", () => {
  it("sends short lookups to the quick tier", () => {
    expect(routeRevAiQuestion("What is RevPAR index?").tier).toBe("quick")
    expect(routeRevAiQuestion("How many active clients do we have?").tier).toBe("quick")
  })

  it("sends client, listing and pricing questions to the standard tier", () => {
    expect(routeRevAiQuestion("Show me the base and min price for the Gainesville listings").tier).toBe("standard")
    expect(routeRevAiQuestion("Draft a reply to Brandy about her open adjustment").tier).toBe("standard")
  })

  it("sends diagnosis and strategy questions to the deep tier", () => {
    expect(routeRevAiQuestion("Why is Kate Henry's revenue down vs last year?").tier).toBe("deep")
    expect(routeRevAiQuestion("Should we change our pricing model for clients with 10+ listings?").tier).toBe("deep")
    expect(routeRevAiQuestion("Write a playbook for gap-night minimum stays").tier).toBe("deep")
  })

  it("keeps follow-ups in a deep conversation at least standard", () => {
    expect(routeRevAiQuestion("ok thanks", { previousTier: "deep" }).tier).toBe("standard")
    expect(routeRevAiQuestion("ok thanks").tier).toBe("quick")
  })

  it("honours a manual pick", () => {
    const route = routeRevAiQuestion("What is RevPAR?", { choice: "deep" })
    expect(route).toMatchObject({ tier: "deep", forced: true })
  })
})
