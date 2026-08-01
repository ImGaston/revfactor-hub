import { describe, expect, it } from "vitest"

import {
  buildKnowledgeChunks,
  htmlToKnowledgeText,
  keywordSearchKnowledge,
  type KnowledgeArticleRecord,
} from "@/lib/knowledge-retrieval"

const article: KnowledgeArticleRecord = {
  id: "article-1",
  title: "How OTA markups work",
  slug: "ota-markups",
  excerpt: "Why channel prices may differ.",
  canonical_question: "Why is Airbnb showing a higher price?",
  approved_answer:
    "Some channels apply a markup so the host's target payout stays aligned after channel fees.",
  escalation_guidance:
    "Escalate when the configured markup or PMS source is unclear.",
  content_html:
    "<h2>What clients see</h2><p>The displayed guest total can include channel fees and taxes.</p><h2>What to verify</h2><p>Confirm the PMS, channel, and PriceLabs configuration.</p>",
  updated_at: "2026-07-31T00:00:00.000Z",
}

describe("Knowledge retrieval", () => {
  it("normalizes HTML into readable source text", () => {
    expect(
      htmlToKnowledgeText("<p>Rates &amp; fees</p><ul><li>Airbnb</li></ul>")
    ).toBe("Rates & fees\n• Airbnb")
  })

  it("creates an approved-answer chunk plus headed article chunks", () => {
    const chunks = buildKnowledgeChunks(article)

    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toMatchObject({
      index: 0,
      heading: "Approved answer",
    })
    expect(chunks[0].content).toContain("Why is Airbnb showing a higher price?")
    expect(chunks[1].heading).toBe("What clients see")
    expect(chunks[2].heading).toBe("What to verify")
  })

  it("preserves exact-term search as the no-cost fallback", () => {
    const results = keywordSearchKnowledge(
      [
        article,
        {
          ...article,
          id: "article-2",
          title: "Cancellation policy",
          slug: "cancellation-policy",
          canonical_question: "Can I cancel?",
          approved_answer: "Review the signed agreement.",
          content_html: "<p>Cancellation requests require review.</p>",
        },
      ],
      "How does the Airbnb markup work?"
    )

    expect(results[0]).toMatchObject({
      id: "article-1",
      keywordRank: 1,
    })
    expect(results[0].keywordScore).toBeGreaterThan(0)
  })
})
