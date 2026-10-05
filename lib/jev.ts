// Jev (TypeSafe decisions model) — pinned contract, typed questions, and the
// confidence gate. Pure and client-safe: the HTTP client and the API key live
// in lib/jev.server.ts.
//
// Jev is not a chatbot. Send a small, redacted `state` plus typed questions,
// one judgment per question. Code owns the gate: a mid-band answer is NOT a
// decision and must be shown as "needs a human look", never rounded to yes/no.

/** Pinned exactly. Do not use jev-latest, jev-1.13, or an OpenRouter alias. */
export const JEV_MODEL = "jev-1.13.0" as const

/** Official TypeSafe decisions endpoint (HTTP only, no SDK, no /chat/completions). */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone" as const

/**
 * The team's high-confidence bars (same as the wikibird coffee/fireplace
 * gates). Tune here and nowhere else.
 * - Choice: confidence >= 0.70 AND top option probability >= 0.80
 * - Noul: <= 0.10 is a confident "false", >= 0.90 a confident "true"
 */
export const JEV_CONFIDENCE_GATES = {
  choiceConfidenceMin: 0.7,
  choiceTopProbabilityMin: 0.8,
  noulFalseMax: 0.1,
  noulTrueMin: 0.9,
} as const

export type JevChoiceQuestion = {
  type: "choice"
  instructions: string
  /** option -> what it means; name the confusable neighbours */
  criteria: Record<string, string>
}

export type JevNoulQuestion = {
  type: "noul"
  instructions: string
  criteria: { true: string; false: string }
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion
export type JevQuestions = Record<string, JevQuestion>

export type JevChoiceAnswer = {
  type?: "choice"
  choice?: string
  probabilities?: Record<string, number>
  confidence?: number
}

export type JevNoulAnswer = {
  type?: "noul"
  noul?: number
}

export type GatedChoice =
  | { decided: true; choice: string; confidence: number; topProbability: number }
  | {
      decided: false
      reason: "missing" | "mid_band" | "unexpected_option"
      choice: string | null
      confidence: number | null
      topProbability: number | null
    }

export type GatedNoul =
  | { decided: true; value: boolean; noul: number }
  | { decided: false; reason: "missing" | "mid_band"; noul: number | null }

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * Apply the Choice bar. The chosen option is Jev's `choice` (falling back to
 * the most probable option); it must be one of `allowed` when given.
 */
export function gateChoice(answer: unknown, allowed?: readonly string[]): GatedChoice {
  const a = asObject(answer)
  if (!a) return { decided: false, reason: "missing", choice: null, confidence: null, topProbability: null }

  const probabilities = asObject(a.probabilities) ?? {}
  let top: { option: string; p: number } | null = null
  for (const [option, raw] of Object.entries(probabilities)) {
    const p = finite(raw)
    if (p !== null && (!top || p > top.p)) top = { option, p }
  }
  const choice = typeof a.choice === "string" && a.choice ? a.choice : (top?.option ?? null)
  const confidence = finite(a.confidence)
  const topProbability = top?.p ?? null

  if (!choice || confidence === null || topProbability === null)
    return { decided: false, reason: "missing", choice, confidence, topProbability }
  if (allowed && !allowed.includes(choice))
    return { decided: false, reason: "unexpected_option", choice, confidence, topProbability }
  if (
    confidence >= JEV_CONFIDENCE_GATES.choiceConfidenceMin &&
    topProbability >= JEV_CONFIDENCE_GATES.choiceTopProbabilityMin
  ) {
    return { decided: true, choice, confidence, topProbability }
  }
  return { decided: false, reason: "mid_band", choice, confidence, topProbability }
}

/** Apply the Noul bar: only the extremes are decisions. */
export function gateNoul(answer: unknown): GatedNoul {
  const a = asObject(answer)
  const noul = a ? finite(a.noul) : null
  if (noul === null) return { decided: false, reason: "missing", noul: null }
  if (noul >= JEV_CONFIDENCE_GATES.noulTrueMin) return { decided: true, value: true, noul }
  if (noul <= JEV_CONFIDENCE_GATES.noulFalseMax) return { decided: true, value: false, noul }
  return { decided: false, reason: "mid_band", noul }
}

/** How sure a Noul is of its leaning (0.96 -> 0.96, 0.04 -> 0.96), for display. */
export function noulCertainty(noul: number | null): number | null {
  if (noul === null) return null
  return noul >= 0.5 ? noul : 1 - noul
}
