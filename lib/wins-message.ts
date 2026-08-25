// Deterministic message composition for the Wins dashboard.
//
// No model, no generation: given the same evidence this produces the same
// string, byte for byte. That is what makes "the suggested text contains only
// figures present in the evidence" a property a test can actually prove, and
// what lets an already-copied draft be reproduced months later.
//
// Every number in the output is read from WinEvidence. Nothing is derived here
// that was not already derived during detection.

import type { WinCandidate, WinCategory, WinEvidence } from "@/lib/wins"

export const WINS_TEMPLATE_VERSION = "v1"

export type WinTemplateKey = "double_win.v1" | "yoy_steady.v1" | "market_compass.v1"

/** Messages longer than this fall back to the short form. */
export const MESSAGE_MAX_LENGTH = 700

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Whole units only — cents in a performance update are noise, not precision. */
export function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)
}

/** Signed, one decimal. Input is a fraction (0.264), output a percent (+26.4%). */
export function formatPercent(fraction: number): string {
  const pct = fraction * 100
  const sign = pct >= 0 ? "+" : ""
  return `${sign}${pct.toFixed(1)}%`
}

export function formatDays(value: number): string {
  const rounded = Math.round(value)
  return `${rounded} ${rounded === 1 ? "day" : "days"}`
}

/**
 * A client name is only usable if it reads like a person or company name.
 *
 * The upstream data mixes identifiers into name fields — the reference
 * workbook carries listing names like "Cabin Near Lake | MD | Steve Singer" —
 * so anything carrying separators, digits or legal suffixes is rejected in
 * favour of a neutral greeting. Getting a client's name wrong in the first
 * three words costs more than not using it at all.
 */
