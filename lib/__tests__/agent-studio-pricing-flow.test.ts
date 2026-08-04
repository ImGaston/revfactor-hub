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
import {
  LANGSMITH_SANDBOX_PROJECT,
  getLangSmithSandboxTraceDecision,
  tracePricingPerformanceSandbox,
} from "@/lib/agent-studio-langsmith.server"

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

describe("LangSmith sandbox boundary", () => {
  const context = {
    clientId: SYNTHETIC_CLIENT_ID,
    executionMode: "pricing_performance_pilot" as const,
    hasFrozenSourceSnapshot: false,
  }
  const validEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    LANGSMITH_API_KEY: "lsv2_sk_test-service-key",
    LANGSMITH_WORKSPACE_ID: "workspace-test",
    LANGSMITH_PROJECT: LANGSMITH_SANDBOX_PROJECT,
  }

  it("enables only a correctly configured synthetic pilot run", () => {
    expect(getLangSmithSandboxTraceDecision(context, validEnv)).toEqual({
      enabled: true,
      reason: "enabled",
    })
  })

  it("rejects personal access tokens", () => {
    expect(
      getLangSmithSandboxTraceDecision(context, {
        ...validEnv,
        LANGSMITH_API_KEY: "lsv2_pt_exposed-personal-token",
      })
    ).toEqual({ enabled: false, reason: "service_key_required" })
  })

  it("blocks production regardless of configuration", () => {
    expect(
      getLangSmithSandboxTraceDecision(context, {
        ...validEnv,
        VERCEL_ENV: "production",
      })
    ).toEqual({ enabled: false, reason: "production_blocked" })
  })

  it("blocks real clients and frozen snapshots", () => {
    expect(
      getLangSmithSandboxTraceDecision(
        { ...context, clientId: "real-client-id" },
        validEnv
      )
    ).toEqual({ enabled: false, reason: "synthetic_client_required" })
    expect(
      getLangSmithSandboxTraceDecision(
        { ...context, hasFrozenSourceSnapshot: true },
        validEnv
      )
    ).toEqual({ enabled: false, reason: "frozen_snapshot_blocked" })
  })

  it("still executes locally without emitting a trace when unconfigured", async () => {
    const result = await tracePricingPerformanceSandbox({
      context: {
        ...context,
        modelId: "openai/gpt-5-nano",
        playbookVersionId: null,
        question: "How is my occupancy?",
      },
      operation: async () => ({
        flowId: PRICING_PERFORMANCE_PILOT_ID,
        output: generatedOutput,
        generation: null,
        steps: [],
      }),
    })

    expect(result.result.output).toEqual(generatedOutput)
    expect(result.traced).toBe(false)
    expect(result.traceId).toBeNull()
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
