import "server-only"

// Jev over HTTP. Primary transport: Vercel AI Gateway `POST /v1/evaluate`
// (model `typesafe-ai/jev`), authenticated like every other Gateway call in
// the Hub (AI_GATEWAY_API_KEY locally, Vercel OIDC in deployments). Optional
// fallback: TypeSafe directly, pinned `jev-1.13.0`, only when TYPESAFE_API_KEY
// is set. No SDK, no OpenRouter, no /chat/completions.
//
// Never log, return, or store a token: every error text and the stored
// response are scrubbed. Nothing configured = a typed "not_configured"
// result, never a throw, so pages and the capture API degrade instead.

import { getAiGatewayAuth, isAiGatewayConfigured } from "@/lib/ai-gateway.server"
import {
  JEV_ENDPOINT,
  JEV_GATEWAY_ENDPOINT,
  JEV_GATEWAY_MODEL,
  JEV_MODEL,
  gateNoul,
  jevResponseModelVersion,
  normalizeJevAnswers,
  toGatewayQuestions,
  type JevChoiceAnswer,
  type JevQuestions,
  type JevTransport,
} from "@/lib/jev"

export const TYPESAFE_ENV_KEY = "TYPESAFE_API_KEY"
const DEFAULT_TIMEOUT_MS = 20_000
const ERROR_BODY_MAX = 400
const SECRET_ENV_KEYS = [TYPESAFE_ENV_KEY, "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "OPENROUTER_API_KEY"]

export type JevDecideResult =
  | {
      ok: true
      transport: JevTransport
      /** The model id we asked for (`typesafe-ai/jev` or `jev-1.13.0`) */
      model: string
      /** The version the response reports, if any */
      modelVersion: string | null
      /** Answers normalized to { choice, probabilities, confidence } / { noul } */
      answers: Record<string, unknown>
      /** The whole response body, scrubbed, for the audit trail */
      raw: Record<string, unknown>
      durationMs: number
    }
  | {
      ok: false
      reason: "not_configured" | "http_error" | "network_error" | "bad_response"
      error: string
      status?: number
    }

type Failure = Extract<JevDecideResult, { ok: false }>

function typesafeKey(): string | null {
  const key = process.env[TYPESAFE_ENV_KEY]?.trim()
  return key ? key : null
}

/** Jev is usable through AI Gateway, or through TypeSafe directly when its key is set. */
export function isJevConfigured(): boolean {
  return isAiGatewayConfigured() || typesafeKey() !== null
}

/** Strip any credential value (env keys, the token used, bearer headers) out of text. */
export function scrubSecrets(text: string, extra: (string | null | undefined)[] = []): string {
  let out = text
  const secrets = [...SECRET_ENV_KEYS.map((name) => process.env[name]?.trim()), ...extra]
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[REDACTED]")
  }
  return out.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
}

function assertOfficialTargets(): void {
  // Constants, but guard against a future edit pointing elsewhere
  if (!JEV_GATEWAY_ENDPOINT.startsWith("https://ai-gateway.vercel.sh/")) throw new Error("Jev gateway endpoint changed")
  if (JEV_MODEL !== "jev-1.13.0") throw new Error("Direct Jev must stay pinned to jev-1.13.0")
  for (const url of [JEV_GATEWAY_ENDPOINT, JEV_ENDPOINT]) {
    if (url.includes("/chat/completions") || url.includes("openrouter")) throw new Error("Jev endpoints only")
  }
}

async function post(
  url: string,
  token: string,
  headers: Record<string, string>,
  body: unknown,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<{ ok: true; payload: Record<string, unknown> } | Failure> {
  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: "network_error", error: scrubSecrets(`Jev network error: ${message}`, [token]) }
  }
  if (!response.ok) {
    let text = ""
    try {
      text = (await response.text()).slice(0, ERROR_BODY_MAX)
    } catch {
      // ignore unreadable bodies
    }
    return {
      ok: false,
      reason: "http_error",
      status: response.status,
      error: scrubSecrets(`Jev HTTP ${response.status}${text ? `: ${text}` : ""}`, [token]),
    }
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { ok: false, reason: "bad_response", error: "Jev response was not JSON" }
  }
  const raw = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null
  const answers = raw?.answers
  if (!raw || !answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { ok: false, reason: "bad_response", error: "Jev response is missing the answers object" }
  }
  // Round-trip through the scrubber so nothing secret can reach the audit row
  return { ok: true, payload: JSON.parse(scrubSecrets(JSON.stringify(raw), [token])) as Record<string, unknown> }
}

