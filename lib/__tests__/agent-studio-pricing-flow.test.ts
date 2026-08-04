import { describe, expect, it, vi } from "vitest"

import {
  SYNTHETIC_CLIENT_ID,
  canModelUseClient,
  canModelUseRunInput,
  isSyntheticOnlyModel,
} from "@/lib/agent-studio"
import {
  PRICING_PERFORMANCE_PILOT_ID,
  isPricingPerformanceRequest,
  runPricingPerformancePilot,
} from "@/lib/agent-studio-pricing-flow.server"

const generatedOutput = {
  disposition: "answer" as const,
  reply: "Your forward occupancy is currently above the market benchmark.",
  confidence: "high" as const,
  escalationReason: null,
  reviewNotes: [],
}

describe("DeepSeek data boundary", () => {
  const deepSeekModel = "deepseek/deepseek-v4-flash-0731" as const

  it("allows DeepSeek only with the synthetic client", () => {
    expect(isSyntheticOnlyModel(deepSeekModel)).toBe(true)
    expect(canModelUseClient(deepSeekModel, SYNTHETIC_CLIENT_ID)).toBe(true)
    expect(canModelUseClient(deepSeekModel, "real-client-id")).toBe(false)
  })

  it("keeps approved models available for permission-scoped clients", () => {
    expect(canModelUseClient("openai/gpt-5-nano", "real-client-id")).toBe(true)
  })

  it("rejects frozen snapshots for a synthetic-only model", () => {
    expect(
      canModelUseRunInput(deepSeekModel, {
        clientId: SYNTHETIC_CLIENT_ID,
        hasFrozenSourceSnapshot: true,
      })
    ).toBe(false)
    expect(
      canModelUseRunInput(deepSeekModel, {
        clientId: SYNTHETIC_CLIENT_ID,
        hasFrozenSourceSnapshot: false,
      })
    ).toBe(true)
  })
})

describe("Pricing & Performance LangGraph pilot", () => {
  it("recognizes common pricing and performance questions", () => {
    expect(isPricingPerformanceRequest("How is my 90-day occupancy?")).toBe(
      true
    )
    expect(isPricingPerformanceRequest("Can we change the base price?")).toBe(
      true
    )
    expect(isPricingPerformanceRequest("How do I update my password?")).toBe(
      false
    )
  })

  it("stops outside-scope requests before a model call", async () => {
    const generateDraft = vi.fn(async () => ({ output: generatedOutput }))
    const result = await runPricingPerformancePilot({
      message: "How do I update my password?",
      evidence: {
        listingCount: 1,
        hasForwardPerformanceMetrics: true,
        hasPriceLabsReport: true,
      },
      generateDraft,
      readOutput: (generation) => generation.output,
    })

    expect(generateDraft).not.toHaveBeenCalled()
    expect(result.output.disposition).toBe("clarify")
    expect(result.steps.map((item) => item.id)).toEqual([
      "classify_intent",
      "outside_pilot",
    ])
  })

  it("stops when no permitted performance evidence is available", async () => {
    const generateDraft = vi.fn(async () => ({ output: generatedOutput }))
    const result = await runPricingPerformancePilot({
      message: "How is my occupancy?",
      evidence: {
        listingCount: 1,
        hasForwardPerformanceMetrics: false,
        hasPriceLabsReport: false,
      },
      generateDraft,
      readOutput: (generation) => generation.output,
    })

    expect(generateDraft).not.toHaveBeenCalled()
    expect(result.output.disposition).toBe("clarify")
    expect(result.steps.map((item) => item.id)).toEqual([
      "classify_intent",
      "validate_evidence",
      "insufficient_evidence",
    ])
  })

  it("generates a draft and records the observable execution path", async () => {
    const generateDraft = vi.fn(async () => ({ output: generatedOutput }))
    const result = await runPricingPerformancePilot({
      message: "How is my 90-day occupancy against the market?",
      evidence: {
        listingCount: 1,
        hasForwardPerformanceMetrics: true,
        hasPriceLabsReport: false,
      },
      generateDraft,
      readOutput: (generation) => generation.output,
    })

    expect(generateDraft).toHaveBeenCalledOnce()
    expect(result.flowId).toBe(PRICING_PERFORMANCE_PILOT_ID)
    expect(result.output).toEqual(generatedOutput)
    expect(result.steps.map((item) => item.id)).toEqual([
      "classify_intent",
      "validate_evidence",
      "generate_draft",
      "client_ready_check",
    ])
  })
})
