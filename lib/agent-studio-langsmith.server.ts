import { traceable } from "langsmith/traceable"

import {
  PRICING_PERFORMANCE_PILOT_ID,
  type PricingPerformanceFlowResult,
} from "@/lib/agent-studio-pricing-flow.server"
import {
  SYNTHETIC_CLIENT_ID,
  type AgentStudioModelId,
} from "@/lib/agent-studio"
import type { AgentIntegrationHealth } from "@/lib/agent-studio-governance"

export const LANGSMITH_SANDBOX_PROJECT = "revfactor-agent-studio-sandbox"

export type LangSmithSandboxTraceContext = {
  clientId: string
  executionMode: "standard" | "pricing_performance_pilot"
  hasFrozenSourceSnapshot: boolean
  modelId: AgentStudioModelId
  playbookVersionId: string | null
  question: string
}

export type LangSmithSandboxTraceDecision = {
  enabled: boolean
  reason:
    | "enabled"
    | "service_key_required"
    | "workspace_id_required"
    | "project_mismatch"
    | "production_blocked"
    | "flow_pilot_required"
    | "synthetic_client_required"
    | "frozen_snapshot_blocked"
}

function hasServiceKey(env: NodeJS.ProcessEnv): boolean {
  const apiKey = env.LANGSMITH_API_KEY?.trim()
  return Boolean(apiKey && !apiKey.startsWith("lsv2_pt_"))
}

export function getLangSmithSandboxTraceDecision(
  context: Pick<
    LangSmithSandboxTraceContext,
    "clientId" | "executionMode" | "hasFrozenSourceSnapshot"
  >,
  env: NodeJS.ProcessEnv = process.env
): LangSmithSandboxTraceDecision {
  if (env.VERCEL_ENV === "production") {
    return { enabled: false, reason: "production_blocked" }
  }
  if (!env.VERCEL_ENV && env.NODE_ENV === "production") {
    return { enabled: false, reason: "production_blocked" }
  }
  if (!hasServiceKey(env)) {
    return { enabled: false, reason: "service_key_required" }
  }
  if (!env.LANGSMITH_WORKSPACE_ID?.trim()) {
    return { enabled: false, reason: "workspace_id_required" }
  }
  if (env.LANGSMITH_PROJECT !== LANGSMITH_SANDBOX_PROJECT) {
    return { enabled: false, reason: "project_mismatch" }
  }
  if (context.executionMode !== "pricing_performance_pilot") {
    return { enabled: false, reason: "flow_pilot_required" }
  }
  if (context.clientId !== SYNTHETIC_CLIENT_ID) {
    return { enabled: false, reason: "synthetic_client_required" }
  }
  if (context.hasFrozenSourceSnapshot) {
    return { enabled: false, reason: "frozen_snapshot_blocked" }
  }
  return { enabled: true, reason: "enabled" }
}

export async function tracePricingPerformanceSandbox<TGeneration>({
  context,
  operation,
}: {
  context: LangSmithSandboxTraceContext
  operation: () => Promise<PricingPerformanceFlowResult<TGeneration>>
}): Promise<{
  result: PricingPerformanceFlowResult<TGeneration>
  traceId: string | null
  traced: boolean
}> {
  const decision = getLangSmithSandboxTraceDecision(context)
  let traceId: string | null = null
  const tracedOperation = traceable(
    async (traceInput: { question: string }) => {
      void traceInput
      return operation()
    },
    {
      name: "RevFactor Pricing & Performance sandbox",
      run_type: "chain",
      project_name: LANGSMITH_SANDBOX_PROJECT,
      tracingEnabled: decision.enabled,
      tags: [
        "agent-studio",
        "sandbox",
        "synthetic-only",
        "pricing-performance-pilot",
      ],
      metadata: {
        model: context.modelId,
        playbookVersion: context.playbookVersionId ?? "session-draft",
        flowId: PRICING_PERFORMANCE_PILOT_ID,
        dataBoundary: "built-in-synthetic-only",
        deploymentEnvironment:
          process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
        gitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      },
      on_start(runTree) {
        traceId = runTree?.id ?? null
      },
      processInputs: (inputs) => ({
        question: inputs.question,
        dataBoundary: "built-in-synthetic-only",
      }),
      processOutputs: (output) => ({
        flowId: output.flowId,
        disposition: output.output.disposition,
        reply: output.output.reply,
        confidence: output.output.confidence,
        escalationReason: output.output.escalationReason,
        reviewNotes: output.output.reviewNotes,
        steps: output.steps.map((step) => ({
          id: step.id,
          outcome: step.outcome,
          durationMs: step.durationMs,
        })),
      }),
    }
  )

  const result = await tracedOperation({ question: context.question })
  return {
    result,
    traceId: decision.enabled ? traceId : null,
    traced: decision.enabled,
  }
}

export function getLangSmithSandboxHealth(
  env: NodeJS.ProcessEnv = process.env
): AgentIntegrationHealth {
  const decision = getLangSmithSandboxTraceDecision(
    {
      clientId: SYNTHETIC_CLIENT_ID,
      executionMode: "pricing_performance_pilot",
      hasFrozenSourceSnapshot: false,
    },
    env
  )

  return {
    integration: "langsmith",
    status: decision.enabled ? "connected" : "unavailable",
    latencyMs: null,
    lastSourceUpdateAt: null,
    details: {
      configured: decision.enabled,
      project: LANGSMITH_SANDBOX_PROJECT,
      reason: decision.reason,
      syntheticOnly: true,
      frozenSnapshotsBlocked: true,
      productionBlocked: true,
      remoteConnectionVerified: false,
    },
    checkedAt: new Date().toISOString(),
  }
}
