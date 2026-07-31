export const SYNTHETIC_CLIENT_ID = "synthetic-revfactor-client"

export const AGENT_STUDIO_MODELS = [
  {
    id: "openai/gpt-5-nano",
    label: "GPT-5 Nano",
    description: "Lowest-cost OpenAI candidate",
    inputUsdPerMillion: 0.05,
    outputUsdPerMillion: 0.4,
    tier: "economy",
  },
  {
    id: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    description: "Low-cost Google candidate",
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.4,
    tier: "economy",
  },
  {
    id: "alibaba/qwen3.5-flash",
    label: "Qwen 3.5 Flash",
    description: "Low-cost provider-diversity candidate",
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.4,
    tier: "economy",
  },
  {
    id: "openai/gpt-5-mini",
    label: "GPT-5 Mini",
    description: "Affordable quality benchmark",
    inputUsdPerMillion: 0.25,
    outputUsdPerMillion: 2,
    tier: "economy",
  },
  {
    id: "openai/gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    description: "Higher-cost quality benchmark",
    inputUsdPerMillion: 0.75,
    outputUsdPerMillion: 4.5,
    tier: "benchmark",
  },
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "Premium OpenAI benchmark",
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 6,
    tier: "benchmark",
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Premium tone benchmark",
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 10,
    tier: "benchmark",
  },
] as const

export type AgentStudioModelId = (typeof AGENT_STUDIO_MODELS)[number]["id"]

export const DEFAULT_AGENT_STUDIO_MODEL: AgentStudioModelId =
  "openai/gpt-5-nano"

export const DEFAULT_AGENT_STUDIO_INSTRUCTIONS = `You are the RevFactor client service assistant.

Write concise, warm, professional responses for short-term rental hosts and portfolio operators.

Use plain English. Explain revenue-management concepts without sounding defensive or overly technical. Ground factual claims in the supplied client context or RevFactor knowledge. If the available information is insufficient, ask one focused follow-up question or escalate instead of guessing.

Never promise a refund, pricing change, contract change, performance outcome, or response deadline. Escalate billing, cancellation, legal, refund, safety, and unusually sensitive performance disputes to a human.

Write the reply as a draft a RevFactor team member can review before sending.`

export type AgentStudioClientOption = {
  id: string
  name: string
  status: string
  synthetic?: boolean
}

export type AgentStudioHistoryMessage = {
  role: "user" | "assistant"
  content: string
}

export type AgentStudioDisposition = "answer" | "clarify" | "escalate"
export type AgentStudioConfidence = "low" | "medium" | "high"

export type AgentStudioSource = {
  id: string
  title: string
  slug: string
  excerpt: string
  type?: "client" | "pricelabs" | "assembly" | "knowledge" | "task" | "adjustment"
  payload?: Record<string, unknown>
  fetchedAt?: string
  sourceUpdatedAt?: string | null
  warning?: string | null
}

export type AgentStudioToolTrace = {
  id: string
  name: string
  input: Record<string, unknown>
  resultSummary: string
  output?: Record<string, unknown>
  durationMs?: number | null
}

export type AgentStudioModelEstimate = {
  modelId: AgentStudioModelId
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  cachedInputUsdPerMillion: number | null
  estimatedCostUsd: number
  pricingFetchedAt: string
}

export type AgentStudioRun = {
  id: string
  conversationId?: string
  modelId: AgentStudioModelId
  clientName: string
  reply: string
  disposition: AgentStudioDisposition
  confidence: AgentStudioConfidence
  escalationReason: string | null
  reviewNotes: string[]
  sources: AgentStudioSource[]
  toolCalls: AgentStudioToolTrace[]
  usage: {
    inputTokens: number
    cachedInputTokens: number
    cacheWriteTokens: number
    outputTokens: number
    reasoningTokens: number
    totalTokens: number
    estimatedCostUsd: number
  }
  modelEstimates: AgentStudioModelEstimate[]
  durationMs: number
  createdAt: string
}

export type AgentStudioRunResult =
  | { ok: true; run: AgentStudioRun }
  | {
      ok: false
      error: string
      runId?: string
      conversationId?: string
      modelId?: AgentStudioModelId
      durationMs?: number
    }

export function isAgentStudioModelId(
  value: string
): value is AgentStudioModelId {
  return AGENT_STUDIO_MODELS.some((model) => model.id === value)
}

export function getAgentStudioModel(modelId: AgentStudioModelId) {
  return AGENT_STUDIO_MODELS.find((model) => model.id === modelId)!
}

export function estimateAgentStudioCost(
  modelId: AgentStudioModelId,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0
): number {
  const model = getAgentStudioModel(modelId)
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens)
  return (
    (uncachedInputTokens / 1_000_000) * model.inputUsdPerMillion +
    (outputTokens / 1_000_000) * model.outputUsdPerMillion
  )
}
