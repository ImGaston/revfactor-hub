import { describe, expect, it } from "vitest"

import { ANSWERS_ASK_OPTIONS, KNOWLEDGE_OPTIONS, answerCheckQuestions, answersAskQuestion, buildDraftContextPayload, buildDraftSources, buildHubSuggestedReply, buildJevState, claimsChangeIsLive, draftConfidenceQuestions, hubDraftBlockReason, hubDraftViolations, interpretAnswerCheck, interpretDraftConfidence, knowledgePassagesFromSources, linkedChangeControlled, markCitedSources, overallAnswerVerdict, parseAnswerCheckResults, parseDraftConfidence, prepareSupportAnswer, SUPPORT_HUB_DRAFT_PROMPT_VERSION, SUPPORT_HUB_DRAFT_SKILL, type SupportAnswerContext } from "@/lib/support-answers"
import { detectCredential, redactSupportText, suggestedReplySource, type SupportSuggestedReply } from "@/lib/support-tickets"

function context(overrides: Partial<SupportAnswerContext> = {}, ticket: Partial<SupportAnswerContext["ticket"]> = {}): SupportAnswerContext {
  return {
    ticket: {
      id: "6f1c2a64-1d7e-4f43-9a5e-0d1f4c8b9e21",
      ticket_number: 1029,
      category: "pricing",
      request_type: "question",
      status: "open",
      merged_into: null,
      summary: "How is December pacing at Boho Cottage?",
      client_message: "Hi! How is December looking at Boho Cottage? Call me at (555) 201-4477 or kate@example.com",
      time_window: "2026-12",
      money_at_stake: false,
      requested_by_name: "Kate Rivers",
      requested_at: "2026-10-01T14:00:00Z",
      property_label: "Boho Cottage",
      ...ticket,
    },
    listings: [],
    adjustments: [],
    promises: [],
    timeline: [],
    knowledge: [
      {
        id: "kb:a1",
        articleId: "a1",
        title: "How we read pacing",
        slug: "how-we-read-pacing",
        passage: "Pacing compares on-the-books revenue with the same lead time last year.",
      },
    ],
    knowledgeNote: null,
    changeControlled: false,
    ...overrides,
  }
}

const choice = (option: string, confidence = 0.85, top = 0.9) => ({
  type: "choice",
  choice: option,
  probabilities: { [option]: top },
  confidence,
})
const noul = (value: number) => ({ type: "noul", noul: value })

const ALL_CLEAR = {
  answers_ask: choice("fully"),
  unfilled_placeholder: noul(0.03),
  conflicts_with_knowledge: choice("consistent"),
  promise_without_date: noul(0.04),
  claims_change_live: noul(0.02),
}

describe("when the Hub drafts", () => {
  const base = { category: "pricing" as const, request_type: "question" as const, status: "open" as const, merged_into: null }

  it("never drafts billing or offboarding", () => {
    for (const category of ["billing", "offboarding"] as const) {
      expect(hubDraftBlockReason({ ...base, category })).toBe("No draft for billing/offboarding — handled by Fede.")
    }
  })

  it("skips check-ins and closed or merged tickets", () => {
    expect(hubDraftBlockReason({ ...base, request_type: "check_in" })).toMatch(/check-ins/)
    expect(hubDraftBlockReason({ ...base, status: "resolved" })).toMatch(/open tickets/)
    expect(hubDraftBlockReason({ ...base, status: "dismissed" })).toMatch(/open tickets/)
    expect(hubDraftBlockReason({ ...base, merged_into: "x" })).toMatch(/open tickets/)
  })

  it("drafts every other open ask, triage included", () => {
    expect(hubDraftBlockReason(base)).toBeNull()
    expect(hubDraftBlockReason({ ...base, status: "new", category: "performance", request_type: "decision" })).toBeNull()
  })

  it("treats a change as live only when every linked Adjustment is closed and one is controlled", () => {
    expect(linkedChangeControlled([])).toBe(false)
    expect(linkedChangeControlled([{ status: "controlled" }])).toBe(true)
    expect(linkedChangeControlled([{ status: "controlled" }, { status: "rejected" }])).toBe(true)
    expect(linkedChangeControlled([{ status: "controlled" }, { status: "resolved" }])).toBe(false)
    expect(linkedChangeControlled([{ status: "rejected" }])).toBe(false)
  })
})

