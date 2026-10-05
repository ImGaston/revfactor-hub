import { describe, expect, it } from "vitest"

import {
  FACTS_CONFLICT_OPTIONS,
  SUPPORT_USED_SUGGESTION_THRESHOLDS,
  buildComparisonJevState,
  buildMergePrompt,
  comparisonQuestions,
  hasSavedTeamAnswer,
  interpretComparison,
  mergeViolations,
  numbersNotIn,
  parseComparisonResults,
  suggestionAdoption,
  suggestionLockStatus,
  usedSuggestionBucket,
  validateSuggestionAdds,
  type SupportAnswerContext,
} from "@/lib/support-answers"

// Blind-first flow (2026-10-05): lock line, comparison gate, "what the
// suggestion adds" guard, merge guards, and the draft-usage metric.

function context(overrides: Partial<SupportAnswerContext["ticket"]> = {}): SupportAnswerContext {
  return {
    ticket: {
      id: "t1",
      ticket_number: 1029,
      category: "pricing",
      request_type: "question",
      status: "open",
      merged_into: null,
      summary: "How is December pacing at Boho Cottage?",
      client_message: "How is December looking? Text me at (555) 201-4477.",
      time_window: "2026-12",
      money_at_stake: false,
      requested_by_name: "Kate Rivers",
      requested_at: "2026-10-01T14:00:00Z",
      property_label: "Boho Cottage",
      ...overrides,
    },
    listings: [],
    adjustments: [],
    promises: [],
    timeline: [],
    knowledge: [],
    knowledgeNote: null,
    changeControlled: false,
  }
}

const choice = (option: string, confidence = 0.85, top = 0.9) => ({ choice: option, probabilities: { [option]: top }, confidence })
const noul = (value: number) => ({ noul: value })

describe("the lock", () => {
  it("unlocks only on a non-empty saved team answer", () => {
    expect(hasSavedTeamAnswer(null)).toBe(false)
    expect(hasSavedTeamAnswer({ first_body: "   " })).toBe(false)
    expect(hasSavedTeamAnswer({ first_body: "Hi Kate!" })).toBe(true)
  })

  it("the lock line says what's waiting, never what it says", () => {
    const base = { blockReason: null, hasDraft: false, pendingGeneration: false, draftsConfigured: true }
    expect(suggestionLockStatus({ ...base, hasDraft: true })).toEqual({
      status: "ready",
      message: "A suggested answer is ready. Save your answer to compare.",
    })
    expect(suggestionLockStatus({ ...base, pendingGeneration: true }).status).toBe("preparing")
    expect(suggestionLockStatus(base).status).toBe("missing")
    expect(suggestionLockStatus({ ...base, draftsConfigured: false }).status).toBe("not_configured")
    expect(
      suggestionLockStatus({ ...base, hasDraft: true, blockReason: "No draft for billing/offboarding — handled by Fede." })
    ).toEqual({ status: "blocked", message: "No draft for billing/offboarding — handled by Fede." })
  })
})

describe("Jev comparison with the suggestion", () => {
  it("asks two typed questions, one judgment each", () => {
    const q = comparisonQuestions()
    expect(Object.keys(q)).toEqual(["suggestion_covers_missing_point", "facts_conflict"])
    expect(q.suggestion_covers_missing_point.type).toBe("noul")
    expect(q.facts_conflict.type).toBe("choice")
    expect(Object.keys(q.facts_conflict.criteria)).toEqual([...FACTS_CONFLICT_OPTIONS])
  })

  it("sends a small redacted state with both answers", () => {
    const state = buildComparisonJevState(context(), "Pacing is 12% ahead. Call 555-201-4477.", "Pacing is [X]% ahead.")
    expect(Object.keys(state).sort()).toEqual(["ask_summary", "client_ask", "suggested_answer", "team_answer", "ticket"])
    expect(JSON.stringify(state)).not.toMatch(/201-4477|Kate|Rivers/)
  })

  it("covered when both rows clear the bar", () => {
    const r = interpretComparison({ suggestion_covers_missing_point: noul(0.04), facts_conflict: choice("agree") })
    expect(r.verdict).toBe("covered")
    expect(r.results.map((x) => x.outcome)).toEqual(["ok", "ok"])
    expect(r.results[0].confidence).toBeCloseTo(0.96)
  })

  it("worth a look when the suggestion covers a missing point or the facts differ", () => {
    expect(interpretComparison({ suggestion_covers_missing_point: noul(0.95), facts_conflict: choice("agree") }).verdict).toBe("review")
    expect(interpretComparison({ suggestion_covers_missing_point: noul(0.02), facts_conflict: choice("conflict") }).verdict).toBe("review")
  })

  it("mid-band and missing answers need a human, never pass", () => {
    expect(interpretComparison({ suggestion_covers_missing_point: noul(0.5), facts_conflict: choice("agree") }).verdict).toBe("needs_human")
    expect(interpretComparison({ suggestion_covers_missing_point: noul(0.03), facts_conflict: choice("agree", 0.6, 0.9) }).verdict).toBe(
      "needs_human"
    )
    expect(interpretComparison({}).verdict).toBe("needs_human")
  })

  it("not_comparable is fine, and results round-trip through storage", () => {
    const r = interpretComparison({ suggestion_covers_missing_point: noul(0.01), facts_conflict: choice("not_comparable") })
    expect(r.verdict).toBe("covered")
    expect(parseComparisonResults(JSON.parse(JSON.stringify(r.results)))).toEqual(r.results)
    expect(parseComparisonResults([{ key: "x", outcome: "ok" }])).toEqual([])
  })
})

