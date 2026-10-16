import { describe, expect, it } from "vitest"

import { activeMentionQuery, mentionMarkdown } from "@/lib/revai/mentions"

describe("RevAI mentions", () => {
  it("finds the @query being typed at the caret", () => {
    const text = "How is @Vis"
    expect(activeMentionQuery(text, text.length)).toEqual({ query: "Vis", start: 7 })
    expect(activeMentionQuery("@", 1)).toEqual({ query: "", start: 0 })
  })

  it("ignores emails and finished mentions", () => {
    expect(activeMentionQuery("mail fede@revfactor.io", 22)).toBeNull()
    expect(activeMentionQuery("[@The Vista](/listings/1) and", 29)).toBeNull()
  })

  it("inserts a Hub link the model can read an id from", () => {
    expect(
      mentionMarkdown({ kind: "listing", id: "abc", label: "The [Vista]", detail: null, href: "/listings/abc" })
    ).toBe("[@The Vista](/listings/abc)")
  })
})