describe("redaction before anything leaves the Hub", () => {
  it("replaces credentials, codes, tokens, and card numbers", () => {
    const text = [
      "password: hunter22",
      "door code 4821",
      "VRBO verification code is 739201",
      "key sk_live_abcdefghijklmnop",
      "rvf_live_0123456789abcdef0123",
      "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop",
      "card 4242 4242 4242 4242",
    ].join("\n")
    const out = redactSupportText(text)
    expect(out).not.toMatch(/hunter22|4821|739201|sk_live_|rvf_live_|eyJ|4242 4242/)
    expect(out.match(/\[redacted: credential\]/g)?.length).toBeGreaterThanOrEqual(7)
    expect(detectCredential(out)).toBeNull()
  })

  it("masks emails and phones and strips URL query strings", () => {
    const out = redactSupportText(
      "Reach kate@example.com or (555) 201-4477. Listing https://www.airbnb.com/rooms/123456?check_in=2026-12-01&adults=2#x"
    )
    expect(out).toContain("k***@example.com")
    expect(out).toContain("***-***-4477")
    expect(out).toContain("https://www.airbnb.com/rooms/123456")
    expect(out).not.toContain("check_in")
  })

  it("keeps ordinary text and existing redaction markers", () => {
    expect(redactSupportText("December is pacing [X]% ahead. [redacted: credential]")).toBe(
      "December is pacing [X]% ahead. [redacted: credential]"
    )
    expect(redactSupportText(null)).toBe("")
  })
})

describe("Jev state", () => {
  it("is small, redacted, and carries no names", () => {
    const state = buildJevState(context(), "We'll send the numbers. Email me at fede@revfactor.io, pin: 98765")
    const json = JSON.stringify(state)
    expect(json).not.toMatch(/kate@example\.com|201-4477|\(555\)|fede@revfactor\.io|98765|Kate|Rivers/)
    expect(state).toMatchObject({
      ticket: { category: "Pricing", request_type: "Question", period: "2026-12", property: "Boho Cottage" },
      hub: { change_controlled: false, linked_adjustments: [] },
      knowledge: [{ title: "How we read pacing" }],
    })
    expect(Object.keys(state).sort()).toEqual(["ask_summary", "client_ask", "hub", "knowledge", "reply", "ticket"])
  })

  it("uses the planned outreach as the ask for check-ins", () => {
    const state = buildJevState(context({}, { request_type: "check_in", client_message: null, summary: "Check in on December" }), "Hi!")
    expect(state.client_ask).toBe("Planned outreach (we start it): Check in on December")
  })
})

