import "server-only"

// Vercel AI Gateway credentials for plain-fetch calls (e.g. Jev on
// /v1/evaluate). Same rule as the AI SDK gateway provider and the existing
// Market Signals / Agent Studio config check: AI_GATEWAY_API_KEY locally,
// the Vercel OIDC token in deployments. Never log or return the token.

import { getVercelOidcToken } from "@vercel/oidc"

export const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"

/** The same "configured" rule as Market Signals briefs and Agent Studio. */
export function isAiGatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL)
}

export type AiGatewayAuth = { token: string; method: "api-key" | "oidc" }

/** Mirrors @ai-sdk/gateway getGatewayAuthToken: API key first, then OIDC. Null when neither is available. */
export async function getAiGatewayAuth(): Promise<AiGatewayAuth | null> {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim()
  if (apiKey) return { token: apiKey, method: "api-key" }
  try {
    const token = await getVercelOidcToken()
    return token ? { token, method: "oidc" } : null
  } catch {
    return null
  }
}
