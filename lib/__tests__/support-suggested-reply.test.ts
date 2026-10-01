import { describe, expect, it } from "vitest"

import {
  prepareSuggestedReply,
  suggestedReplyFreshness,
  unfilledPlaceholders,
  type SupportTicket,
} from "@/lib/support-tickets"

const NOW = new Date("2026-09-30T22:00:00Z")
const OPEN: Pick<SupportTicket, "status" | "category" | "merged_into"> = {
  status: "open",
  category: "pricing",
  merged_into: null,
}
const DRAFT = {
  text: "Hi Kate! Great question. December is pacing [X]% vs the same point last year.",
  basis: ["PriceLabs: December on-the-books vs last year"],
  skill: "revfactor-pricing-voice",
  prompt_version: "support-reply-v1",
  generated_at: "2026-09-30T17:55:00-04:00",
}

describe("prepareSuggestedReply", () => {
  it("normalizes a valid draft", () => {
    const result = prepareSuggestedReply(DRAFT, OPEN, NOW)
    expect(result).toEqual({
      ok: true,
      value: { ...DRAFT, generated_at: "2026-09-30T21:55:00.000Z" },
    })
  })

  it("defaults generated_at to now and optional fields to null", () => {
    const result = prepareSuggestedReply({ text: "Hi!" }, OPEN, NOW)
    expect(result).toEqual({
      ok: true,
      value: { text: "Hi!", basis: [], skill: null, prompt_version: null, generated_at: NOW.toISOString() },
    })
  })

  it("rejects malformed drafts with the field paths", () => {
    const result = prepareSuggestedReply({ text: "", skill: "Pricing Voice" }, OPEN, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(400)
    expect(result.issues?.map((i) => i.path)).toEqual(expect.arrayContaining(["text", "skill"]))
  })

  it("rejects drafts over the length limit", () => {
    expect(prepareSuggestedReply({ text: "a".repeat(4001) }, OPEN, NOW)).toMatchObject({ ok: false, status: 400 })
  })

  it("only drafts on open tickets", () => {
    for (const ticket of [
      { ...OPEN, status: "resolved" as const },
      { ...OPEN, status: "dismissed" as const },
      { ...OPEN, merged_into: "6f1c2a64-1d7e-4f43-9a5e-0d1f4c8b9e21" },
    ]) {
      expect(prepareSuggestedReply(DRAFT, ticket, NOW)).toMatchObject({ ok: false, status: 409 })
    }
  })

  it("never drafts on billing or offboarding tickets", () => {
    for (const category of ["billing", "offboarding"] as const) {
      expect(prepareSuggestedReply(DRAFT, { ...OPEN, category }, NOW)).toMatchObject({ ok: false, status: 422 })
    }
  })

  it("rejects credentials without echoing them, in the text or the basis", () => {
    const inText = prepareSuggestedReply({ text: "The door code is 4471, pw: hunter22" }, OPEN, NOW)
    expect(inText).toMatchObject({ ok: false, status: 422 })
    if (!inText.ok) expect(inText.error).not.toContain("hunter22")

    const inBasis = prepareSuggestedReply({ text: "Hi!", basis: ["key sk_live_abcdefghijklmnop1234"] }, OPEN, NOW)
    expect(inBasis).toMatchObject({ ok: false, status: 422 })
  })

  it("masks emails and phone numbers", () => {
    const result = prepareSuggestedReply(
      { text: "I copied jamie.owner@example.com and (555) 201-4477.", basis: ["Email from jamie.owner@example.com"] },
      OPEN,
      NOW
    )
    expect(result.ok && result.value.text).toBe("I copied j***@example.com and ***-***-4477.")
    expect(result.ok && result.value.basis).toEqual(["Email from j***@example.com"])
  })

  it("rejects a generated_at in the future", () => {
    expect(
      prepareSuggestedReply({ text: "Hi!", generated_at: "2026-09-30T23:00:00Z" }, OPEN, NOW)
    ).toMatchObject({ ok: false, status: 400 })
  })
})

describe("unfilledPlaceholders", () => {
  it("finds bracketed gaps once each", () => {
    expect(
      unfilledPlaceholders("Pacing is [X]% ahead. We'll follow up by [date]. Again: [X]%. [owner to fill]")
    ).toEqual(["[X]", "[date]", "[owner to fill]"])
  })

  it("ignores markdown links, redaction markers, and empty text", () => {
    expect(unfilledPlaceholders("See [the report](https://example.com) and [redacted: credential]")).toEqual([])
    expect(unfilledPlaceholders(null)).toEqual([])
  })
})

describe("suggestedReplyFreshness", () => {
  const at = "2026-09-30T20:00:00Z"
  it("is current when nobody wrote after the draft", () => {
    expect(
      suggestedReplyFreshness(at, { last_client_message_at: "2026-09-30T19:00:00Z", last_team_message_at: null })
    ).toBe("current")
  })

  it("flags a client message after the draft", () => {
    expect(
      suggestedReplyFreshness(at, { last_client_message_at: "2026-09-30T21:00:00Z", last_team_message_at: null })
    ).toBe("client_wrote_since")
  })

  it("a team reply after the draft wins", () => {
    expect(
      suggestedReplyFreshness(at, {
        last_client_message_at: "2026-09-30T21:00:00Z",
        last_team_message_at: "2026-09-30T20:30:00Z",
      })
    ).toBe("team_replied_since")
  })
})