describe("Jev questions", () => {
  it("asks five typed questions, one judgment each", () => {
    const questions = answerCheckQuestions(true)
    expect(Object.keys(questions)).toEqual([
      "answers_ask",
      "unfilled_placeholder",
      "conflicts_with_knowledge",
      "promise_without_date",
      "claims_change_live",
    ])
    expect(questions.answers_ask.type).toBe("choice")
    expect(Object.keys(questions.answers_ask.criteria)).toEqual([...ANSWERS_ASK_OPTIONS])
    expect(Object.keys(questions.conflicts_with_knowledge.criteria)).toEqual([...KNOWLEDGE_OPTIONS])
    for (const key of ["unfilled_placeholder", "promise_without_date", "claims_change_live"]) {
      expect(questions[key].type).toBe("noul")
      expect(Object.keys(questions[key].criteria)).toEqual(["true", "false"])
    }
    expect(questions.answers_ask.instructions).toMatch(/client's ask/)
    expect(questions.answers_ask.instructions).toMatch(/never against any earlier draft/)
  })

  it("drops the knowledge question when nothing matched", () => {
    expect(Object.keys(answerCheckQuestions(false))).not.toContain("conflicts_with_knowledge")
  })

  it("uses a smaller set for the draft badge, aware of [brackets]", () => {
    expect(Object.keys(draftConfidenceQuestions(true))).toEqual(["answers_ask", "conflicts_with_knowledge", "claims_change_live"])
    expect(answersAskQuestion("draft").instructions).toMatch(/bracketed/)
    expect(answersAskQuestion("answer").instructions).not.toMatch(/bracketed/)
  })
})

describe("interpretAnswerCheck", () => {
  const input = { reply: "December is pacing 12% ahead of last year at Boho Cottage.", changeControlled: false, hasKnowledge: true }

  it("passes when every check clears the bar", () => {
    const { verdict, results } = interpretAnswerCheck(ALL_CLEAR, input)
    expect(verdict).toBe("pass")
    expect(results.map((r) => r.outcome)).toEqual(["ok", "ok", "ok", "ok", "ok"])
    expect(results[0]).toMatchObject({ key: "answers_ask", confidence: 0.85, source: "jev" })
  })

  it("a confident partial answer is something to fix", () => {
    const { verdict, results } = interpretAnswerCheck({ ...ALL_CLEAR, answers_ask: choice("partly") }, input)
    expect(verdict).toBe("fix")
    expect(results[0]).toMatchObject({ outcome: "problem", detail: "Only partly answers the ask." })
  })

  it("mid-band answers are never decisions", () => {
    const { verdict, results } = interpretAnswerCheck({ ...ALL_CLEAR, answers_ask: choice("fully", 0.6, 0.95), promise_without_date: noul(0.5) }, input)
    expect(verdict).toBe("needs_human")
    expect(results[0].outcome).toBe("unsure")
    expect(results[3].outcome).toBe("unsure")
  })

  it("a problem outranks an unsure", () => {
    expect(overallAnswerVerdict([{ outcome: "unsure" }, { outcome: "problem" }, { outcome: "ok" }])).toBe("fix")
    expect(overallAnswerVerdict([{ outcome: "skipped" }, { outcome: "ok" }])).toBe("pass")
  })

  it("brackets in the answer fail by rule, whatever Jev says", () => {
    const { results, verdict } = interpretAnswerCheck(ALL_CLEAR, { ...input, reply: "December is pacing [X]% ahead by [date]." })
    expect(verdict).toBe("fix")
    expect(results[1]).toMatchObject({ key: "unfilled_placeholder", outcome: "problem", source: "rule", confidence: 1 })
    expect(results[1].detail).toContain("[X]")
  })

  it("a live claim is a problem until the Hub shows the Adjustment controlled", () => {
    const claim = { ...ALL_CLEAR, claims_change_live: noul(0.97) }
    expect(interpretAnswerCheck(claim, input).results[4]).toMatchObject({ outcome: "problem" })
    expect(interpretAnswerCheck(claim, { ...input, changeControlled: true }).results[4]).toMatchObject({
      outcome: "ok",
      source: "hub",
    })
  })

  it("skips the knowledge check when no approved knowledge matched", () => {
    const { results, verdict } = interpretAnswerCheck(ALL_CLEAR, { ...input, hasKnowledge: false })
    expect(results[2]).toMatchObject({ outcome: "skipped" })
    expect(verdict).toBe("pass")
  })

  it("flags contradictions with knowledge and missing answers", () => {
    expect(interpretAnswerCheck({ ...ALL_CLEAR, conflicts_with_knowledge: choice("conflicts") }, input).verdict).toBe("fix")
    expect(interpretAnswerCheck({}, input).verdict).toBe("needs_human")
  })

  it("round-trips through storage and drops malformed rows", () => {
    const { results } = interpretAnswerCheck(ALL_CLEAR, input)
    expect(parseAnswerCheckResults(JSON.parse(JSON.stringify(results)))).toEqual(results)
    expect(parseAnswerCheckResults([{ key: "nope", outcome: "ok" }, null, "x"])).toEqual([])
    expect(parseAnswerCheckResults("bad")).toEqual([])
  })
})

describe("interpretDraftConfidence", () => {
  const input = { changeControlled: false, hasKnowledge: true, model: "jev-1.13.0" }

  it("grades the draft high, medium, low, or needs a human", () => {
    expect(interpretDraftConfidence(ALL_CLEAR, input)).toMatchObject({ status: "scored", level: "high", score: 0.85 })
    expect(interpretDraftConfidence({ ...ALL_CLEAR, answers_ask: choice("partly") }, input).level).toBe("medium")
    expect(interpretDraftConfidence({ ...ALL_CLEAR, answers_ask: choice("no") }, input).level).toBe("low")
    expect(interpretDraftConfidence({ ...ALL_CLEAR, claims_change_live: noul(0.95) }, input).level).toBe("low")
    expect(interpretDraftConfidence({ ...ALL_CLEAR, answers_ask: choice("fully", 0.5, 0.6) }, input).level).toBe("needs_human")
  })

  it("parses stored confidence, including the not-configured state", () => {
    const scored = interpretDraftConfidence(ALL_CLEAR, input)
    expect(parseDraftConfidence(JSON.parse(JSON.stringify(scored)))).toEqual(scored)
    expect(parseDraftConfidence({ status: "not_configured" })).toEqual({ status: "not_configured" })
    expect(parseDraftConfidence({})).toBeNull()
  })
})

describe("draft guardrails", () => {
  it("rejects credentials in a draft", () => {
    expect(hubDraftViolations("Your door code 4821 works.", context())).toEqual([
      "it contains a credential (access code)",
    ])
  })

  it("never lets a change sound live before it's controlled", () => {
    const change = context({ adjustments: [{ type: "Min stay", status: "In progress", target_value: "2 nights", controlled_at: null, listing_name: "Boho Cottage" }] }, { request_type: "change" })
    expect(hubDraftViolations("Done! Your minimum stay is now live at 2 nights.", change)).toHaveLength(1)
    expect(hubDraftViolations("We've lowered the minimum stay.", change)).toHaveLength(1)
    expect(hubDraftViolations("We'll set the minimum stay to 2 nights [confirm it's live].", change)).toEqual([])
    expect(hubDraftViolations("Your minimum stay is now live.", { ...change, changeControlled: true })).toEqual([])
  })

  it("only applies the live rule where a change is in play", () => {
    expect(claimsChangeIsLive("PriceLabs has been updated daily for years.")).toBe(true)
    expect(hubDraftViolations("PriceLabs has been updated daily for years.", context())).toEqual([])
  })

  it("stores Hub drafts labeled, masked, and with the cited basis", () => {
    const ctx = context()
    const sources = markCitedSources(buildDraftSources(ctx), ["kb:a1", "not-a-source"])
    const reply = buildHubSuggestedReply({
      text: " Hi Kate! Email me at fede@revfactor.io. ",
      sources,
      generationId: "gen-1",
      generatedAt: new Date("2026-10-04T15:00:00Z"),
    })
    expect(reply).toEqual({
      text: "Hi Kate! Email me at f***@revfactor.io.",
      basis: ["Knowledge: How we read pacing"],
      skill: SUPPORT_HUB_DRAFT_SKILL,
      prompt_version: SUPPORT_HUB_DRAFT_PROMPT_VERSION,
      generated_at: "2026-10-04T15:00:00.000Z",
      source: "hub",
      generation_id: "gen-1",
    })
    expect(suggestedReplySource(reply)).toBe("hub")
    const botDraft: SupportSuggestedReply = { text: "bot", basis: [], skill: null, prompt_version: null, generated_at: "x" }
    expect(suggestedReplySource(botDraft)).toBe("bot")
    expect(suggestedReplySource(null)).toBeNull()
  })

  it("lists every source given to the draft, with links", () => {
    const ctx = context({
      listings: [
        {
          id: "l1", name: "Boho Cottage", city: "Austin", state: "TX", status: "active", base_price: 180, min_price: 120,
          max_price: 400, recommended_base_price: 175, occupancy_next_7: 60, market_occupancy_next_7: 55,
          occupancy_next_30: 48, market_occupancy_next_30: 50, weekend_occupancy_next_30: 70,
          market_weekend_occupancy_next_30: 66, mpi_next_30: 0.96, last_booked_date: "2026-10-02", synced_at: "2026-10-03T08:00:00Z",
        },
      ],
      promises: [{ description: "Send December pacing", due_at: "2026-10-05T22:00:00Z", status: "open" }],
    })
    const sources = buildDraftSources(ctx)
    expect(sources.map((s) => s.id)).toEqual(["ticket", "listing:l1", "promises", "kb:a1"])
    expect(sources.find((s) => s.id === "listing:l1")?.href).toBe("/listings/l1")
    expect(sources.find((s) => s.id === "kb:a1")?.href).toBe("/knowledge/how-we-read-pacing")
  })

  it("gives the drafting model redacted context with the first name only", () => {
    const payload = buildDraftContextPayload(context(), buildDraftSources(context()))
    const json = JSON.stringify(payload)
    expect(payload.ticket.client_first_name).toBe("Kate")
    expect(json).not.toMatch(/Rivers|kate@example\.com|201-4477/)
    expect(payload.hub.change_controlled).toBe(false)
  })
})

describe("knowledge passages", () => {
  it("keeps one passage per article, at most four, preferring the approved answer", () => {
    const sources = [
      { id: "a1:c1", title: "A", slug: "a", excerpt: "x", payload: { content: "chunk one" } },
      { id: "a1:c2", title: "A", slug: "a", excerpt: "x", payload: { content: "chunk two" } },
      { id: "a2", title: "B", slug: "b", excerpt: "y", payload: { approvedAnswer: "Approved B", content: "long B" } },
      { id: "a3", title: "C", slug: "c", excerpt: "z" },
      { id: "a4", title: "D", slug: "d", excerpt: "d" },
      { id: "a5", title: "E", slug: "e", excerpt: "e" },
    ]
    const passages = knowledgePassagesFromSources(sources)
    expect(passages.map((p) => p.id)).toEqual(["kb:a1", "kb:a2", "kb:a3", "kb:a4"])
    expect(passages[0].passage).toBe("chunk one")
    expect(passages[1].passage).toBe("Approved B")
  })
})

describe("prepareSupportAnswer", () => {
  it("requires text within the limit", () => {
    expect(prepareSupportAnswer("  ")).toEqual({ ok: false, error: "Write the answer first." })
    expect(prepareSupportAnswer(42)).toMatchObject({ ok: false })
    expect(prepareSupportAnswer("a".repeat(4001))).toMatchObject({ ok: false })
  })

  it("refuses credentials and masks contact details", () => {
    expect(prepareSupportAnswer("The gate code is 4821")).toMatchObject({ ok: false, error: expect.stringMatching(/access code/) })
    expect(prepareSupportAnswer(" Text me at 555-201-4477 ")).toEqual({ ok: true, value: "Text me at ***-***-4477" })
  })
})
