import "server-only"

// Official TypeSafe HTTP client for Jev. Mirrors the team's wikibird client
// (tools/jev/client.py): HTTP only, pinned model, key from the environment
// only. Never log, return, or store the key; every error text is scrubbed.
// A missing key is a typed "not_configured" result, never a throw, so pages
// and the capture API degrade instead of failing.

import { JEV_ENDPOINT, JEV_MODEL, type JevQuestions } from "@/lib/jev"

export const TYPESAFE_ENV_KEY = "TYPESAFE_API_KEY"
const DEFAULT_TIMEOUT_MS = 20_000
const ERROR_BODY_MAX = 400

export type JevDecideResult =
  | {
      ok: true
      model: typeof JEV_MODEL
      /** Answers keyed by question key, exactly as Jev returned them */
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

function typesafeKey(): string | null {
  const key = process.env[TYPESAFE_ENV_KEY]?.trim()
  return key ? key : null
}

export function isJevConfigured(): boolean {
  return typesafeKey() !== null
}

/** Strip any API key value (and bearer headers) out of text before it leaves this module. */
export function scrubSecrets(text: string): string {
  let out = text
  for (const name of [TYPESAFE_ENV_KEY, "OPENROUTER_API_KEY"]) {
    const secret = process.env[name]?.trim()
    if (secret) out = out.split(secret).join("[REDACTED]")
  }
  return out.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
}

function assertOfficialTarget(): void {
  // Constants, but guard against a future edit pointing elsewhere
  if (JEV_MODEL !== "jev-1.13.0") throw new Error("Jev model must stay pinned to jev-1.13.0")
  if (!JEV_ENDPOINT.startsWith("https://api.typesafe.ai/") || JEV_ENDPOINT.includes("/chat/completions"))
    throw new Error("Jev calls go to the official TypeSafe decisions endpoint only")
}

/**
 * POST a redacted state and typed questions to Jev. The caller redacts the
 * state first (lib/support-answers.ts `redactJevState`).
 */
export async function jevDecide(
  state: Record<string, unknown>,
  questions: JevQuestions,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<JevDecideResult> {
  const key = typesafeKey()
  if (!key) {
    return {
      ok: false,
      reason: "not_configured",
      error: `${TYPESAFE_ENV_KEY} is not set, so the AI check is not configured.`,
    }
  }
  assertOfficialTarget()

  const fetchImpl = options.fetchImpl ?? fetch
  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetchImpl(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: "network_error", error: scrubSecrets(`TypeSafe network error: ${message}`) }
  }

  if (!response.ok) {
    let body = ""
    try {
      body = (await response.text()).slice(0, ERROR_BODY_MAX)
    } catch {
      // ignore unreadable bodies
    }
    return {
      ok: false,
      reason: "http_error",
      status: response.status,
      error: scrubSecrets(`TypeSafe HTTP ${response.status}${body ? `: ${body}` : ""}`),
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { ok: false, reason: "bad_response", error: "TypeSafe response was not JSON" }
  }
  const raw = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null
  const answers = raw?.answers
  if (!raw || !answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { ok: false, reason: "bad_response", error: "TypeSafe response is missing the answers object" }
  }

  // Round-trip through the scrubber so nothing secret can reach the audit row
  const scrubbed = JSON.parse(scrubSecrets(JSON.stringify(raw))) as Record<string, unknown>
  return {
    ok: true,
    model: JEV_MODEL,
    answers: scrubbed.answers as Record<string, unknown>,
    raw: scrubbed,
    durationMs: Date.now() - startedAt,
  }
}
