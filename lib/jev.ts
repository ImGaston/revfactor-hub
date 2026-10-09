// Jev (TypeSafe decisions model) — transports, typed questions, response
// normalization, and the confidence gate. Pure and client-safe: credentials
// and HTTP live in lib/jev.server.ts.
//
// Jev is not a chatbot. Send a small, redacted `state` plus typed questions,
// one judgment per question. Code owns the gate: a mid-band or missing answer
// is NOT a decision and shows as "Needs a human look", never as a pass.
//
// Transports:
// - primary: Vercel AI Gateway `POST /v1/evaluate`, model `typesafe-ai/jev`.
//   The gateway lists no version-pinned id, so every check records the model
//   id plus any version the response reports; thresholds may need retuning
//   if the gateway's model changes.
// - optional fallback: TypeSafe directly (`/v1/systemone`), pinned `jev-1.13.0`,
//   only when TYPESAFE_API_KEY is set.

/** AI Gateway evaluation model (no version pin is available there). */
export const JEV_GATEWAY_MODEL = "typesafe-ai/jev" as const
export const JEV_GATEWAY_ENDPOINT = "https://ai-gateway.vercel.sh/v1/evaluate" as const

/** Direct TypeSafe fallback, pinned exactly. Never jev-latest, never OpenRouter. */
export const JEV_MODEL = "jev-1.13.0" as const
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone" as const

export type JevTransport = "gateway" | "typesafe"

/**
 * The team's high-confidence bars (same as the wikibird coffee/fireplace
 * gates). Tune here and nowhere else.
 * - Choice: confidence >= 0.70 AND top option probability >= 0.80. When the
 *   response has no separate confidence, the top probability stands in for it.
 * - Boolean (noul): <= 0.10 is a confident "false", >= 0.90 a confident "true".
 */
export const JEV_CONFIDENCE_GATES = {
  choiceConfidenceMin: 0.7,
  choiceTopProbabilityMin: 0.8,
  noulFalseMax: 0.1,
  noulTrueMin: 0.9,
} as const

/** Our question types. `noul` maps to the gateway's `boolean`. */
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

/**
 * Gateway question shapes (AI Gateway decisions, as documented 2026-10-07):
 * `boolean` (probability 0–1) with optional true/false `criteria`, and
 * `choice` whose `criteria` maps each option to its meaning. The gateway
 * rejects a choice without `criteria` (the older `options` list is gone).
 */
export type JevGatewayQuestion =
  | { type: "boolean"; instructions: string; criteria: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }

/** Our questions → the gateway's: `noul` becomes `boolean`; criteria pass through as they are. */
export function toGatewayQuestions(questions: JevQuestions): Record<string, JevGatewayQuestion> {
  return Object.fromEntries(
    Object.entries(questions).map(([key, q]) => [
      key,
      q.type === "noul"
        ? { type: "boolean", instructions: q.instructions, criteria: { true: q.criteria.true, false: q.criteria.false } }
        : { type: "choice", instructions: q.instructions, criteria: { ...q.criteria } },
    ])
  )
}

/** Normalized answers the gates read. */
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

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function firstString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

function probabilityMap(o: Record<string, unknown>): Record<string, number> | null {
  for (const key of ["probabilities", "distribution", "scores"]) {
    const value = o[key]
    const map = asObject(value)
    if (map) {
      const out: Record<string, number> = {}
      for (const [option, raw] of Object.entries(map)) {
        const p = finite(raw)
        if (p !== null) out[option] = p
      }
      if (Object.keys(out).length) return out
    }
    if (Array.isArray(value)) {
      const out: Record<string, number> = {}
      for (const item of value) {
        const row = asObject(item)
        if (!row) continue
        const option = firstString(row, ["option", "label", "value", "choice", "name"])
        const p = finite(row.probability ?? row.p ?? row.score)
        if (option && p !== null) out[option] = p
      }
      if (Object.keys(out).length) return out
    }
  }
  return null
}

/**
 * One raw answer (gateway or direct TypeSafe shape) → the normalized shape.
 * Anything unrecognizable comes back empty, which the gates read as
 * "missing" (needs a human), never as a pass.
 */
export function normalizeJevAnswer(raw: unknown, type: JevQuestion["type"]): JevChoiceAnswer | JevNoulAnswer {
  if (type === "noul") {
    if (typeof raw === "number") return finite(raw) === null ? {} : { noul: raw }
    const o = asObject(raw)
    if (!o) return {}
    const p = finite(o.noul ?? o.probability ?? o.p ?? (typeof o.value === "number" ? o.value : undefined))
    return p === null ? {} : { noul: p }
  }
  const o = asObject(raw)
  if (!o) return {}
  const choice = firstString(o, ["choice", "option", "label", "answer", "value"])
  let probabilities = probabilityMap(o)
  const single = finite(o.probability)
  if (!probabilities && choice && single !== null) probabilities = { [choice]: single }
  const confidence = finite(o.confidence)
  return {
    ...(choice ? { choice } : {}),
    ...(probabilities ? { probabilities } : {}),
    ...(confidence !== null ? { confidence } : {}),
  }
}

/** Normalize every answer we asked for; unknown keys are dropped. */
export function normalizeJevAnswers(answers: Record<string, unknown>, questions: JevQuestions): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(questions).map(([key, q]) => [key, normalizeJevAnswer(answers[key], q.type)])
  )
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

/**
 * Apply the Choice bar. The chosen option is Jev's `choice` (falling back to
 * the most probable option); it must be one of `allowed` when given. With no
 * separate confidence, the top probability stands in for it.
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
  const topProbability = top?.p ?? null
  const confidence = finite(a.confidence) ?? topProbability

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

/** Apply the boolean (noul) bar: only the extremes are decisions. */
export function gateNoul(answer: unknown): GatedNoul {
  const a = asObject(answer)
  const noul = a ? finite(a.noul ?? a.probability) : null
  if (noul === null || noul < 0 || noul > 1) return { decided: false, reason: "missing", noul: null }
  if (noul >= JEV_CONFIDENCE_GATES.noulTrueMin) return { decided: true, value: true, noul }
  if (noul <= JEV_CONFIDENCE_GATES.noulFalseMax) return { decided: true, value: false, noul }
  return { decided: false, reason: "mid_band", noul }
}

/** How sure a boolean is of its leaning (0.96 -> 0.96, 0.04 -> 0.96), for display. */
export function noulCertainty(noul: number | null): number | null {
  if (noul === null) return null
  return noul >= 0.5 ? noul : 1 - noul
}

/** The version the response reports, if any (gateway ids are unpinned). */
export function jevResponseModelVersion(raw: Record<string, unknown>): string | null {
  for (const key of ["model_version", "modelVersion", "version", "model"]) {
    const v = raw[key]
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 100)
  }
  return null
}