export function resolveGreetingName(clientName: string | null | undefined): string | null {
  if (!clientName) return null
  const raw = clientName.trim()
  if (raw.length < 2 || raw.length > 40) return null
  if (/[|<>@#_/\\]/.test(raw)) return null
  if (/[·•]/.test(raw)) return null
  if (/\d/.test(raw)) return null
  if (/\b(llc|inc|ltd|corp|gmbh|sa|bv)\b/i.test(raw)) return null
  const first = raw.split(/\s+/)[0]
  if (!first || first.length < 2) return null
  if (!/^[\p{L}'-]+$/u.test(first)) return null
  return first
}

/**
 * Strip anything that could turn a name into markup or break a chat client.
 * The output is plain text and is never rendered as HTML, so this is
 * normalisation rather than escaping.
 */
export function sanitizeText(value: string): string {
  return value
    .replace(/[<>]/g, "")
    .replace(/&(?:[a-z]+|#\d+);/gi, " ")
    // Control chars and zero-width joiners break chat clients silently.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * The client-facing half of a listing name.
 *
 * Hub listing names are internal labels that routinely append the state and
 * the owner: "Austin House | TX | Michelle", "The Lansing Haus | Jonathan Lam
 * | MI". 152 of 249 active listings carry a pipe today, so without this the
 * majority of generated messages would ship internal metadata — including
 * another person's name — to the client. The same applies to the PriceLabs
 * naming conventions that use "·" and "--" as separators.
 *
 * The public name is whatever precedes the first separator; the internal name
 * is kept everywhere in the UI, where the extra context is useful.
 */
export function publicListingName(name: string): string {
  const clean = sanitizeText(name)
  const cut = clean.split(/\s*(?:\||·|•|--)\s*/)[0]?.trim()
  // Only accept the split when it leaves something recognisable behind.
  return cut && cut.length >= 3 ? cut : clean
}

/** Listing names run long; clip on a word boundary rather than mid-word. */
export function shortenListingName(name: string, max = 60): string {
  const clean = publicListingName(name)
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export function templateKeyForCategory(category: WinCategory): WinTemplateKey | null {
  switch (category) {
    case "double_win":
      return "double_win.v1"
    case "yoy_positive_steady":
      return "yoy_steady.v1"
    case "market_compass_candidate":
      return "market_compass.v1"
    default:
      return null
  }
}

export type ComposedMessage = {
  templateKey: WinTemplateKey
  templateVersion: string
  body: string
}

/**
 * The YoY clause degrades rather than lying: with no usable percentage it
 * states the absolute change only. `pct_suppressed_reason` is set during
 * detection precisely so this decision is not re-litigated here.
 */
function yoyClause(evidence: WinEvidence): string {
  const { yoy, currency } = evidence
  const abs = formatCurrency(Math.abs(yoy.delta_abs), currency)
  const direction = yoy.delta_abs >= 0 ? "up" : "down"
  if (yoy.pct == null || yoy.pct_suppressed_reason === "extreme") {
    return `${direction} ${abs}`
  }
  return `${direction} ${abs} (${formatPercent(yoy.pct)})`
}

function pickupClause(evidence: WinEvidence, steady: boolean): string {
  const { pickup, currency } = evidence
  const w3 = formatCurrency(pickup.w3, currency)
  const w2 = formatCurrency(pickup.w2, currency)
  if (pickup.trend === "up_from_zero") {
    // No prior-window base, so there is no ratio to quote — only the level.
    return `Recent booking pace also picked up, with ${w3} booked in the latest 31-day window.`
  }
  const verb = steady ? "held steady" : "also strengthened"
  return `Recent booking pace ${verb} — ${w3} booked in the latest 31-day window versus ${w2} in the prior one.`
}

function occGapClause(evidence: WinEvidence): string | null {
  const gap = evidence.occupancy.gap_pp
  if (gap == null) return null
  const rounded = Math.round(Math.abs(gap) * 10) / 10
  if (rounded < 0.1) return "occupancy in line with the market"
  return `occupancy ${rounded} points ${gap > 0 ? "above" : "below"} the market`
}

/**
 * Build the suggested message for one candidate.
 *
 * Returns null when the category has no template — conflicting signals and
 * insufficient data must not produce a client-facing draft at all.
 */
export function buildWinMessage(candidate: {
  category: WinCategory
  listing_name_snapshot: string
  client_name_snapshot: string | null
  evidence: WinEvidence
}): ComposedMessage | null {
  const templateKey = templateKeyForCategory(candidate.category)
  if (!templateKey) return null

  const evidence = candidate.evidence
  const listing = shortenListingName(candidate.listing_name_snapshot)
  const greetName = resolveGreetingName(candidate.client_name_snapshot)
  const greeting = greetName ? `Hi ${greetName},` : "Hi there,"
  const period = evidence.period.label

  let body: string

  if (templateKey === "market_compass.v1") {
    const idx = evidence.market.revpar_index
    const occ = occGapClause(evidence)
    body = [
      `${greeting} quick performance update on ${listing}.`,
      idx != null
        ? `It is currently running at a RevPAR Index of ${Math.round(idx)} versus its comp set${occ ? `, with ${occ}` : ""}.`
        : null,
      // Said plainly: this listing has no prior year, so market context is the
      // only honest yardstick and the message must say so out loud.
      "Since the property does not yet have a comparable prior-year period, we are using current market performance as context rather than a year-over-year comparison.",
      "We will keep monitoring pacing and market conditions.",
    ]
      .filter(Boolean)
      .join(" ")
  } else {
    const steady = templateKey === "yoy_steady.v1"
    const revenue = formatCurrency(evidence.yoy.revenue_ty, evidence.currency)
    body = [
      `${greeting} quick performance update:`,
      `${listing} is at ${revenue} in rental revenue for ${period}, ${yoyClause(evidence)} versus the comparable period last year.`,
      pickupClause(evidence, steady),
      "Good momentum — we will keep monitoring pacing and market conditions.",
    ].join(" ")

    if (body.length > MESSAGE_MAX_LENGTH) {
      body = [
        `${greeting} quick performance update:`,
        `${listing} is at ${revenue} for ${period}, ${yoyClause(evidence)} versus the comparable period last year.`,
        "We will keep monitoring pacing.",
      ].join(" ")
    }
  }

  return {
    templateKey,
    templateVersion: WINS_TEMPLATE_VERSION,
    body: sanitizeText(body),
  }
}

export function buildWinMessageForCandidate(candidate: WinCandidate): ComposedMessage | null {
  return buildWinMessage(candidate)
}

/**
 * Every numeric token in `body`, normalised for comparison against evidence.
 * Used by the test that enforces "only figures present in the evidence" — the
 * property is worth encoding here so the rule travels with the templates.
 */
export function extractNumbers(body: string): number[] {
  const matches = body.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []
  return matches.map((m) => Number(m.replace(/,/g, ""))).filter((n) => Number.isFinite(n))
}

/** Phrases that would claim credit or promise a result we cannot guarantee. */
export const FORBIDDEN_PHRASES = [
  "because",
  "thanks to",
  "driven by",
  "we generated",
  "we drove",
  "guarantee",
  "guaranteed",
  "will increase",
  "will grow",
  "expect to",
] as const

export function findForbiddenPhrases(body: string): string[] {
  const lower = body.toLowerCase()
  return FORBIDDEN_PHRASES.filter((p) => lower.includes(p))
}
