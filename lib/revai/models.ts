// Client-safe RevAI model catalog and the rules-based router that picks a
// tier per question. Routing is deterministic code (no extra model call), so
// it is free, instant, and testable. Prices are AI Gateway list prices in USD
// per million tokens as of 2026-10-16.

export const REVAI_TIERS = ["quick", "standard", "deep"] as const
export type RevAiTier = (typeof REVAI_TIERS)[number]
export type RevAiTierChoice = RevAiTier | "auto"

export type RevAiModel = {
  tier: RevAiTier
  /** AI Gateway model id. */
  id: string
  /** Tried in order by the gateway if the primary provider fails. */
  fallbacks: string[]
  label: string
  purpose: string
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  maxSteps: number
  maxOutputTokens: number
  reasoning: "none" | "low" | "medium"
}

export const REVAI_MODELS: Record<RevAiTier, RevAiModel> = {
  quick: {
    tier: "quick",
    id: "anthropic/claude-haiku-5.5",
    fallbacks: ["openai/gpt-5-mini"],
    label: "Haiku 5.5",
    purpose: "Lookups, definitions, where-is-it and status questions",
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.5,
    maxSteps: 6,
    maxOutputTokens: 1_500,
    reasoning: "none",
  },
  standard: {
    tier: "standard",
    id: "anthropic/claude-sonnet-5.5",
    fallbacks: ["anthropic/claude-sonnet-5"],
    label: "Sonnet 5.5",
    purpose: "Client and listing questions that combine data with frameworks",
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 10,
    maxSteps: 10,
    maxOutputTokens: 3_000,
    reasoning: "low",
  },
  deep: {
    tier: "deep",
    id: "anthropic/claude-opus-5.5",
    fallbacks: ["anthropic/claude-opus-5"],
    label: "Opus 5.5",
    purpose: "Diagnosis, strategy, plans, and drafting frameworks",
    inputUsdPerMillion: 4,
    outputUsdPerMillion: 20,
    maxSteps: 14,
    maxOutputTokens: 6_000,
    reasoning: "medium",
  },
}

/** Attached to each assistant message so the UI can show which model answered. */
export type RevAiMessageMetadata = {
  tier?: RevAiTier
  model?: string
  modelLabel?: string
  reason?: string
  forced?: boolean
  costUsd?: number
}

export type RevAiRoute = {
  tier: RevAiTier
  reason: string
  /** True when the person picked the tier instead of Auto. */
  forced: boolean
}

const DEEP_PATTERNS: Array<[RegExp, string]> = [
  [/\bwhy\b.*\b(down|drop|dropp|declin|lower|worse|underperform|behind|slow)/, "diagnosing a drop"],
  [/\b(revenue|revpar|occupancy|bookings?|pace|pacing)\b.*\b(down|drop|declin|behind|worse)\b/, "diagnosing performance"],
  [/\b(churn|cancel(l)?ing|retention|renewal|unhappy|angry|upset|complain|escalat)/, "retention or escalation risk"],
  [/\b(strategy|strategic|plan|roadmap|framework|playbook|ontology|design|architect|rethink|overhaul)\b/, "strategy or framework work"],
  [/\b(should we|what would you|recommend|trade.?offs?|pros and cons|compare|versus|vs\.?)\b/, "a judgment call"],
  [/\b(scale|1,?000|grow(th)?|hire|headcount|pricing model|fee structure)\b/, "business planning"],
  [/\b(write|draft|rewrite)\b.*\b(playbook|framework|policy|sop|proposal|spec)\b/, "drafting a framework"],
]

const QUICK_PATTERNS: Array<[RegExp, string]> = [
  [/^(what|who|where|when|which)\s+(is|are|was|does|do)\b/, "a direct lookup"],
  [/\b(define|definition|meaning|stand for|abbreviation)\b/, "a definition"],
  [/\b(how many|count|list|link|url|id|ids|email|phone|status of)\b/, "a count or lookup"],
  [/^(hi|hey|hello|thanks|thank you|ok|okay)\b/, "small talk"],
]

const STANDARD_SIGNALS: Array<[RegExp, string]> = [
  [/\b(client|owner|listing|property|portfolio|market)\b/, "client or listing context"],
  [/\b(price|pricing|base price|min(imum)? (price|stay)|adr|revpar|occupancy|pace|pricelabs)\b/, "pricing data"],
  [/\b(adjustment|ticket|support|onboarding|task|review)\b/, "Hub records"],
  [/\b(reply|respond|message|email|explain to)\b/, "a client-facing draft"],
]

/**
 * Pick a tier for the latest question. Strong judgment signals go to deep;
 * short lookups go to quick; anything touching clients, listings, or pricing
 * data goes to standard. Long or multi-part questions step up one tier, and a
 * conversation that is already deep stays at least standard.
 */
export function routeRevAiQuestion(
  question: string,
  options: { choice?: RevAiTierChoice; previousTier?: RevAiTier | null } = {}
): RevAiRoute {
  if (options.choice && options.choice !== "auto") {
    return { tier: options.choice, reason: "Picked manually", forced: true }
  }

  const text = question.toLowerCase().replace(/\s+/g, " ").trim()
  const words = text ? text.split(" ").length : 0
  const questionMarks = (text.match(/\?/g) ?? []).length

  const deep = DEEP_PATTERNS.find(([pattern]) => pattern.test(text))
  if (deep) return { tier: "deep", reason: `Looks like ${deep[1]}`, forced: false }

  if (words > 90 || questionMarks >= 3) {
    return { tier: "deep", reason: "Long, multi-part question", forced: false }
  }

  const standard = STANDARD_SIGNALS.find(([pattern]) => pattern.test(text))
  const quick = QUICK_PATTERNS.find(([pattern]) => pattern.test(text))

  if (quick && (!standard || words <= 12)) {
    const tier: RevAiTier = options.previousTier === "deep" ? "standard" : "quick"
    return {
      tier,
      reason: tier === "quick" ? `Looks like ${quick[1]}` : "Follow-up in a deep conversation",
      forced: false,
    }
  }

  if (standard || words > 25) {
    return {
      tier: "standard",
      reason: standard ? `Needs ${standard[1]}` : "Detailed question",
      forced: false,
    }
  }

  if (options.previousTier === "deep") {
    return { tier: "standard", reason: "Follow-up in a deep conversation", forced: false }
  }
  return { tier: "quick", reason: "Short question", forced: false }
}

export function estimateRevAiCostUsd(
  tier: RevAiTier,
  usage: { inputTokens?: number | null; outputTokens?: number | null }
): number {
  const model = REVAI_MODELS[tier]
  return (
    ((usage.inputTokens ?? 0) * model.inputUsdPerMillion +
      (usage.outputTokens ?? 0) * model.outputUsdPerMillion) /
    1_000_000
  )
}
