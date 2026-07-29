import { unstable_cache } from "next/cache"

import {
  AGENT_STUDIO_MODELS,
  type AgentStudioModelEstimate,
  type AgentStudioModelId,
} from "@/lib/agent-studio"

type GatewayPricing = {
  input?: string
  output?: string
  input_cache_read?: string
  input_cache_write?: string
}

type GatewayModel = {
  id: string
  type: string
  pricing?: GatewayPricing
}

type GatewayModelsResponse = {
  data?: GatewayModel[]
}

export type AgentStudioPricing = {
  modelId: AgentStudioModelId
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  cachedInputUsdPerMillion: number | null
  cacheWriteUsdPerMillion: number | null
  fetchedAt: string
}

function perMillion(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed * 1_000_000 : null
}

const loadGatewayPricing = unstable_cache(
  async (): Promise<AgentStudioPricing[]> => {
    const fetchedAt = new Date().toISOString()

    try {
      const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw new Error(`Gateway catalog ${response.status}`)

      const payload = (await response.json()) as GatewayModelsResponse
      const models = new Map(
        (payload.data ?? []).map((model) => [model.id, model])
      )

      return AGENT_STUDIO_MODELS.map((fallback) => {
        const live = models.get(fallback.id)
        return {
          modelId: fallback.id,
          inputUsdPerMillion:
            perMillion(live?.pricing?.input) ?? fallback.inputUsdPerMillion,
          outputUsdPerMillion:
            perMillion(live?.pricing?.output) ?? fallback.outputUsdPerMillion,
          cachedInputUsdPerMillion: perMillion(
            live?.pricing?.input_cache_read
          ),
          cacheWriteUsdPerMillion: perMillion(
            live?.pricing?.input_cache_write
          ),
          fetchedAt,
        }
      })
    } catch {
      return AGENT_STUDIO_MODELS.map((model) => ({
        modelId: model.id,
        inputUsdPerMillion: model.inputUsdPerMillion,
        outputUsdPerMillion: model.outputUsdPerMillion,
        cachedInputUsdPerMillion: null,
        cacheWriteUsdPerMillion: null,
        fetchedAt,
      }))
    }
  },
  ["agent-studio-gateway-pricing-v1"],
  { revalidate: 3600 }
)

export async function getAgentStudioPricing() {
  return loadGatewayPricing()
}

export function calculateModelCost(
  pricing: AgentStudioPricing,
  usage: {
    inputTokens: number
    cachedInputTokens: number
    cacheWriteTokens: number
    outputTokens: number
  }
): number {
  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens
  )
  const cachedInputRate =
    pricing.cachedInputUsdPerMillion ?? pricing.inputUsdPerMillion
  const cacheWriteRate =
    pricing.cacheWriteUsdPerMillion ?? pricing.inputUsdPerMillion

  return (
    (uncachedInputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (usage.cachedInputTokens / 1_000_000) * cachedInputRate +
    (usage.cacheWriteTokens / 1_000_000) * cacheWriteRate +
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillion
  )
}

export async function buildAgentStudioModelEstimates(usage: {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
}): Promise<AgentStudioModelEstimate[]> {
  const pricing = await getAgentStudioPricing()

  return pricing.map((model) => ({
    modelId: model.modelId,
    inputUsdPerMillion: model.inputUsdPerMillion,
    outputUsdPerMillion: model.outputUsdPerMillion,
    cachedInputUsdPerMillion: model.cachedInputUsdPerMillion,
    estimatedCostUsd: calculateModelCost(model, usage),
    pricingFetchedAt: model.fetchedAt,
  }))
}
