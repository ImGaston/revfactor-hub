import { describe, expect, it } from "vitest"

import {
  buildWikifactorIndex,
  chunkWikifactorMarkdown,
  readWikifactorDoc,
  searchWikifactor,
  type WikifactorCorpus,
} from "@/lib/revai/wikifactor"

const corpus: WikifactorCorpus = {
  generatedAt: "2026-10-16T00:00:00.000Z",
  base: { ref: "origin/main", sha: "abc1234" },
  drafts: [],
  docs: [
    {
      path: "skills/minimum-price-floor.md",
      title: "Minimum price floor",
      status: "accepted",
      branch: null,
      chunks: chunkWikifactorMarkdown("# Minimum price floor\n\n## Rule\nSet the minimum price at break-even plus cleaning."),
    },
    {
      path: "listings/lake-house.md",
      title: "Lake House",
      status: "accepted",
      branch: null,
      chunks: chunkWikifactorMarkdown("# Lake House\n\n## History\nMinimum price lowered in March."),
    },
    {
      path: "ontology/README.md",
      title: "RevFactor ontology",
      status: "draft",
      branch: "docs/onboarding-v2-listing-review",
      chunks: chunkWikifactorMarkdown("# RevFactor ontology\n\n## Rules\nException, recommendation, decision, execution, outcome."),
    },
  ],
}

describe("Wikifactor search", () => {
  const index = buildWikifactorIndex(corpus)

  it("ranks framework pages above per-listing pages", () => {
    const hits = searchWikifactor(index, "minimum price")
    expect(hits[0].path).toBe("skills/minimum-price-floor.md")
    expect(hits.map((hit) => hit.path)).toContain("listings/lake-house.md")
  })

  it("marks draft pages with their branch", () => {
    const [hit] = searchWikifactor(index, "ontology decision outcome")
    expect(hit).toMatchObject({ path: "ontology/README.md", status: "draft" })
  })

  it("reads a page by path or wiki link", () => {
    expect(readWikifactorDoc(corpus, "[[ontology/README]]")?.title).toBe("RevFactor ontology")
    expect(readWikifactorDoc(corpus, "nope.md")).toBeNull()
  })
})