/**
 * Ask Jev. The caller redacts the state first (`redactJevState`). Tries AI
 * Gateway, then TypeSafe directly when TYPESAFE_API_KEY is set and the
 * gateway is unavailable or fails.
 */
export async function jevDecide(
  state: Record<string, unknown>,
  questions: JevQuestions,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<JevDecideResult> {
  assertOfficialTargets()
  const startedAt = Date.now()
  let gatewayFailure: Failure | null = null

  if (isAiGatewayConfigured()) {
    const auth = await getAiGatewayAuth()
    if (auth) {
      const result = await post(
        JEV_GATEWAY_ENDPOINT,
        auth.token,
        { "ai-gateway-auth-method": auth.method },
        { model: JEV_GATEWAY_MODEL, state, questions: toGatewayQuestions(questions) },
        options
      )
      if (result.ok) {
        return {
          ok: true,
          transport: "gateway",
          model: JEV_GATEWAY_MODEL,
          modelVersion: jevResponseModelVersion(result.payload),
          answers: normalizeJevAnswers(result.payload.answers as Record<string, unknown>, questions),
          raw: result.payload,
          durationMs: Date.now() - startedAt,
        }
      }
      gatewayFailure = result
    } else {
      gatewayFailure = { ok: false, reason: "not_configured", error: "No AI Gateway credential is available." }
    }
  }

  const key = typesafeKey()
  if (key) {
    const result = await post(JEV_ENDPOINT, key, {}, { model: JEV_MODEL, state, questions }, options)
    if (result.ok) {
      return {
        ok: true,
        transport: "typesafe",
        model: JEV_MODEL,
        modelVersion: jevResponseModelVersion(result.payload),
        answers: normalizeJevAnswers(result.payload.answers as Record<string, unknown>, questions),
        raw: result.payload,
        durationMs: Date.now() - startedAt,
      }
    }
    return gatewayFailure
      ? { ...result, error: `${gatewayFailure.error} Fallback: ${result.error}` }
      : result
  }

  return (
    gatewayFailure ?? {
      ok: false,
      reason: "not_configured",
      error: "AI Gateway is not configured, so the AI check is not configured.",
    }
  )
}

export type JevConnectionTest =
  | {
      ok: true
      transport: JevTransport
      model: string
      modelVersion: string | null
      latencyMs: number
      /** Jev's probability for a statement that is plainly true */
      probability: number | null
      /** It cleared the >= 0.90 bar, i.e. the gate can read this shape */
      decided: boolean
      /** Field names Jev returned for the question, to confirm the live shape */
      answerFields: string[]
    }
  | { ok: false; reason: Failure["reason"]; error: string; status?: number }

/**
 * One trivial boolean and one trivial choice: confirms auth, transport, and
 * both request and response shapes (the answer checks use choices) without
 * exposing any secret.
 */
export async function testJevConnection(options: { fetchImpl?: typeof fetch } = {}): Promise<JevConnectionTest> {
  const questions: JevQuestions = {
    connection_check: {
      type: "noul",
      instructions: "`text` says the sky is blue.",
      criteria: { true: "The text says the sky is blue.", false: "The text says something else." },
    },
    connection_choice: {
      type: "choice",
      instructions: "What color does `text` say the sky is?",
      criteria: { blue: "The text says blue.", other: "The text says another color or none." },
    },
  }
  const result = await jevDecide({ text: "The sky is blue." }, questions, { ...options, timeoutMs: 15_000 })
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error, status: result.status }
  if (!(result.answers.connection_choice as JevChoiceAnswer | undefined)?.choice)
    return { ok: false, reason: "bad_response", error: "Jev answered the yes/no question but not the choice question." }
  const rawAnswer = (result.raw.answers as Record<string, unknown>)?.connection_check
  const gate = gateNoul(result.answers.connection_check)
  return {
    ok: true,
    transport: result.transport,
    model: result.model,
    modelVersion: result.modelVersion,
    latencyMs: result.durationMs,
    probability: gate.noul,
    decided: gate.decided && gate.value,
    answerFields:
      rawAnswer && typeof rawAnswer === "object" && !Array.isArray(rawAnswer) ? Object.keys(rawAnswer).slice(0, 12) : [],
  }
}