describe("what the suggestion adds", () => {
  const suggestion = "Hi Kate! December is pacing [X]% ahead. Weekends are filling faster than weekdays, so we kept weekend rates firm."
  const teamAnswer = "Hi Kate, December is pacing 12% ahead of last year."

  it("keeps only points that quote the suggestion word for word", () => {
    const adds = validateSuggestionAdds(
      [
        { point: "Explains that weekends fill faster.", quote: "Weekends are filling  faster than weekdays" },
        { point: "Promises a refund.", quote: "We will refund the cleaning fee" },
        { point: "Says rates rose 20%.", quote: "we kept weekend rates firm" },
      ],
      { suggestion, teamAnswer }
    )
    expect(adds).toEqual([{ point: "Explains that weekends fill faster.", quote: "Weekends are filling  faster than weekdays" }])
  })

  it("caps the list at three", () => {
    const many = Array.from({ length: 5 }, () => ({ point: "Weekend point.", quote: "kept weekend rates firm" }))
    expect(validateSuggestionAdds(many, { suggestion, teamAnswer })).toHaveLength(3)
  })
})

describe("merge guards", () => {
  const teamAnswer = "Hi Kate! December is pacing 12% ahead. We'll send the comps by Friday."
  const suggestion = "Hi Kate! December is pacing [X]% ahead. Weekends are filling faster, so we kept weekend rates firm."

  it("accepts a merge built only from the two answers", () => {
    const merged =
      "Hi Kate! December is pacing 12% ahead. Weekends are filling faster, so we kept weekend rates firm. We'll send the comps by Friday."
    expect(mergeViolations(merged, { teamAnswer, suggestion, context: { changeControlled: false } })).toEqual([])
  })

  it("rejects invented numbers, new billing wording, credentials, and early live claims", () => {
    const v = (merged: string) => mergeViolations(merged, { teamAnswer, suggestion, context: { changeControlled: false } })
    expect(v("December is pacing 15% ahead.")[0]).toMatch(/numbers neither answer states \(15\)/)
    expect(v("December is pacing 12% ahead. We'll refund the cleaning fee.")[0]).toMatch(/billing or offboarding wording \(refund\)/)
    expect(v("Your door code 4821 works.")[0]).toMatch(/credential/)
    expect(v("December is pacing 12% ahead. Your new rates are now live.")[0]).toMatch(/live/)
    expect(v("December is pacing 12% ahead [confirm it's live].")).toEqual([])
  })

  it("lets a live claim through when the team already made it, or the Adjustment is controlled", () => {
    expect(
      mergeViolations("The new minimum is now live.", {
        teamAnswer: "The new minimum is now live.",
        suggestion,
        context: { changeControlled: false },
      })
    ).toEqual([])
    expect(mergeViolations("The new minimum is now live.", { teamAnswer, suggestion, context: { changeControlled: true } })).toEqual([])
  })

  it("numbers inside [brackets] never count", () => {
    expect(numbersNotIn("Pacing is [about 15]% ahead.", ["Pacing is ahead."])).toEqual([])
    expect(numbersNotIn("Pacing is 15% ahead.", ["Pacing is [about 15]% ahead."])).toEqual(["15"])
  })

  it("the merge prompt keeps the team's answer first, redacts, and has no names beyond the first", () => {
    const prompt = buildMergePrompt(context(), teamAnswer, suggestion, ["it has numbers neither answer states (15)"])
    expect(prompt).toContain('"client_first_name": "Kate"')
    expect(prompt).not.toMatch(/Rivers|201-4477/)
    expect(prompt).toContain("The previous merge broke these rules")
  })
})

describe("used_suggestion (draft usage)", () => {
  const teamFirst = "Hi Kate, December is pacing 12% ahead of last year."
  const suggestion =
    "Hi Kate! December is pacing ahead of last year. Weekends are filling faster than weekdays, so we kept weekend rates firm and opened two-night stays."

  it("documents its thresholds", () => {
    expect(SUPPORT_USED_SUGGESTION_THRESHOLDS).toEqual({ partly: 0.15, mostly: 0.6 })
  })

  it("keep mine = none, use suggested = mostly, a merged sentence = partly", () => {
    const keep = suggestionAdoption({ suggestion, teamFirst, final: teamFirst })
    expect(keep).toBe(0)
    expect(usedSuggestionBucket(keep)).toBe("none")

    const verbatim = suggestionAdoption({ suggestion, teamFirst, final: suggestion })
    expect(verbatim).toBe(1)
    expect(usedSuggestionBucket(verbatim)).toBe("mostly")

    const merged = suggestionAdoption({
      suggestion,
      teamFirst,
      final: `${teamFirst} Weekends are filling faster than weekdays.`,
    })
    expect(merged).toBeGreaterThanOrEqual(0.15)
    expect(merged).toBeLessThan(0.6)
    expect(usedSuggestionBucket(merged)).toBe("partly")
  })

  it("no suggestion, or one that added nothing new, is none", () => {
    expect(suggestionAdoption({ suggestion: null, teamFirst, final: teamFirst })).toBeNull()
    expect(usedSuggestionBucket(null)).toBe("none")
    expect(suggestionAdoption({ suggestion: teamFirst, teamFirst, final: teamFirst })).toBe(0)
  })

  it("ignores [bracketed] gaps and case", () => {
    expect(
      suggestionAdoption({
        suggestion: "WEEKENDS ARE FILLING FASTER [X]%",
        teamFirst: "Hello",
        final: "weekends are filling faster",
      })
    ).toBe(1)
  })
})
