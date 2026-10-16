import { describe, expect, it } from "vitest"

import {
  activeMentionQuery,
  expandMentions,
  mentionKindFromHref,
  mentionMarkdown,
  presentMentions,
} from "@/lib/revai/mentions"

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

describe("RevAI mention expansion", () => {
  const lake = { kind: "listing" as const, id: "1", label: "Lake House", detail: null, href: "/listings/1" }
  const lake2 = { kind: "listing" as const, id: "2", label: "Lake House 2", detail: null, href: "/listings/2" }
  const jacob = { kind: "client" as const, id: "3", label: "Jacob Raabe", detail: null, href: "/clients/3" }

  it("replaces readable tags with id links before sending", () => {
    expect(expandMentions("How is @Jacob Raabe doing?", [jacob])).toBe("How is [@Jacob Raabe](/clients/3) doing?")
  })

  it("keeps overlapping names apart and drops deleted tags", () => {
    expect(expandMentions("@Lake House 2 vs @Lake House", [lake, lake2, jacob])).toBe(
      "[@Lake House 2](/listings/2) vs [@Lake House](/listings/1)"
    )
    expect(presentMentions("@Lake House only", [lake, jacob])).toEqual([lake])
  })

  it("reads the record kind from a Hub link", () => {
    expect(mentionKindFromHref("/support/abc")).toBe("ticket")
    expect(mentionKindFromHref("https://example.com")).toBeNull()
  })
})
